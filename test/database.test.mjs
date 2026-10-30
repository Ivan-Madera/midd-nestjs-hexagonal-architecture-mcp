import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { listConnections, ensureConnection } from '../dist/lib/connections.js'
import { MOTORES, PROFILES, connectionEnv } from '../dist/lib/engines.js'
import { validateSpec, SpecValidationError } from '../dist/lib/spec.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = resolve(HERE, '..', 'templates')
const newRepo = () => mkdtempSync(join(tmpdir(), 'midd-db-'))
const cleanup = (root) => rmSync(root, { recursive: true, force: true })
const read = (root, rel) => readFileSync(join(root, rel), 'utf8')
const edit = (root, rel, change) => writeFileSync(join(root, rel), change(read(root, rel)), 'utf8')
const DB_CONTEXT = 'src/shared/infrastructure/database-context'

const useCase = (root, overrides) =>
  addUseCase({
    projectRoot: root, dominio: 'catalog', caso: 'RetrieveProduct', entidad: 'Product', metodo: 'retrieveBySku', param: 'sku',
    accion: 'retrieveProduct', prefijoError: 'CATALOG', conexion: 'Catalog', adapterType: 'typeorm', mode: 'greenfield',
    connectionStyle: 'named', infraStyle: 'dataset', overwrite: true, ...overrides
  })

const scaffold = (root, motor = 'mssql', conexion = 'Catalog') =>
  scaffoldService({ projectRoot: root, conexion, motor, prefijoApi: 'midd-catalog', prefijoError: 'CATALOG', overwrite: true })

/** SQL Server primary + a PostgreSQL module with TypeORM + a MySQL module with stored procedures. */
async function threeEngines(root) {
  await scaffold(root, 'mssql', 'Catalog')
  await useCase(root, { dominio: 'reports', caso: 'RetrieveReport', accion: 'retrieveReport', prefijoError: 'REPORTS', conexion: 'Reporting', motor: 'postgres' })
  await useCase(root, { dominio: 'legacy', caso: 'RetrieveLegacy', accion: 'retrieveLegacy', prefijoError: 'LEGACY', conexion: 'SoftCredito', motor: 'mysql', adapterType: 'sp', nombreSp: 'GetLegacy' })
}

const verify = (root) => {
  const run = spawnSync('node', [join(root, 'scripts', 'verify-standards.mjs'), '--json'], { cwd: root, encoding: 'utf8' })
  const report = JSON.parse(run.stdout)
  return { status: run.status, report, rules: report.errors.map((e) => e.rule), messages: report.errors.map((e) => e.message) }
}

// ---------------------------------------------------------------------------
// Engine profiles
// ---------------------------------------------------------------------------
test('the three engines of the area have a profile, and SQL Server keeps the canonical names', () => {
  assert.deepEqual([...MOTORES], ['mssql', 'postgres', 'mysql'])
  assert.equal(PROFILES.mssql.defaultPort, 1433)
  assert.equal(PROFILES.postgres.defaultPort, 5432)
  assert.equal(PROFILES.mysql.defaultPort, 3306)
  assert.equal(PROFILES.mssql.classPrefix, 'SqlServer')
  assert.equal(PROFILES.mssql.fileTag, 'mssql')
  assert.equal(PROFILES.mssql.optionTag, 'sqlserver')
  for (const profile of Object.values(PROFILES)) {
    assert.ok(profile.driver.name && profile.driver.version, `${profile.id} needs a driver`)
    assert.match(profile.sampleUser, /^[a-z]+$/)
  }
})

test('connection variables are derived from the connection name', () => {
  assert.deepEqual(connectionEnv('Catalog'), {
    prefix: 'DB_CATALOG', host: 'DB_CATALOG_HOST', port: 'DB_CATALOG_PORT', username: 'DB_CATALOG_USERNAME', password: 'DB_CATALOG_PASSWORD', name: 'DB_CATALOG_NAME'
  })
  assert.equal(connectionEnv('SoftCredito').host, 'DB_SOFT_CREDITO_HOST')
  assert.equal(connectionEnv('MacropayPF').host, 'DB_MACROPAY_PF_HOST')
})

// ---------------------------------------------------------------------------
// A new service: the engine decides the TypeORM configuration
// ---------------------------------------------------------------------------
for (const motor of MOTORES) {
  test(`a new service on ${motor} gets its TypeORM configuration, config, env, driver and wiring`, async () => {
    const root = newRepo()
    try {
      const result = await scaffold(root, motor)
      assert.notEqual(result.isError, true, result.content[0].text)
      const profile = PROFILES[motor]
      const camel = 'catalog'

      const options = read(root, `${DB_CONTEXT}/options/${camel}.${profile.optionTag}.option.ts`)
      assert.match(options, new RegExp(`type: '${profile.typeormType}'`))
      assert.match(options, /autoLoadEntities: true/)
      assert.match(options, /port: db\.Port/)
      assert.doesNotMatch(options, /entities:\s*\[/, 'there is no list of entities to maintain by hand')
      assert.equal(/trustServerCertificate/.test(options), motor === 'mssql', 'only SQL Server needs the certificate option')

      const moduleFile = read(root, `${DB_CONTEXT}/${profile.fileTag}.database.${camel}.module.ts`)
      assert.match(moduleFile, new RegExp(`export class ${profile.classPrefix}CatalogDatabaseModule`))
      assert.match(moduleFile, /name: 'CatalogConnection'/)

      const config = read(root, 'src/shared/infrastructure/config/configuration-variables.ts')
      assert.match(config, /Catalog: \{[\s\S]*Server: process\.env\.DB_CATALOG_HOST,[\s\S]*Port: Number\(process\.env\.DB_CATALOG_PORT\)[\s\S]*DataBaseName: process\.env\.DB_CATALOG_NAME/)
      assert.doesNotMatch(config, /MSSQL_DATABASE|process\.env\.DATABASE_NAME/, 'no variable is tied to one engine')

      const joi = read(root, 'src/shared/infrastructure/config/joi-schema.ts')
      assert.match(joi, new RegExp(`DB_CATALOG_PORT: Joi\\.number\\(\\)\\.default\\(${profile.defaultPort}\\)`))
      for (const key of ['HOST', 'USERNAME', 'PASSWORD', 'NAME']) assert.match(joi, new RegExp(`DB_CATALOG_${key}: Joi\\.string\\(\\)\\.required\\(\\)`))

      const env = read(root, '.env.example')
      assert.match(env, new RegExp(`^DB_CATALOG_PORT=${profile.defaultPort}$`, 'm'))
      assert.match(env, new RegExp(`^DB_CATALOG_USERNAME=${profile.sampleUser}$`, 'm'))

      // the driver is a RUNTIME dependency: the production image installs with --omit=dev
      const pkg = JSON.parse(read(root, 'package.json'))
      assert.equal(pkg.dependencies[profile.driver.name], profile.driver.version)
      for (const other of Object.values(PROFILES).filter((p) => p.id !== motor)) {
        assert.equal(other.driver.name in pkg.dependencies, false, `${other.driver.name} must not come along`)
      }
      assert.equal(profile.driver.name in (pkg.devDependencies ?? {}), false)

      const app = read(root, 'src/app.module.ts')
      assert.match(app, new RegExp(`import \\{ ${profile.classPrefix}CatalogDatabaseModule \\}`))
      assert.match(app, /UtilsModule\.register\(\['Catalog'\]\)/)

      const { report, status } = verify(root)
      assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
      assert.deepEqual(report.warnings, [])
      assert.equal(status, 0)
    } finally {
      cleanup(root)
    }
  })
}

test('the engine is mandatory: scaffold_service without it, or with an unknown one, writes nothing', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(HERE, '..', 'dist', 'index.js')] })
  const client = new Client({ name: 'db-test', version: '0.0.0' })
  const root = newRepo()
  try {
    await client.connect(transport)
    const tool = (await client.listTools()).tools.find((t) => t.name === 'scaffold_service')
    assert.deepEqual(tool.inputSchema.properties.motor.enum, ['mssql', 'postgres', 'mysql', 'none'], 'the three engines, or none = no database')
    assert.ok(!tool.inputSchema.required.includes('motor'), 'the tool checks it itself, with a message that says what to ask (the schema error was cryptic)')
    assert.match(tool.description, /OBLIGATORIOS y SIEMPRE se le preguntan al usuario/)

    // the first call on a repo without the kit only installs it (first contact); from the second one the checks apply
    await client.callTool({ name: 'scaffold_service', arguments: { projectRoot: root } })
    const base = { projectRoot: root, conexion: 'Catalog', prefijoApi: 'svc', prefijoError: 'SVC' }
    for (const args of [base, { ...base, motor: 'oracle' }]) {
      const out = await client.callTool({ name: 'scaffold_service', arguments: args }).then((r) => r, (e) => e)
      assert.ok(out instanceof Error || out.isError === true)
    }
    assert.equal(existsSync(join(root, 'src')), false)
  } finally {
    await client.close()
    cleanup(root)
  }
})

test('a connection name that is not PascalCase is refused (it ends up in generated code and in patterns)', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(HERE, '..', 'dist', 'index.js')] })
  const client = new Client({ name: 'db-test', version: '0.0.0' })
  const root = newRepo()
  try {
    await client.connect(transport)
    for (const conexion of ["Catalog'); drop", 'catalog', 'Cat alog', '../Catalog']) {
      const out = await client
        .callTool({ name: 'scaffold_service', arguments: { projectRoot: root, conexion, motor: 'mssql', prefijoApi: 'svc', prefijoError: 'SVC' } })
        .then((r) => r, (e) => e)
      assert.ok(out instanceof Error || out.isError === true, `"${conexion}" must be rejected`)
    }
    assert.equal(existsSync(join(root, 'src')), false)
    assert.throws(() => ensureConnection({ projectRoot: root, conexion: 'bad name', motor: 'mssql' }), /Invalid connection name/)
  } finally {
    await client.close()
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// Hole 1: a second connection used to be left half wired
// ---------------------------------------------------------------------------
test('a second connection on ANOTHER engine is created complete, and the verifier is clean', async () => {
  const root = newRepo()
  try {
    await threeEngines(root)
    assert.deepEqual(listConnections(root), [
      { name: 'Catalog', motor: 'mssql' },
      { name: 'Reporting', motor: 'postgres' },
      { name: 'SoftCredito', motor: 'mysql' }
    ])

    for (const file of [
      'postgres.database.reporting.module.ts', 'options/reporting.postgres.option.ts',
      'mysql.database.soft-credito.module.ts', 'options/soft-credito.mysql.option.ts'
    ]) assert.ok(existsSync(join(root, DB_CONTEXT, file)), `missing ${file}`)

    const app = read(root, 'src/app.module.ts')
    assert.match(app, /UtilsModule\.register\(\['Catalog', 'Reporting', 'SoftCredito'\]\)/)
    for (const cls of ['SqlServerCatalogDatabaseModule', 'PostgresReportingDatabaseModule', 'MySqlSoftCreditoDatabaseModule']) {
      assert.match(app, new RegExp(`imports:[\\s\\S]*\\b${cls}\\b`), `${cls} must be in the imports array`)
    }

    const config = read(root, 'src/shared/infrastructure/config/configuration-variables.ts')
    for (const name of ['Catalog', 'Reporting', 'SoftCredito']) assert.match(config, new RegExp(`${name}: \\{`))
    const env = read(root, '.env.example')
    for (const prefix of ['DB_CATALOG', 'DB_REPORTING', 'DB_SOFT_CREDITO']) assert.match(env, new RegExp(`^${prefix}_HOST=`, 'm'))
    assert.match(env, /^DB_REPORTING_PORT=5432$/m)
    assert.match(env, /^DB_SOFT_CREDITO_PORT=3306$/m)

    const pkg = JSON.parse(read(root, 'package.json'))
    assert.deepEqual(['mssql', 'mysql2', 'pg'].filter((d) => d in pkg.dependencies), ['mssql', 'mysql2', 'pg'])
    assert.deepEqual(Object.keys(pkg.dependencies), [...Object.keys(pkg.dependencies)].sort((a, b) => a.localeCompare(b)), 'dependencies stay sorted')

    const { report } = verify(root)
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
  } finally {
    cleanup(root)
  }
})

test('creating the same connection again changes nothing', async () => {
  const root = newRepo()
  try {
    await threeEngines(root)
    const files = ['src/app.module.ts', 'package.json', '.env.example', 'src/shared/infrastructure/config/joi-schema.ts', 'src/shared/infrastructure/config/configuration-variables.ts']
    const before = files.map((f) => read(root, f))
    const again = ensureConnection({ projectRoot: root, conexion: 'Reporting', motor: 'postgres' })
    assert.equal(again.status, 'exists')
    assert.deepEqual(again.written, [])
    await useCase(root, { dominio: 'reports', caso: 'RetrieveReportTwo', accion: 'retrieveReportTwo', prefijoError: 'REPORTS', conexion: 'Reporting', motor: 'postgres' })
    assert.deepEqual(files.map((f) => read(root, f)), before)
  } finally {
    cleanup(root)
  }
})

test('a NEW connection without an engine is refused and nothing is generated', async () => {
  const root = newRepo()
  try {
    await scaffold(root)
    const out = await useCase(root, { dominio: 'billing', caso: 'RetrieveInvoice', accion: 'retrieveInvoice', prefijoError: 'BILLING', conexion: 'Billing' })
    assert.equal(out.isError, true)
    assert.match(out.content[0].text, /falta el motor/)
    assert.equal(existsSync(join(root, 'src/billing')), false)
    assert.equal(listConnections(root).some((c) => c.name === 'Billing'), false)
  } finally {
    cleanup(root)
  }
})

test('an existing connection is never switched to another engine, by scaffold or by add_use_case', async () => {
  const root = newRepo()
  try {
    await scaffold(root, 'mssql')
    const snapshot = () => ['src/app.module.ts', 'package.json', '.env.example'].map((f) => read(root, f))
    const before = snapshot()

    const viaUseCase = await useCase(root, { dominio: 'other', caso: 'RetrieveOther', accion: 'retrieveOther', prefijoError: 'OTHER', conexion: 'Catalog', motor: 'postgres' })
    assert.equal(viaUseCase.isError, true)
    assert.match(viaUseCase.content[0].text, /ya existe con el motor mssql/)
    assert.equal(existsSync(join(root, 'src/other')), false)

    const viaScaffold = await scaffold(root, 'postgres')
    assert.equal(viaScaffold.isError, true)
    assert.match(viaScaffold.content[0].text, /No se cambia el motor/)
    assert.deepEqual(snapshot(), before)
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// generate_from_spec carries the engine
// ---------------------------------------------------------------------------
const SPEC = (engine, extra = '') => `module: reports
entity: Report
stack: nestjs
error_prefix: REPORTS
connection: { name: Reporting, style: named${engine ? `, engine: ${engine}` : ''} }
use_cases:
  - name: RetrieveReport
    action: retrieveReport
    resource_type: report
    adapter: typeorm
    methods:
      - { name: retrieveById, request: RetrieveReportRequest, response: Report }
business_rules: { none: true, rules: [] }
${extra}`

test('the spec must say the engine of its connection: no default, only the three known', () => {
  const base = {
    module: 'reports', entity: 'Report', stack: 'nestjs', error_prefix: 'REPORTS',
    use_cases: [{ name: 'RetrieveReport', action: 'retrieveReport', resource_type: 'report', adapter: 'typeorm', methods: [{ name: 'a', request: 'A', response: 'B' }] }],
    business_rules: { none: true, rules: [] }
  }
  for (const engine of ['oracle', 'sqlserver']) {
    assert.throws(
      () => validateSpec({ ...base, connection: { name: 'Reporting', style: 'named', engine } }),
      (e) => e instanceof SpecValidationError && e.problems.some((p) => p.includes('connection.engine') && p.includes('mssql | postgres | mysql'))
    )
  }
  // Missing is not a spec error: generate_from_spec requires it to CREATE a connection (greenfield) and a
  // refactor does not need it because it reuses the project's own connection.
  for (const engine of [undefined, '']) {
    assert.equal(validateSpec({ ...base, connection: { name: 'Reporting', style: 'named', engine } }).connection.engine, undefined)
  }
  for (const engine of MOTORES) assert.equal(validateSpec({ ...base, connection: { name: 'Reporting', style: 'named', engine } }).connection.engine, engine)
})

test('generate_from_spec creates the connection of the spec with its engine', async () => {
  const root = newRepo()
  try {
    await scaffold(root, 'mssql')
    const specPath = join(root, 'spec.yaml')
    writeFileSync(specPath, SPEC('postgres'), 'utf8')

    const plan = await generateFromSpec({ projectRoot: root, specPath, mode: 'greenfield', dryRun: true, overwrite: false })
    assert.match(plan.content[0].text, /Reporting \(named, PostgreSQL\)/)

    const done = await generateFromSpec({ projectRoot: root, specPath, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(done.isError, true, done.content[0].text)
    assert.deepEqual(listConnections(root).find((c) => c.name === 'Reporting'), { name: 'Reporting', motor: 'postgres' })
    assert.deepEqual(verify(root).report.errors, [])
  } finally {
    cleanup(root)
  }
})

test('generate_from_spec stops on an engine conflict instead of reporting success', async () => {
  const root = newRepo()
  try {
    await scaffold(root, 'mssql', 'Reporting')
    const specPath = join(root, 'spec.yaml')
    writeFileSync(specPath, SPEC('mysql'), 'utf8')
    const out = await generateFromSpec({ projectRoot: root, specPath, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.equal(out.isError, true)
    assert.match(out.content[0].text, /ya existe con el motor mssql/)
    assert.equal(existsSync(join(root, 'src/reports')), false)
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// Hole 2: TypeORM entities no longer need to be registered by hand
// ---------------------------------------------------------------------------
test('TypeORM entities are loaded automatically, and the placeholders of the entity cannot go unnoticed', async () => {
  const root = newRepo()
  try {
    await threeEngines(root)
    for (const file of readdirSync(join(root, DB_CONTEXT, 'options'))) {
      const options = read(root, `${DB_CONTEXT}/options/${file}`)
      assert.match(options, /autoLoadEntities: true/, file)
      assert.doesNotMatch(options, /entities:\s*\[/, file)
    }
    const infra = read(root, 'src/reports/infrastructure/reports.infrastructure.module.ts')
    assert.match(infra, /TypeOrmModule\.forFeature\(\[\w+EntityConfiguration\], 'ReportingConnection'\)/)

    // the entity still carries the table/column placeholders until someone fills them: it must say so with TODO
    const entity = read(root, 'src/reports/infrastructure/sql-database/entities/product.entity.ts')
    assert.match(entity, /TODO: replace '<nombre_tabla>'/)
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// Hole 3: a stored procedure adapter must use the database of ITS connection
// ---------------------------------------------------------------------------
test('a stored procedure adapter injects the database service of its own connection', async () => {
  const root = newRepo()
  try {
    await threeEngines(root)
    const adapter = read(root, 'src/legacy/infrastructure/adapters/retrieve-legacy.sp.adapter.ts')
    assert.match(adapter, /import \{ databaseServiceToken \} from/)
    assert.match(adapter, /@Inject\(databaseServiceToken\('SoftCredito'\)\)/)
    assert.doesNotMatch(adapter, /@Inject\(DATABASE_COMMON_PROCESS_SERVICES_ADAPTER\)/, 'the generic token is only the FIRST connection')

    const utils = read(root, 'src/shared/utils/utils.module.ts')
    assert.match(utils, /export const databaseServiceToken = /)
    assert.match(utils, /const token = databaseServiceToken\(name\)/, 'register and the adapter must build the token the same way')
  } finally {
    cleanup(root)
  }
})

test('in a refactor the adapter keeps the token the project already has', async () => {
  const root = newRepo()
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    const out = await useCase(root, {
      dominio: 'legacy', caso: 'RetrieveLegacy', accion: 'retrieveLegacy', prefijoError: 'LEGACY', conexion: 'SoftCredito',
      adapterType: 'sp', nombreSp: 'GetLegacy', mode: 'refactor', infraStyle: 'project', infraRoot: 'common'
    })
    assert.notEqual(out.isError, true, out.content[0].text)
    const adapter = read(root, 'src/legacy/infrastructure/adapters/retrieve-legacy.sp.adapter.ts')
    assert.match(adapter, /import \{ DATABASE_COMMON_PROCESS_SERVICES_ADAPTER \} from '\.\.\/\.\.\/\.\.\/common\/utils\/utils\.module'/)
    assert.match(adapter, /@Inject\(DATABASE_COMMON_PROCESS_SERVICES_ADAPTER\)/)
    assert.equal(existsSync(join(root, DB_CONTEXT)), false, 'a refactor never gets a connection created: the project owns its own')
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// The verifier would have caught all of it
// ---------------------------------------------------------------------------
const MUTATIONS = [
  {
    name: 'the database module of a used connection is not imported in AppModule',
    change: (root) => edit(root, 'src/app.module.ts', (t) => t.replace(/\n\s*PostgresReportingDatabaseModule,?/, '')),
    expect: (m) => /PostgresReportingDatabaseModule.*not imported/.test(m)
  },
  {
    name: 'a connection is missing from UtilsModule.register',
    change: (root) => edit(root, 'src/app.module.ts', (t) => t.replace("'Reporting', ", '')),
    expect: (m) => /"Reporting" is not in UtilsModule\.register/.test(m)
  },
  {
    name: 'a module uses a connection nobody declared',
    change: (root) => rmSync(join(root, DB_CONTEXT, 'postgres.database.reporting.module.ts')),
    expect: (m) => /Reporting.*no database module declares/.test(m)
  },
  {
    name: 'a stored procedure adapter points at a connection that does not exist',
    change: (root) =>
      edit(root, 'src/legacy/infrastructure/adapters/retrieve-legacy.sp.adapter.ts', (t) => t.replace("databaseServiceToken('SoftCredito')", "databaseServiceToken('Ghost')")),
    expect: (m) => /Ghost.*no database module declares/.test(m)
  },
  {
    name: 'a comment that mentions the register call does not count as the call',
    change: (root) =>
      edit(root, 'src/app.module.ts', (t) => t.replace("UtilsModule.register(['Catalog', 'Reporting', 'SoftCredito'])", "UtilsModule.register(['Catalog', 'SoftCredito'])\n    // UtilsModule.register(['Catalog', 'Reporting', 'SoftCredito'])")),
    expect: (m) => /"Reporting" is not in UtilsModule\.register/.test(m)
  }
]
for (const m of MUTATIONS) {
  test(`verify-standards detects: ${m.name} (DB_CONNECTION_MISSING)`, async () => {
    const root = newRepo()
    try {
      await threeEngines(root)
      assert.deepEqual(verify(root).report.errors, [], 'the starting point must be clean')
      m.change(root)
      const { status, rules, messages } = verify(root)
      assert.ok(rules.includes('DB_CONNECTION_MISSING'), `got [${rules.join(', ')}]`)
      assert.ok(messages.some(m.expect), `unexpected messages:\n${messages.join('\n')}`)
      assert.equal(status, 1)
    } finally {
      cleanup(root)
    }
  })
}

test('verify-standards requires every variable ConfigurationVariables reads to be validated in Joi', async () => {
  const root = newRepo()
  try {
    await threeEngines(root)
    edit(root, 'src/shared/infrastructure/config/joi-schema.ts', (t) => t.replace(/^\s*DB_REPORTING_HOST: .*\n/m, ''))
    const { rules, messages } = verify(root)
    assert.ok(rules.includes('MISSING_ENV_VALIDATION'))
    assert.ok(messages.some((m) => m.includes('DB_REPORTING_HOST') && m.includes('not validated')), messages.join('\n'))
  } finally {
    cleanup(root)
  }
})

test('a refactor without the database-context folder is not judged by the connection rule', async () => {
  const root = newRepo()
  try {
    await scaffold(root)
    rmSync(join(root, DB_CONTEXT), { recursive: true, force: true })
    edit(root, 'src/app.module.ts', (t) => t.replace(/import \{ SqlServerCatalogDatabaseModule \}.*\n/, '').replace(/\n\s*SqlServerCatalogDatabaseModule,?/, ''))
    assert.ok(!verify(root).rules.includes('DB_CONNECTION_MISSING'))
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// Stored procedures per engine (the template code itself, transpiled and run)
// ---------------------------------------------------------------------------
function transpile(relPath, rewrites = []) {
  const source = readFileSync(join(TEMPLATES, relPath), 'utf8')
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [from, to] of rewrites) {
    assert.ok(js.includes(from), `expected "${from}" in the transpiled ${relPath}`)
    js = js.split(from).join(to)
  }
  return js
}

const toolDir = mkdtempSync(join(tmpdir(), 'midd-sp-'))
process.on('exit', () => rmSync(toolDir, { recursive: true, force: true }))
writeFileSync(join(toolDir, 'spDialects.mjs'), transpile('shared/utils/services/sp-dialects.ts'), 'utf8')
const logged = []
writeFileSync(join(toolDir, 'logger.mjs'), 'export default { error: (m) => globalThis.__spLog.push(["error", m]), debug: (m) => globalThis.__spLog.push(["debug", m]), info() {}, warn() {} }\n', 'utf8')
globalThis.__spLog = logged
writeFileSync(
  join(toolDir, 'databaseCommonService.mjs'),
  transpile('shared/utils/services/database-common.service.ts', [
    ["'./sp-dialects'", "'./spDialects.mjs'"],
    ["'../../error-event-management/logger/logger.service'", "'./logger.mjs'"]
  ]),
  'utf8'
)
const dialects = await import(pathToFileURL(join(toolDir, 'spDialects.mjs')).href)
const { DatabaseCommonService } = await import(pathToFileURL(join(toolDir, 'databaseCommonService.mjs')).href)

test('stored procedures are called with the syntax of each engine', () => {
  assert.equal(dialects.spDialectFor('mssql').buildCall('dbo.GetUser', 2), 'dbo.GetUser @0, @1')
  assert.equal(dialects.spDialectFor('mssql').buildCall('GetAll', 0), 'GetAll')
  assert.equal(dialects.spDialectFor('mssql').buildCall('[dbo].[Get User]', 1), '[dbo].[Get User] @0')
  assert.equal(dialects.spDialectFor('postgres').buildCall('public.get_user', 2), 'SELECT * FROM public.get_user($1, $2)')
  assert.equal(dialects.spDialectFor('postgres').buildCall('get_all', 0), 'SELECT * FROM get_all()')
  assert.equal(dialects.spDialectFor('mysql').buildCall('GetUser', 2), 'CALL GetUser(?, ?)')
  assert.equal(dialects.spDialectFor('mysql').buildCall('GetAll', 0), 'CALL GetAll()')
})

test('the procedure name is part of the statement, so anything but a plain name is refused', () => {
  const injections = ['x; DROP TABLE users', "x'--", 'a b', 'x()', '', 'a.b.c.d.e', 'x\nSELECT 1', '1abc', 'a-b']
  for (const engine of MOTORES) {
    for (const bad of injections) {
      assert.throws(() => dialects.spDialectFor(engine).buildCall(bad, 1), dialects.SpConfigurationError, `${engine}: "${bad}"`)
    }
  }
  assert.throws(() => dialects.spDialectFor('postgres').buildCall('[dbo].[x]', 1), dialects.SpConfigurationError, 'brackets are SQL Server only')
  assert.throws(() => dialects.spDialectFor('mysql').buildCall('[dbo].[x]', 1), dialects.SpConfigurationError)
})

test('an unsupported engine is a clear configuration error', () => {
  assert.throws(() => dialects.spDialectFor('sqlite'), (e) => e instanceof dialects.SpConfigurationError && /mssql, postgres, mysql/.test(e.message))
  assert.throws(() => dialects.spDialectFor('constructor'), dialects.SpConfigurationError, 'a Map: no accidental match by prototype')
})

test('the rows are read from what each driver returns', () => {
  const rows = [{ a: 1 }, { a: 2 }]
  assert.deepEqual(dialects.spDialectFor('mssql').rows(rows), rows)
  assert.deepEqual(dialects.spDialectFor('mssql').rows(undefined), [])
  assert.deepEqual(dialects.spDialectFor('postgres').rows(rows), rows)
  assert.deepEqual(dialects.spDialectFor('postgres').rows({ rows }), rows)
  assert.deepEqual(dialects.spDialectFor('postgres').rows({}), [])
  assert.deepEqual(dialects.spDialectFor('mysql').rows([rows, { affectedRows: 0 }]), rows, 'CALL answers [rows, OkPacket]')
  assert.deepEqual(dialects.spDialectFor('mysql').rows([[], { affectedRows: 0 }]), [], 'an empty result set stays empty')
  assert.deepEqual(dialects.spDialectFor('mysql').rows({ affectedRows: 1 }), [], 'a routine with no result set answers an object')
})

const fakeDataSource = (type, behaviour) => {
  const calls = []
  return { calls, options: { type }, query: async (sql, params) => (calls.push({ sql, params }), behaviour(sql, params)) }
}

test('DatabaseCommonService builds the statement of the connection engine and returns the rows', async () => {
  const cases = [
    ['mssql', 'Proc @0, @1', [{ id: 1 }]],
    ['postgres', 'SELECT * FROM Proc($1, $2)', [{ id: 1 }]],
    ['mysql', 'CALL Proc(?, ?)', [[{ id: 1 }], { affectedRows: 0 }]]
  ]
  for (const [type, sql, raw] of cases) {
    const ds = fakeDataSource(type, () => structuredClone(raw)) // a driver answers a fresh array every time
    const service = new DatabaseCommonService(ds)
    assert.deepEqual(await service.executeStoredProcedure('Proc', { a: 'x', b: 2 }, true), { id: 1 }, `${type}: single object`)
    assert.deepEqual(ds.calls, [{ sql, params: ['x', 2] }], type)
    assert.deepEqual(await service.executeStoredProcedure('Proc', { a: 'x', b: 2 }, false), [{ id: 1 }], `${type}: array when not single`)
  }
})

test('DatabaseCommonService: several rows stay an array, even when a single object was asked', async () => {
  const ds = fakeDataSource('postgres', () => [{ id: 1 }, { id: 2 }])
  assert.deepEqual(await new DatabaseCommonService(ds).executeStoredProcedure('p', {}, true), [{ id: 1 }, { id: 2 }])
})

test('DatabaseCommonService: a failing query is reported with the message of that engine, never thrown', async () => {
  const failures = [
    ['mssql', { originalError: { message: 'mssql says no' }, query: 'q' }, 'mssql says no'],
    ['postgres', { driverError: { message: 'pg says no' }, query: 'q' }, 'pg says no'],
    ['mysql', { driverError: { sqlMessage: 'mysql says no' }, query: 'q' }, 'mysql says no']
  ]
  for (const [type, error, expected] of failures) {
    logged.length = 0
    const ds = fakeDataSource(type, () => Promise.reject(error))
    const result = await new DatabaseCommonService(ds).executeStoredProcedure('Proc', { a: 1 }, true)
    assert.equal(result.hasFailed, true, type)
    assert.equal(result.message, expected, type)
    assert.ok(logged.some(([level]) => level === 'error'), `${type}: the failure is logged`)
  }
})

test('DatabaseCommonService: a bad name or an unsupported engine surfaces, and no query is sent', async () => {
  const ds = fakeDataSource('mssql', () => [])
  await assert.rejects(new DatabaseCommonService(ds).executeStoredProcedure('x; DROP TABLE t', {}), dialects.SpConfigurationError)
  const sqlite = fakeDataSource('sqlite', () => [])
  await assert.rejects(new DatabaseCommonService(sqlite).executeStoredProcedure('Proc', {}), dialects.SpConfigurationError)
  assert.equal(ds.calls.length + sqlite.calls.length, 0)
})

test('DatabaseCommonService: no parameters is fine', async () => {
  const ds = fakeDataSource('mysql', () => [[{ ok: true }], {}])
  assert.deepEqual(await new DatabaseCommonService(ds).executeStoredProcedure('Ping', undefined, true), { ok: true })
  assert.deepEqual(ds.calls, [{ sql: 'CALL Ping()', params: [] }])
})
