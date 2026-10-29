/**
 * End-to-end: generates a REAL NestJS service with the MCP tools, installs it, compiles it with its
 * own npm scripts, runs its own tests / lint / standards, boots it and talks to it over HTTP.
 *
 *   npm run test:e2e
 *
 * It is NOT part of `npm test` on purpose: the first run needs network (npm install) and takes a couple
 * of minutes. Dependencies are cached in a temp folder and only reinstalled when the generated
 * package.json changes, so later runs are much faster.
 *
 * What it can NOT cover: there is no SQL Server here, so the service is booted with an "edge" module
 * that imports the real security, health and authorization modules (and the service's real main.ts) but
 * not the database. Everything the database touches is covered by compilation, its unit tests and the
 * verifier, not by a live connection.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scaffoldService } from '../../dist/tools/scaffold.js'
import { generateFromSpec } from '../../dist/tools/generateFromSpec.js'
import { addAuthorization } from '../../dist/tools/addAuthorization.js'

const WORKSPACE = join(tmpdir(), 'midd-e2e-workspace')
const KEEP = new Set(['node_modules', '.deps-hash'])
const API = '/midd-catalog/api/v1'
const VNDAPI = 'application/vnd.api+json'

// --- helpers -----------------------------------------------------------------

const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')
const tail = (text, lines = 40) => stripAnsi(text).split(/\r?\n/).slice(-lines).join('\n')

function run(command, label, timeout = 600000) {
  // shell:true is needed for npm on Windows; the command strings are fixed, never user input.
  // The node test runner forces colors in child processes; strip them so the output can be parsed.
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  const result = spawnSync(command, { cwd: WORKSPACE, shell: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return { ok: result.status === 0, status: result.status, output, label }
}

function expectOk(result) {
  assert.ok(result.ok, `${result.label} failed (exit ${result.status}). Last output:\n${tail(result.output)}`)
  return result.output
}

function request(port, path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let raw = ''
      res.on('data', (chunk) => (raw += chunk))
      res.on('end', () => {
        let json
        try {
          json = JSON.parse(raw)
        } catch {
          json = undefined
        }
        resolve({ status: res.statusCode, headers: res.headers, json, raw })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const jsonApi = (extra = {}) => ({ 'content-type': VNDAPI, ...extra })

async function freePort() {
  return await new Promise((resolve) => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function parseEnvExample(text) {
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return env
}

function prepareWorkspace() {
  mkdirSync(WORKSPACE, { recursive: true })
  for (const entry of readdirSync(WORKSPACE)) {
    if (!KEEP.has(entry)) rmSync(join(WORKSPACE, entry), { recursive: true, force: true })
  }
}

const SPEC_CATALOG = `module: catalog
entity: Product
description: Consulta de productos por SKU o codigo de barras
stack: nestjs
error_prefix: CATALOG
connection:
  name: Catalog
  engine: mssql
  style: named
use_cases:
  - name: RetrieveProduct
    action: retrieveProduct
    resource_type: product
    adapter: sp
    methods:
      - { name: retrieveBySku, request: RetrieveProductRequest, response: Product, sp: GetProductBySku }
      - { name: retrieveByBarcode, request: RetrieveProductByBarcodeRequest, response: Product, sp: GetProductByBarcode }
dtos:
  input: { sku: string }
  output: { id: number, sku: string, name: string }
business_rules:
  none: false
  rules:
    - "sku es obligatorio"
    - "el producto debe existir en el catalogo (404 si no se encuentra)"
complexity: { level: 0, signals: [] }
notes:
  - "TODO: validar tipos de columnas contra el esquema real"
`

const SPEC_INVENTORY = `module: inventory
entity: Stock
description: Existencias por almacen
stack: nestjs
error_prefix: INVENTORY
connection:
  name: Catalog
  engine: mssql
  style: named
use_cases:
  - name: RetrieveStock
    action: retrieveStock
    resource_type: stock
    adapter: typeorm
    methods:
      - { name: retrieveByWarehouse, request: RetrieveStockRequest, response: Stock }
dtos:
  input: { warehouse: string }
  output: { warehouse: string, quantity: number }
business_rules: { none: true, rules: [] }
complexity: { level: 0, signals: [] }
`

const EDGE_MODULE = `import { Controller, HttpCode, Module, Post } from '@nestjs/common'
import { GlobalSettingModule } from './shared/infrastructure/globalsetting.module'
import { SecurityModule } from './shared/infrastructure/security/security.module'
import { HealthModule } from './shared/infrastructure/http-server/health.module'
import { AuthorizationModule } from './shared/authorization/authorization.module'

// A protected endpoint to observe the authorization guard. Same module order as the real AppModule:
// SecurityModule (rate limit) BEFORE AuthorizationModule.
@Controller({ path: 'probe', version: '1' })
class ProtectedProbeController {
  @Post('protected')
  @HttpCode(200)
  run() {
    return { data: { ok: 'protected' } }
  }
}

@Module({
  imports: [GlobalSettingModule, SecurityModule, HealthModule, AuthorizationModule],
  controllers: [ProtectedProbeController]
})
export class AppModule {}
`

// --- the test ------------------------------------------------------------------

test('a generated NestJS service compiles, passes its own checks and serves its HTTP edge', async (t) => {
  prepareWorkspace()
  let child
  let authorizer
  const childLog = []

  try {
    await t.test('generate a service with two modules (stored procedure and TypeORM) and authorization', async () => {
      await scaffoldService({ projectRoot: WORKSPACE, conexion: 'Catalog', motor: 'mssql', prefijoServicio: 'midd-catalog', prefijoError: 'CATALOG', overwrite: true })
      for (const [name, spec] of [['catalog', SPEC_CATALOG], ['inventory', SPEC_INVENTORY]]) {
        const specPath = join(WORKSPACE, `agentic/specs/${name}/input/specs/middleware.spec.yaml`)
        mkdirSync(join(specPath, '..'), { recursive: true })
        writeFileSync(specPath, spec, 'utf8')
        const result = await generateFromSpec({ projectRoot: WORKSPACE, specPath, mode: 'greenfield', dryRun: false, overwrite: false })
        assert.notEqual(result.isError, true, result.content[0].text)
      }
      const auth = await addAuthorization({ projectRoot: WORKSPACE, authorizationApiUrl: 'http://127.0.0.1:1/authorization/v1', overwrite: false })
      assert.notEqual(auth.isError, true, auth.content[0].text)
      assert.ok(existsSync(join(WORKSPACE, 'src/shared/infrastructure/http-server/controllers/health.controller.ts')), 'a new service ships the health probe')
    })

    await t.test('the API documentation is generated from the real code and the verifier finds it up to date', () => {
      for (const module of ['catalog', 'inventory']) {
        const contract = readFileSync(join(WORKSPACE, `src/${module}/contracts/${module}.api.md`), 'utf8')
        assert.match(contract, new RegExp(`POST /midd-catalog/api/v1/${module}/`))
        assert.match(readFileSync(join(WORKSPACE, `src/${module}/diagrams/${module}.flow.mmd`), 'utf8'), /^sequenceDiagram$/m)
      }
      assert.match(readFileSync(join(WORKSPACE, 'docs/api/README.md'), 'utf8'), /inventory\.api\.md/)
    })

    await t.test('install dependencies (cached between runs)', () => {
      const hash = createHash('sha256').update(readFileSync(join(WORKSPACE, 'package.json'))).digest('hex')
      const hashFile = join(WORKSPACE, '.deps-hash')
      const cached = existsSync(join(WORKSPACE, 'node_modules')) && existsSync(hashFile) && readFileSync(hashFile, 'utf8') === hash
      if (!cached) {
        rmSync(join(WORKSPACE, 'node_modules'), { recursive: true, force: true })
        expectOk(run('npm install --no-audit --no-fund --ignore-scripts', 'npm install', 1200000))
        writeFileSync(hashFile, hash, 'utf8')
      }
      assert.ok(existsSync(join(WORKSPACE, 'node_modules/@nestjs/core/package.json')))
    })

    await t.test('banned dependencies are not even installed at the top level', () => {
      assert.equal(existsSync(join(WORKSPACE, 'node_modules/axios')), false, 'axios must not be installed')
      const pkg = JSON.parse(readFileSync(join(WORKSPACE, 'package.json'), 'utf8'))
      const declared = { ...pkg.dependencies, ...pkg.devDependencies }
      assert.ok(!('axios' in declared) && !('uuid' in declared))
    })

    await t.test('the database driver is a production dependency (the Dockerfile omits devDependencies)', () => {
      const pkg = JSON.parse(readFileSync(join(WORKSPACE, 'package.json'), 'utf8'))
      assert.ok(pkg.dependencies.mssql, 'mssql must be in dependencies')
      assert.equal(pkg.devDependencies?.mssql, undefined)
      assert.ok(existsSync(join(WORKSPACE, 'node_modules/mssql/package.json')))
    })

    await t.test('npm run build compiles the whole service', () => {
      expectOk(run('npm run build', 'npm run build'))
      assert.ok(existsSync(join(WORKSPACE, 'dist/main.js')), 'dist/main.js was not produced')
    })

    await t.test("the service's own tests run and pass (not an empty suite)", () => {
      const output = expectOk(run('npm test', 'npm test'))
      const passed = /Tests:\s+(?:\d+ \w+, )*(\d+) passed/.exec(stripAnsi(output))
      assert.ok(passed && Number(passed[1]) > 0, `expected at least one passing test, got:\n${tail(output, 15)}`)
      assert.doesNotMatch(stripAnsi(output), /^Tests:.*\bfailed\b/m, `jest reported failures:\n${tail(output, 15)}`)
    })

    await t.test('lint is clean', () => {
      expectOk(run('npm run lint:check', 'npm run lint:check'))
    })

    await t.test('verify-standards finds no errors', () => {
      const result = run('node scripts/verify-standards.mjs --json', 'verify-standards')
      const report = JSON.parse(result.output.slice(result.output.indexOf('{')))
      assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
    })

    await t.test('compile an HTTP edge module (no database) next to the real main.ts', () => {
      writeFileSync(join(WORKSPACE, 'src/edge.app.module.ts'), EDGE_MODULE, 'utf8')
      const main = readFileSync(join(WORKSPACE, 'src/main.ts'), 'utf8')
      assert.ok(main.includes("import { AppModule } from './app.module'"), 'main.ts import changed shape: update this test')
      writeFileSync(join(WORKSPACE, 'src/main.edge.ts'), main.replace("import { AppModule } from './app.module'", "import { AppModule } from './edge.app.module'"), 'utf8')
      expectOk(run('npm run build', 'npm run build (edge)'))
      assert.ok(existsSync(join(WORKSPACE, 'dist/main.edge.js')))
    })

    let port
    let authorizerCalls = []

    await t.test('boot the service using only the values of its own .env.example', async () => {
      // the authorization API: accepts one token, rejects the rest
      authorizer = http.createServer((req, res) => {
        authorizerCalls.push(req.headers.authorization ?? '')
        req.resume()
        res.statusCode = req.headers.authorization === 'Bearer good-token' ? 200 : 401
        res.end('{}')
      })
      await new Promise((resolve) => authorizer.listen(0, '127.0.0.1', resolve))
      const authorizerPort = authorizer.address().port

      port = await freePort()
      const example = parseEnvExample(readFileSync(join(WORKSPACE, '.env.example'), 'utf8'))
      const env = {
        ...process.env,
        ...example,
        PORT: String(port),
        AUTHORIZATION_API_URL: `http://127.0.0.1:${authorizerPort}/authorization/v1`,
        RL_MAX_REQUESTS_PER_WINDOW: '30' // high enough for the checks above, low enough to be reached by the burst below
      }
      child = spawn(process.execPath, ['dist/main.edge.js'], { cwd: WORKSPACE, env })
      child.stdout.on('data', (d) => childLog.push(String(d)))
      child.stderr.on('data', (d) => childLog.push(String(d)))
      let exited = false
      child.on('exit', () => (exited = true))

      const deadline = Date.now() + 60000
      let up = false
      while (Date.now() < deadline && !exited) {
        try {
          const res = await request(port, `${API}/health`, { headers: jsonApi(), body: '{}' })
          if (res.status === 200) {
            up = true
            break
          }
        } catch {
          /* not listening yet */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      assert.ok(up, `the service did not come up${exited ? ' (the process exited)' : ''}. Output:\n${tail(childLog.join(''))}`)
      authorizerCalls = []
    })

    await t.test('health: POST /{context}/api/v1/health answers 200 UP with the JSON:API envelope', async () => {
      const res = await request(port, `${API}/health`, { headers: jsonApi({ origin: 'https://anything.example.com' }), body: '{}' })
      assert.equal(res.status, 200)
      assert.equal(res.json.data.type, 'health')
      assert.deepEqual(res.json.data.attributes, { status: 'UP' })
      assert.equal(res.json.data.links.self, `${API}/health`)
      assert.deepEqual(Object.keys(res.json.data.attributes), ['status'], 'a liveness probe leaks nothing')
    })

    await t.test('health: carries the mandatory security headers and CORS default', async () => {
      const res = await request(port, `${API}/health`, { headers: jsonApi({ origin: 'https://anything.example.com' }), body: '{}' })
      assert.equal(res.headers['cache-control'], 'no-store')
      assert.match(res.headers['strict-transport-security'], /max-age=31536000/)
      assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.ok(res.headers['content-security-policy'] && res.headers['referrer-policy'] && res.headers['permissions-policy'])
      assert.equal(res.headers['x-powered-by'], undefined)
      assert.equal(res.headers['access-control-allow-origin'], '*', 'CORS_ALLOWED_ORIGINS defaults to *')
    })

    await t.test('health stays public although authorization is enabled, and never calls the authorizer', async () => {
      const res = await request(port, `${API}/health`, { headers: jsonApi(), body: '{}' })
      assert.equal(res.status, 200)
      assert.deepEqual(authorizerCalls, [], 'the probe must not consume authorization calls')
    })

    await t.test('correlation id: reused when valid, generated when absent or malicious', async () => {
      const kept = await request(port, `${API}/health`, { headers: jsonApi({ 'x-correlation-id': 'trace-abc-123' }), body: '{}' })
      assert.equal(kept.headers['x-correlation-id'], 'trace-abc-123')
      const generated = await request(port, `${API}/health`, { headers: jsonApi(), body: '{}' })
      assert.match(generated.headers['x-correlation-id'], /^[0-9a-f-]{36}$/)
      const evil = await request(port, `${API}/health`, { headers: jsonApi({ 'x-correlation-id': 'a b"<script>' }), body: '{}' })
      assert.match(evil.headers['x-correlation-id'], /^[0-9a-f-]{36}$/, 'an unsafe id is replaced, never echoed')
    })

    await t.test('area policy: wrong content type -> 415, other verbs -> 406, errors carry the correlation id', async () => {
      const wrongType = await request(port, `${API}/health`, { headers: { 'content-type': 'application/json' }, body: '{}' })
      assert.equal(wrongType.status, 415)
      assert.equal(wrongType.json.errors[0].code, 'SERVICE-UNSUPPORTED_MEDIA_TYPE-0013')
      assert.ok(wrongType.json.meta.correlationId)
      assert.equal(wrongType.headers['cache-control'], 'no-store', 'rejections carry the security headers too')

      const get = await request(port, `${API}/health`, { method: 'GET', headers: jsonApi() })
      assert.equal(get.status, 406)

      const unknown = await request(port, `${API}/nope`, { headers: jsonApi(), body: '{}' })
      assert.equal(unknown.status, 404)
      const unversioned = await request(port, '/midd-catalog/health', { headers: jsonApi(), body: '{}' })
      assert.equal(unversioned.status, 404, 'the version lives in the controller, not in the global prefix')
    })

    await t.test('authorization: protected endpoints answer 401 / 403 / 200, health does not', async () => {
      const none = await request(port, `${API}/probe/protected`, { headers: jsonApi(), body: '{}' })
      assert.equal(none.status, 401)
      assert.equal(none.json.errors[0].code, 'SERVICE-UNAUTHORIZED-0020')

      const bad = await request(port, `${API}/probe/protected`, { headers: jsonApi({ authorization: 'Bearer bad-token' }), body: '{}' })
      assert.equal(bad.status, 403)
      assert.equal(bad.json.errors[0].code, 'SERVICE-FORBIDDEN-0021')

      const good = await request(port, `${API}/probe/protected`, { headers: jsonApi({ authorization: 'Bearer good-token' }), body: '{}' })
      assert.equal(good.status, 200)
      assert.deepEqual(authorizerCalls, ['Bearer bad-token', 'Bearer good-token'], 'the front token is forwarded; a request without token never reaches the authorizer')
    })

    await t.test('payload size: over 2 MB is rejected with 413 before parsing when Content-Length is declared', async () => {
      const body = JSON.stringify({ data: 'a'.repeat(2.5 * 1024 * 1024) })
      const big = await request(port, `${API}/health`, { headers: jsonApi({ 'content-length': String(Buffer.byteLength(body)) }), body })
      assert.equal(big.status, 413)
      assert.equal(big.json.errors[0].code, 'SERVICE-PAYLOADTOOLARGE-0019')
      assert.ok(big.json.meta.correlationId)
    })

    await t.test('payload size: the same limit holds for a chunked body (no Content-Length), with the same error', async () => {
      const body = JSON.stringify({ data: 'a'.repeat(2.5 * 1024 * 1024) })
      const big = await request(port, `${API}/health`, { headers: jsonApi(), body }) // no content-length: sent chunked
      assert.equal(big.status, 413)
      assert.equal(big.json.errors[0].code, 'SERVICE-PAYLOADTOOLARGE-0019', 'the second line of defense must answer like the first')
      assert.equal(big.json.errors[0].title, 'Payload Too Large')
      assert.ok(big.json.meta.correlationId)
    })

    await t.test('a malformed JSON body is a 400 client error, not an internal error', async () => {
      const bad = await request(port, `${API}/health`, { headers: jsonApi(), body: '{ "data": ' })
      assert.equal(bad.status, 400)
      assert.equal(bad.json.errors[0].code, 'SERVICE-BADREQUEST-0016')
      assert.equal(bad.json.errors[0].title, 'Bad Request')
      assert.ok(bad.json.meta.correlationId)
    })

    await t.test('rate limit: a burst from one IP ends in 429 with Retry-After', async () => {
      const statuses = []
      let limited
      for (let i = 0; i < 150 && !limited; i++) {
        const res = await request(port, `${API}/health`, { headers: jsonApi(), body: '{}' })
        statuses.push(res.status)
        if (res.status === 429) limited = res
      }
      assert.ok(limited, `no 429 after ${statuses.length} requests: ${statuses.join(' ')}`)
      assert.equal(limited.headers['retry-after'], '5')
      assert.equal(limited.json.errors[0].code, 'SERVICE-TOOMANYREQUESTS-0017')
    })
  } finally {
    if (child && !child.killed) child.kill('SIGKILL')
    if (authorizer) await new Promise((resolve) => authorizer.close(resolve))
  }
})
