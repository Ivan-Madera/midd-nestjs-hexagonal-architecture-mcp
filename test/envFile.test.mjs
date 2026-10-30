import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { addAuthorization } from '../dist/tools/addAuthorization.js'
import { addEnvEntries, sectionOf, ENV_SECTIONS } from '../dist/lib/envFile.js'

const headers = (text) => text.split(/\r?\n/).filter((l) => l.startsWith('# --- '))
const variables = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  )

const DEFAULTS = {
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: '*',
  RL_MAX_REQUESTS_PER_WINDOW: '150',
  RL_WINDOW_SECONDS: '5',
  RL_MAX_CONCURRENT_PER_IP: '20',
  RL_MAX_PAYLOAD_BYTES: '8388608',
  RL_MAX_JSON_PAYLOAD_BYTES: '2097152',
  RL_CACHE_TTL_MS: '600000',
  RL_CACHE_MAX_ENTRIES: '100000',
  RL_TRUSTED_PROXIES: '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
}

async function service() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-env-'))
  await scaffoldService({ projectRoot, conexion: 'Catalog', motor: 'mssql', prefijoApi: 'midd-catalog', prefijoError: 'CATALOG', overwrite: true })
  return projectRoot
}

test('a new .env.example is grouped by topic and keeps EVERY variable and value', async () => {
  const root = await service()
  try {
    const text = readFileSync(join(root, '.env.example'), 'utf8')
    const vars = variables(text)
    for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(vars[key], value, `${key} keeps its value`)
    assert.equal(vars.API_CONTEXT, 'midd-catalog')
    assert.equal(vars.DB_CATALOG_HOST, 'localhost')
    assert.equal(vars.DB_CATALOG_PORT, '1433')
    assert.equal(vars.DB_CATALOG_USERNAME, 'sa')
    assert.equal(vars.DB_CATALOG_PASSWORD, 'changeme')
    assert.equal(vars.DB_CATALOG_NAME, 'MyDatabase')
    assert.deepEqual(headers(text), [
      '# --- Server ---',
      '# --- CORS ---',
      '# --- Ratelimit ---',
      "# --- Database connection 'Catalog' (SQL Server) ---"
    ])
    // each variable sits under the header of its topic
    const lines = text.split(/\r?\n/)
    const under = (key) => [...lines.slice(0, lines.findIndex((l) => l.startsWith(`${key}=`)))].reverse().find((l) => l.startsWith('# --- '))
    assert.equal(under('PORT'), '# --- Server ---')
    assert.equal(under('RL_TRUSTED_PROXIES'), '# --- Ratelimit ---')
    assert.equal(under('CORS_ALLOWED_ORIGINS'), '# --- CORS ---')
    assert.equal(under('DB_CATALOG_NAME'), "# --- Database connection 'Catalog' (SQL Server) ---")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('connections, authorization and stored procedures each land in their own section, in a stable order', async () => {
  const root = await service()
  try {
    // the authorization goes in BEFORE the second connection and the SP: the final order must not depend on it
    await addAuthorization({ projectRoot: root, authorizationApiUrl: 'http://auth.example/authorization/v1', overwrite: false })
    await addUseCase({
      projectRoot: root, dominio: 'stock', caso: 'RetrieveStock', entidad: 'Stock', metodo: 'run', param: 'sku', accion: 'retrieveStock',
      prefijoError: 'STOCK', conexion: 'Billing', motor: 'mysql', adapterType: 'sp', nombreSp: 'GetStock',
      mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: true
    })
    const text = readFileSync(join(root, '.env.example'), 'utf8')
    assert.equal(headers(text).length, 7, 'server, cors, ratelimit, two databases, authorization, stored procedures')
    const order = headers(text).map((h) => h.replace(/^# --- | ---$/g, '').split(/[ :']/)[0])
    assert.deepEqual(order.slice(0, 3), ['Server', 'CORS', 'Ratelimit'])
    assert.ok(order.indexOf('Authorization') > order.lastIndexOf('Database'), 'authorization after the databases')
    assert.ok(order.indexOf('Stored') > order.indexOf('Authorization'), 'stored procedures last')

    const vars = variables(text)
    assert.equal(vars.AUTHORIZATION_API_URL, 'http://auth.example/authorization/v1')
    assert.equal(vars.DB_BILLING_PORT, '3306')
    assert.equal(vars.GET_STOCK_SP, 'sp_Nombre_Del_Procedure')
    // nothing is duplicated
    const keys = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('=')[0])
    assert.equal(new Set(keys).size, keys.length)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('addEnvEntries never touches an existing value and is idempotent', () => {
  const original = '# my header\n\n# --- Server ---\nPORT=8080\nAPI_CONTEXT=mine\n\n# --- Team notes ---\nFOO=bar\n'
  const once = addEnvEntries(original, ENV_SECTIONS.server, [['PORT', '3000'], ['EXTRA', '1']])
  const vars = variables(once)
  assert.equal(vars.PORT, '8080', 'a value already set by the team is kept')
  assert.equal(vars.EXTRA, '1')
  assert.equal(vars.FOO, 'bar', 'unknown sections of the team survive')
  assert.equal(addEnvEntries(once, ENV_SECTIONS.server, [['PORT', '3000'], ['EXTRA', '1']]), once, 'second run changes nothing')
  assert.ok(once.indexOf('EXTRA=1') < once.indexOf('# --- Team notes ---'), 'new variable goes inside its own section')
})

test('addEnvEntries handles empty and CRLF files', () => {
  assert.equal(addEnvEntries('', ENV_SECTIONS.authorization, [['AUTHORIZATION_API_URL', 'x']]), '# --- Authorization ---\nAUTHORIZATION_API_URL=x\n')
  const crlf = addEnvEntries('# --- Server ---\r\nPORT=1\r\n', ENV_SECTIONS.cors, [['CORS_ALLOWED_ORIGINS', '*']])
  assert.deepEqual(variables(crlf), { PORT: '1', CORS_ALLOWED_ORIGINS: '*' })
})

test('every variable is classified in the topic it belongs to', () => {
  assert.equal(sectionOf('PORT'), ENV_SECTIONS.server)
  assert.equal(sectionOf('API_CONTEXT'), ENV_SECTIONS.server)
  assert.equal(sectionOf('CORS_ALLOWED_ORIGINS'), ENV_SECTIONS.cors)
  assert.equal(sectionOf('RL_CACHE_TTL_MS'), ENV_SECTIONS.rateLimit)
  assert.equal(sectionOf('AUTHORIZATION_API_URL'), ENV_SECTIONS.authorization)
  assert.equal(sectionOf('GET_STOCK_SP'), ENV_SECTIONS.storedProcedures)
  assert.equal(sectionOf('SOMETHING_ELSE'), ENV_SECTIONS.other)
})

test('Joi gives every CORS and RL_* variable its default, and the verifier fails if one is taken away', async () => {
  const root = await service()
  try {
    const joiFile = join(root, 'src/shared/infrastructure/config/joiSchema.ts')
    const joi = readFileSync(joiFile, 'utf8')
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (key === 'PORT') continue
      const literal = /^\d+$/.test(value) ? value : `'${value}'`
      assert.ok(joi.includes(`${key}: Joi.`) && joi.includes(`.default(${literal})`), `${key} defaults to ${value}`)
    }
    const run = () => {
      const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
      return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    }
    assert.equal(run().errors.some((e) => e.rule === 'MISSING_ENV_DEFAULT'), false)

    writeFileSync(joiFile, joi.replace("RL_WINDOW_SECONDS: Joi.number().default(5)", 'RL_WINDOW_SECONDS: Joi.number()'), 'utf8')
    let errors = run().errors.filter((e) => e.rule === 'MISSING_ENV_DEFAULT')
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /RL_WINDOW_SECONDS/)

    writeFileSync(joiFile, joi.replace("CORS_ALLOWED_ORIGINS: Joi.string().default('*')", 'CORS_ALLOWED_ORIGINS: Joi.string()'), 'utf8')
    errors = run().errors.filter((e) => e.rule === 'MISSING_ENV_DEFAULT')
    assert.match(errors[0].message, /CORS_ALLOWED_ORIGINS/)

    // a default that only exists in a comment does not count
    writeFileSync(joiFile, joi.replace("RL_WINDOW_SECONDS: Joi.number().default(5)", "RL_WINDOW_SECONDS: Joi.number() // .default(5)"), 'utf8')
    assert.equal(run().errors.filter((e) => e.rule === 'MISSING_ENV_DEFAULT').length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
