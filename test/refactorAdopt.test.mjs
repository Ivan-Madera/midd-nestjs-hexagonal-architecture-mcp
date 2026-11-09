import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { adoptSharedLayer } from '../dist/tools/adoptShared.js'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addAuthorization } from '../dist/tools/addAuthorization.js'
import { buildPlaceholderMap } from '../dist/lib/placeholders.js'
import { readTemplate } from '../dist/lib/dataset.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text, 'utf8')
}
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
  return { status: r.status, errors: report.errors.map((e) => e.rule), warnings: report.warnings.map((w) => w.rule) }
}

const LEGACY_MAIN = [
  "import { NestFactory } from '@nestjs/core'",
  "import { AppModule } from './app.module'",
  '',
  'async function bootstrap() {',
  '  const app = await NestFactory.create(AppModule)',
  "  app.setGlobalPrefix('setups')",
  '  await app.listen(3000)',
  '}',
  'bootstrap()',
  ''
].join('\n')
const LEGACY_APP = [
  "import { Module } from '@nestjs/common'",
  "import { TypeOrmModule } from '@nestjs/typeorm'",
  "import { SetupsModule } from './setups/setups.module'",
  '',
  '@Module({',
  "  imports: [TypeOrmModule.forRoot({ type: 'mssql', replication: { master: {}, slaves: [] } }), SetupsModule]",
  '})',
  'export class AppModule {}',
  ''
].join('\n')

/** A NestJS project as a refactor finds it: its own main.ts and app.module.ts, banned packages, legacy env names. */
function legacyProject({ ownConfig = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'midd-adopt-'))
  write(root, 'package.json', JSON.stringify({ name: 'legacy', dependencies: { '@nestjs/core': '^10', '@nestjs/common': '^10', axios: '^1', '@nestjs/throttler': '^5' } }, null, 2))
  write(root, 'src/main.ts', LEGACY_MAIN)
  write(root, 'src/app.module.ts', ownConfig ? LEGACY_APP.replace('SetupsModule]', "SetupsModule, ConfigModule.forRoot({ isGlobal: true })]").replace("import { Module } from '@nestjs/common'", "import { Module } from '@nestjs/common'\nimport { ConfigModule } from '@nestjs/config'") : LEGACY_APP)
  write(root, 'src/setups/setups.module.ts', "import { Module } from '@nestjs/common'\n@Module({})\nexport class SetupsModule {}\n")
  write(root, 'src/shared/utils/services/map.service.ts', '// mine: the project already had this file\n')
  write(root, '.env.example', 'PORT=3000\nRL_MAX=10\n')
  return root
}

test('adopt_shared_layer without patchEntry: writes only what is missing and never touches main.ts, app.module.ts or a file of the project', async () => {
  const root = legacyProject()
  try {
    const r = await adoptSharedLayer({ projectRoot: root, prefijoApi: 'midd-pf-initial', patchEntry: false })
    assert.notEqual(r.isError, true, r.content[0].text)
    const text = r.content[0].text
    assert.equal(read(root, 'src/main.ts'), LEGACY_MAIN, 'main.ts belongs to the project')
    assert.equal(read(root, 'src/app.module.ts'), LEGACY_APP, 'app.module.ts belongs to the project')
    assert.equal(read(root, 'src/shared/utils/services/map.service.ts'), '// mine: the project already had this file\n')
    for (const file of [
      'src/shared/infrastructure/security/rate-limit.guard.ts',
      'src/shared/infrastructure/observability/correlation.middleware.ts',
      'src/shared/infrastructure/config/joi-schema.ts',
      'src/shared/infrastructure/http-server/controllers/health.controller.ts',
      'scripts/verify-standards.mjs'
    ])
      assert.ok(existsSync(join(root, file)), `missing ${file}`)
    const pkg = JSON.parse(read(root, 'package.json'))
    assert.ok(pkg.dependencies.helmet && pkg.dependencies.joi, 'the dependencies of the layer are added')
    assert.equal(pkg.dependencies['@nestjs/core'], '^10', 'an existing version is never changed')
    assert.equal(pkg.dependencies.axios, '^1', 'a banned package is reported, not removed')
    const env = read(root, '.env.example')
    assert.match(env, /^RL_MAX_REQUESTS_PER_WINDOW=150$/m, 'the names and defaults of the area, not invented ones')
    assert.match(env, /^RL_TRUSTED_PROXIES=/m)
    assert.match(env, /^API_CONTEXT=midd-pf-initial$/m)
    assert.match(env, /^RL_MAX=10$/m, 'what the project had stays')
    assert.match(text, /patchEntry=true/)
    assert.match(text, /RUTAS \(decision del usuario\)/)
    assert.match(text, /"axios"/)
    assert.match(text, /@nestjs\/throttler/)

    const again = await adoptSharedLayer({ projectRoot: root, prefijoApi: 'midd-pf-initial', patchEntry: false })
    assert.match(again.content[0].text, /Escritos \(0\)/, 'running it again writes nothing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('adopt_shared_layer with patchEntry: the edge of the area is inserted (nothing removed) and the verifier finds it complete', async () => {
  const root = legacyProject()
  try {
    const r = await adoptSharedLayer({ projectRoot: root, prefijoApi: 'midd-pf-initial', patchEntry: true })
    assert.notEqual(r.isError, true, r.content[0].text)
    const main = read(root, 'src/main.ts')
    const firstUse = /app\.use\(\s*([^\n]*)/.exec(main)?.[1] ?? ''
    assert.match(firstUse, /cacheControlNoStore/, 'Cache-Control is the first app.use')
    for (const piece of ['correlationMiddleware', 'createPayloadSizeMiddleware', 'helmet(', 'Permissions-Policy', 'enableCors(', 'AllExceptionsFilter'])
      assert.ok(main.includes(piece), `main.ts lacks ${piece}`)
    assert.match(main, /setGlobalPrefix\('setups'\)/, 'the routes of the project are not changed: that is the user\'s decision')
    const app = read(root, 'src/app.module.ts')
    for (const piece of ['GlobalSettingModule', 'SecurityModule', 'HealthModule', "UtilsModule.register(['Default'])", 'SetupsModule'])
      assert.ok(app.includes(piece), `app.module.ts lacks ${piece}`)

    const { errors, warnings } = verify(root)
    for (const rule of ['MISSING_HTTP_SECURITY', 'MISSING_CACHE_CONTROL', 'MISSING_CORRELATION_ID', 'CORRELATION_ID_UNVALIDATED', 'INCOMPLETE_RATE_LIMITING', 'MISSING_ENV_VALIDATION', 'MISSING_ENV_DEFAULT', 'DB_CONNECTION_MISSING'])
      assert.ok(!errors.includes(rule), `unexpected ${rule}`)
    assert.ok(errors.includes('FORBIDDEN_DEPENDENCY'), 'axios is still there and must be reported')
    assert.ok(warnings.includes('PARALLEL_SECURITY_DEPENDENCY'))
    assert.ok(!warnings.includes('SHARED_LAYOUT'))

    const before = read(root, 'src/main.ts')
    await adoptSharedLayer({ projectRoot: root, prefijoApi: 'midd-pf-initial', patchEntry: true })
    assert.equal(read(root, 'src/main.ts'), before, 'idempotent: nothing is inserted twice')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('adopt_shared_layer never adds a second ConfigModule.forRoot: it says what to merge', async () => {
  const root = legacyProject({ ownConfig: true })
  try {
    const r = await adoptSharedLayer({ projectRoot: root, prefijoApi: 'midd-pf-initial', patchEntry: true })
    assert.doesNotMatch(read(root, 'src/app.module.ts'), /GlobalSettingModule/)
    assert.match(r.content[0].text, /OBLIGATORIO: el proyecto ya carga su configuracion/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('adopt_shared_layer is for an existing NestJS project only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'midd-adopt-empty-'))
  try {
    const r = await adoptSharedLayer({ projectRoot: root, patchEntry: false })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /scaffold_service/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor imports point to src/shared unless the project really has another folder', () => {
  const base = { dominio: 'Setups', caso: 'RetrieveSetup', entidad: 'Setup', metodo: 'retrieveSetup', param: 'id', accion: 'retrieveSetup', prefijoError: 'SET', rutaDominio: 'setups', tipoRecurso: 'setup', conexion: 'Default' }
  assert.equal(buildPlaceholderMap({ ...base, infraStyle: 'project' })['<sharedRoot>'], 'shared', 'never an invented "common"')
  assert.equal(buildPlaceholderMap({ ...base, infraStyle: 'project', infraRoot: 'core-infra' })['<sharedRoot>'], 'core-infra')
})

test('UtilsModule serves the default (unnamed) connection of a refactored project', () => {
  const utils = readTemplate('shared/utils/utils.module.ts')
  assert.match(utils, /export const DEFAULT_CONNECTION = 'Default'/)
  assert.match(utils, /getDataSourceToken\(name === DEFAULT_CONNECTION \? undefined : `\$\{name\}Connection`\)/)
})

// --- the verifier, on a new service: it starts clean and catches each hand-made deviation ---------------------

async function newService() {
  const root = mkdtempSync(join(tmpdir(), 'midd-rules-'))
  const r = await scaffoldService({ projectRoot: root, motor: 'none', prefijoApi: 'midd-rules', prefijoError: 'RULES', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}
const NEW_RULES = ['SHARED_LAYOUT', 'ORM_ENTITY_OUTSIDE_MODULE', 'AUTHORIZATION_DECIDED_NOT_INSTALLED', 'EDGE_ERROR_CODE', 'CORRELATION_ID_UNVALIDATED', 'PARALLEL_SECURITY_DEPENDENCY']

test('a new service raises none of the structure rules', async () => {
  const root = await newService()
  try {
    const { errors, warnings } = verify(root)
    assert.deepEqual([...errors, ...warnings].filter((r) => NEW_RULES.includes(r)), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verifier: pieces moved out of src/shared, a shared entities folder and an invented 429 code are reported', async () => {
  const root = await newService()
  try {
    mkdirSync(join(root, 'src/config'), { recursive: true })
    renameSync(join(root, 'src/shared/infrastructure/config/configuration-variables.ts'), join(root, 'src/config/configuration-variables.ts'))
    write(root, 'src/entities/user.entity.ts', "import { Entity } from 'typeorm'\n@Entity('Users')\nexport class UserEntity {}\n")
    write(root, 'src/shared/middlewares/concurrency-limiter.middleware.ts', "export const body = { status: '429', code: 'INITIAL-CONCURRENCY-001' }\n")
    const { warnings } = verify(root)
    assert.ok(warnings.includes('SHARED_LAYOUT'), 'expected SHARED_LAYOUT')
    assert.ok(warnings.includes('ORM_ENTITY_OUTSIDE_MODULE'), 'expected ORM_ENTITY_OUTSIDE_MODULE')
    assert.ok(warnings.includes('EDGE_ERROR_CODE'), 'expected EDGE_ERROR_CODE')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verifier: a correlation id reused without validation is an error', async () => {
  const root = await newService()
  try {
    write(
      root,
      'src/shared/infrastructure/observability/correlation.middleware.ts',
      "import { randomUUID } from 'node:crypto'\nexport function correlationMiddleware(req: any, res: any, next: any) {\n  req.correlationId = req.headers['x-correlation-id'] || randomUUID()\n  res.setHeader('x-correlation-id', req.correlationId)\n  next()\n}\n"
    )
    const { errors, status } = verify(root)
    assert.ok(errors.includes('CORRELATION_ID_UNVALIDATED'))
    assert.equal(status, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verifier: AUTHORIZATION required in AGENTS.md without the module fails, and add_authorization fixes it', async () => {
  const root = await newService()
  try {
    write(root, 'AGENTS.md', '<!-- BEGIN midd-nestjs-preferences (managed) -->\nAUTHORIZATION: required   # hint\nPOSTMAN: no\n<!-- END midd-nestjs-preferences -->\n')
    assert.ok(verify(root).errors.includes('AUTHORIZATION_DECIDED_NOT_INSTALLED'))
    await addAuthorization({ projectRoot: root, authorizationApiUrl: 'https://auth.example.com', overwrite: false })
    assert.ok(!verify(root).errors.includes('AUTHORIZATION_DECIDED_NOT_INSTALLED'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verifier: a second rate limit package is reported', async () => {
  const root = await newService()
  try {
    const pkg = JSON.parse(read(root, 'package.json'))
    pkg.dependencies['@nestjs/throttler'] = '^6'
    write(root, 'package.json', JSON.stringify(pkg, null, 2))
    assert.ok(verify(root).warnings.includes('PARALLEL_SECURITY_DEPENDENCY'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
