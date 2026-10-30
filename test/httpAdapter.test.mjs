import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { generateApiDocsTool } from '../dist/tools/apiDocs.js'
import { listConnections } from '../dist/lib/connections.js'
import { validateSpec, SpecValidationError } from '../dist/lib/spec.js'
import { envVarApiBaseUrl, httpCallExpression } from '../dist/lib/adapters.js'
import { sectionOf, ENV_SECTIONS, addEnvEntries } from '../dist/lib/envFile.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}

async function noDbService(motor = 'none') {
  const root = mkdtempSync(join(tmpdir(), 'midd-http-'))
  const r = await scaffoldService({ projectRoot: root, motor, prefijoApi: 'midd-rates', prefijoError: 'RATES', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}

const apiCase = (root, over = {}) =>
  addUseCase({
    projectRoot: root, dominio: 'rates', caso: 'RetrieveRate', entidad: 'Rate', metodo: 'retrieveRate', param: 'currency', accion: 'retrieveRate',
    prefijoError: 'RATES', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates', mode: 'greenfield', connectionStyle: 'named',
    infraStyle: 'dataset', overwrite: false, ...over
  })

test('helpers: the base URL variable and the call are derived the same way everywhere', () => {
  assert.equal(envVarApiBaseUrl('ExchangeRates'), 'EXCHANGE_RATES_BASE_URL')
  assert.equal(envVarApiBaseUrl('Sap'), 'SAP_BASE_URL')
  assert.equal(envVarApiBaseUrl('KYCService2'), 'KYC_SERVICE2_BASE_URL')
  assert.equal(httpCallExpression('GET', '/rates'), "get(this.url('/rates'), { params: data as unknown as Record<string, string | number | boolean> })")
  assert.equal(httpCallExpression('POST', '/convert'), "post(this.url('/convert'), data)")
  assert.equal(httpCallExpression('PUT', '/rates/{id}'), "put(this.url('/rates/{id}'), data)")
  assert.equal(sectionOf('EXCHANGE_RATES_BASE_URL'), ENV_SECTIONS.externalApis)
})

test('a service with no database consumes an external API: nothing about a database is generated', async () => {
  const root = await noDbService()
  try {
    const r = await apiCase(root)
    assert.notEqual(r.isError, true, r.content[0].text)
    const adapter = read(root, 'src/rates/infrastructure/adapters/retrieve-rate.http.adapter.ts')
    assert.match(adapter, /this\.http\.get\(this\.url\('\/rates'\), \{ params: data/)
    assert.match(adapter, /externalApis\.ExchangeRates\.baseUrl/)
    const code = adapter.replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /axios|require\(|typeorm/i, 'native fetch through consumoHttp, no database')
    assert.equal(existsSync(join(root, 'src/rates/infrastructure/adapters/retrieve-rate.typeorm.adapter.ts')), false)
    assert.equal(existsSync(join(root, 'src/rates/infrastructure/sql-database')), false, 'an external API has no TypeORM entity')
    assert.deepEqual(listConnections(root), [])
    for (const module of ['src/rates/rates.module.ts', 'src/rates/infrastructure/rates.infrastructure.module.ts']) {
      const text = read(root, module)
      assert.match(text, /retrieve-rate\.http\.adapter/)
      assert.doesNotMatch(text, /TypeOrmModule|typeorm\.adapter|EntityConfiguration/, `${module} has no database wiring`)
    }
    assert.match(read(root, 'src/shared/infrastructure/config/configuration-variables.ts').replace(/^\s*\/\/.*$/gm, ''), /ExchangeRates: \{ baseUrl: process\.env\.EXCHANGE_RATES_BASE_URL \}/)
    assert.match(read(root, 'src/shared/infrastructure/config/joi-schema.ts'), /EXCHANGE_RATES_BASE_URL: Joi\.string\(\)\.uri\(\)\.required\(\)/)
    const env = read(root, '.env.example')
    assert.match(env, /# --- External APIs ---\nEXCHANGE_RATES_BASE_URL=https:\/\/api\.example\.com/)
    assert.doesNotMatch(env, /DB_/)
    const catalog = read(root, 'src/rates/core/domain/errors/rates.domain.error.ts')
    assert.match(catalog, /EXTERNAL_API_ERROR: \{[\s\S]*code: 'RATES-EXTERNALAPI-003'[\s\S]*status: 502/)
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the call follows the verb: GET sends query string, POST and PUT send the body', async () => {
  const root = await noDbService()
  try {
    await apiCase(root, { metodoHttp: 'POST', rutaApi: '/convert', caso: 'ConvertRate', accion: 'convertRate', entidad: 'Conversion', metodo: 'convert' })
    const adapter = read(root, 'src/rates/infrastructure/adapters/convert-rate.http.adapter.ts')
    assert.match(adapter, /this\.http\.post\(this\.url\('\/convert'\), data\)/)
    assert.doesNotMatch(adapter, /params:/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the API name, the path and the verb are required and checked, and nothing is written when they are not', async () => {
  const root = await noDbService()
  try {
    for (const [over, expected] of [
      [{ apiExterna: undefined }, /apiExterna/],
      [{ rutaApi: undefined }, /rutaApi/],
      [{ rutaApi: 'rates' }, /rutaApi/],
      [{ rutaApi: "/rates?x='1'" }, /rutaApi/],
      [{ metodoHttp: 'DELETE' }, /metodoHttp/]
    ]) {
      const r = await apiCase(root, over)
      assert.equal(r.isError, true, JSON.stringify(over))
      assert.match(r.content[0].text, expected)
    }
    assert.equal(existsSync(join(root, 'src/rates')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('several use cases against the same API declare it once; another API gets its own variable', async () => {
  const root = await noDbService()
  try {
    await apiCase(root)
    await apiCase(root, { caso: 'ListRates', accion: 'listRates', entidad: 'RateList', metodo: 'listRates', rutaApi: '/rates/all' })
    await apiCase(root, { dominio: 'customers', caso: 'RetrieveCustomer', entidad: 'Customer', metodo: 'retrieveCustomer', accion: 'retrieveCustomer', apiExterna: 'CustomerCore', rutaApi: '/customers', prefijoError: 'CUST' })
    const env = read(root, '.env.example')
    assert.equal(env.match(/^EXCHANGE_RATES_BASE_URL=/gm).length, 1)
    assert.equal(env.match(/^CUSTOMER_CORE_BASE_URL=/gm).length, 1)
    assert.equal(env.match(/# --- External APIs ---/g).length, 1, 'one section for all the APIs')
    const config = read(root, 'src/shared/infrastructure/config/configuration-variables.ts').replace(/^\s*\/\/.*$/gm, '')
    assert.equal(config.match(/ExchangeRates: \{/g).length, 1)
    assert.match(config, /CustomerCore: \{ baseUrl: process\.env\.CUSTOMER_CORE_BASE_URL \}/)
    const joi = read(root, 'src/shared/infrastructure/config/joi-schema.ts')
    assert.equal(joi.match(/EXCHANGE_RATES_BASE_URL:/g).length, 1)
    // both cases of the domain are registered in its modules
    const infra = read(root, 'src/rates/infrastructure/rates.infrastructure.module.ts')
    assert.match(infra, /RetrieveRateAdapter/)
    assert.match(infra, /ListRatesAdapter/)
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a domain can mix an external API case with a TypeORM case, in either order', async () => {
  for (const order of ['http-first', 'typeorm-first']) {
    const root = await noDbService('mssql')
    try {
      const orm = () =>
        addUseCase({
          projectRoot: root, dominio: 'rates', caso: 'RetrieveStored', entidad: 'Stored', metodo: 'run', param: 'id', accion: 'retrieveStored',
          prefijoError: 'RATES', adapterType: 'typeorm', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: false
        })
      const first = order === 'http-first' ? await apiCase(root) : await orm()
      assert.notEqual(first.isError, true, first.content[0].text)
      const second = order === 'http-first' ? await orm() : await apiCase(root)
      assert.notEqual(second.isError, true, second.content[0].text)
      const infra = read(root, 'src/rates/infrastructure/rates.infrastructure.module.ts')
      assert.match(infra, /retrieve-rate\.http\.adapter/)
      assert.match(infra, /retrieve-stored\.typeorm\.adapter/)
      assert.match(infra, /import \{ TypeOrmModule \}/, `${order}: TypeOrmModule is imported where forFeature is used`)
      assert.match(infra, /TypeOrmModule\.forFeature\(\[StoredEntityConfiguration\]/)
      assert.doesNotMatch(infra, /RateEntityConfiguration/, 'the external API case has no entity')
      assert.deepEqual(verify(root).errors, [], order)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

const SPEC = (extra = '') => `module: rates
entity: Rate
description: x
stack: nestjs
error_prefix: RATES
${extra}use_cases:
  - name: RetrieveRate
    action: retrieveRate
    resource_type: rate
    adapter: http
    api: ExchangeRates
    methods:
      - { name: retrieveRate, request: RetrieveRateRequest, response: Rate, http: { method: GET, path: /rates } }
      - { name: convert, request: ConvertRequest, response: Conversion, http: { method: POST, path: /convert } }
dtos:
  input: { currency: string }
  output: { currency: string, value: number }
business_rules: { none: true, rules: [] }
complexity: { level: 0, signals: [] }
`

test('a spec of external API cases needs no connection and no engine; every method keeps its own verb and path', async () => {
  const root = await noDbService()
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(spec, SPEC())
    const plan = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: true, overwrite: false })
    assert.notEqual(plan.isError, true, plan.content[0].text)
    assert.match(plan.content[0].text, /conexión: ninguna \(todos los casos consumen una API externa\)/)
    assert.match(plan.content[0].text, /\[API ExchangeRates: GET \/rates\]/)
    const real = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(real.isError, true, real.content[0].text)
    const adapter = read(root, 'src/rates/infrastructure/adapters/retrieve-rate.http.adapter.ts')
    assert.match(adapter, /this\.http\.get\(this\.url\('\/rates'\)/)
    assert.match(adapter, /async convert\(data: ConvertRequest\): Promise<Conversion> \{\n    const response = await this\.http\.post\(this\.url\('\/convert'\), data\)\n    return this\.result\(response, Conversion\)/)
    assert.equal(listConnections(root).length, 0)
    const inventory = JSON.parse(read(root, 'docs/architecture-inventory.json'))
    assert.equal(inventory.modules.rates.connection, undefined, 'no connection recorded')
    assert.equal(inventory.modules.rates.useCases[0].api, 'ExchangeRates')
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an engine "none" does not get in the way of a spec that only consumes APIs', async () => {
  const root = await noDbService()
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(spec, SPEC('connection:\n  engine: none\n  style: named\n'))
    const real = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(real.isError, true, real.content[0].text)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('spec validation: an external API case must name the API and every method its verb and path', () => {
  const base = { module: 'rates', entity: 'Rate', error_prefix: 'RATES', business_rules: { none: true, rules: [] } }
  const useCase = (extra = {}, method = {}) => ({
    ...base,
    use_cases: [{ name: 'RetrieveRate', action: 'retrieveRate', resource_type: 'rate', adapter: 'http', api: 'ExchangeRates', methods: [{ name: 'retrieveRate', request: 'A', response: 'B', http: { method: 'GET', path: '/rates' }, ...method }], ...extra }]
  })
  assert.equal(validateSpec(useCase()).useCases[0].api, 'ExchangeRates')
  assert.deepEqual(validateSpec(useCase()).useCases[0].methods[0].http, { method: 'GET', path: '/rates' })
  assert.equal(validateSpec(useCase({}, { http: { path: '/rates' } })).useCases[0].methods[0].http.method, 'GET', 'GET by default')
  for (const [bad, expected] of [
    [useCase({ api: undefined }), /api es obligatorio/],
    [useCase({ api: 'exchange' }), /api debe ser PascalCase/],
    [useCase({}, { http: { method: 'GET' } }), /http\.path/],
    [useCase({}, { http: { method: 'GET', path: 'rates' } }), /http\.path/],
    [useCase({}, { http: { method: 'DELETE', path: '/rates' } }), /GET, POST o PUT/],
    [useCase({}, { http: undefined }), /http\.path/],
    [useCase({ adapter: 'soap' }), /"typeorm", "sp" o "http"/]
  ]) {
    assert.throws(() => validateSpec(bad), (e) => e instanceof SpecValidationError && e.problems.some((p) => expected.test(p)), String(expected))
  }
})

test('a refactor can use an external API even if the project has no database connection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'midd-http-refactor-'))
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'legacy', dependencies: { '@nestjs/core': '^11' } }))
    writeFileSync(join(root, 'src/app.module.ts'), "import { Module } from '@nestjs/common'\n@Module({ imports: [] })\nexport class AppModule {}\n")
    const r = await apiCase(root, { mode: 'refactor' })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.equal(existsSync(join(root, 'src/shared/infrastructure/database-context')), false, 'no connection is created')
    assert.match(read(root, 'src/rates/infrastructure/adapters/retrieve-rate.http.adapter.ts'), /externalApis\.ExchangeRates/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the documentation shows the external API instead of a database', async () => {
  const root = await noDbService()
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(spec, SPEC())
    await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    const docs = await generateApiDocsTool({ projectRoot: root, postman: false, architecture: true })
    assert.notEqual(docs.isError, true, docs.content[0].text)
    const flow = read(root, 'src/rates/diagrams/rates.flow.mmd')
    assert.match(flow, /participant E as External API ExchangeRates/)
    assert.match(flow, /R0->>E: GET \/rates/)
    assert.doesNotMatch(flow, /participant D as DB/, 'no database in the diagram')
    assert.match(read(root, 'src/rates/contracts/rates.api.md'), /API externa ExchangeRates: GET \/rates/)
    const arch = /```mermaid\n([\s\S]*?)```/.exec(read(root, 'docs/ARCHITECTURE.md'))[1]
    assert.match(arch, /service api_ExchangeRates\(internet\)\[ExchangeRates\]/)
    assert.match(arch, /m_rates:R --> L:api_ExchangeRates/)
    assert.doesNotMatch(arch, /\(database\)/, 'no database node')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('.env.example keeps the External APIs section between Authorization and Stored procedures', () => {
  let env = '# --- Server ---\nPORT=1\n'
  env = addEnvEntries(env, ENV_SECTIONS.storedProcedures, [['GET_X_SP', 'sp']])
  env = addEnvEntries(env, ENV_SECTIONS.authorization, [['AUTHORIZATION_API_URL', 'http://a']])
  env = addEnvEntries(env, ENV_SECTIONS.externalApis, [['SAP_BASE_URL', 'https://api.example.com']])
  const headers = env.split('\n').filter((l) => l.startsWith('# --- '))
  assert.deepEqual(headers, ['# --- Server ---', '# --- Authorization ---', '# --- External APIs ---', '# --- Stored procedures ---'])
})
