import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { recordArchitecture } from '../dist/tools/architecture.js'
import { inspectProjectTool } from '../dist/tools/support.js'
import { defaultConnectionName, nextConnectionName, chooseConnection } from '../dist/lib/connections.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const dbFiles = (root) => readdirSync(join(root, 'src/shared/infrastructure/database-context')).filter((f) => f.endsWith('.module.ts'))

async function service(motor) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-conn-'))
  const r = await scaffoldService({ projectRoot, motor, prefijoApi: 'midd-demo', prefijoError: 'DEMO', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return projectRoot
}

const useCase = (projectRoot, over = {}) =>
  addUseCase({
    projectRoot, dominio: 'stock', caso: 'RetrieveStock', entidad: 'Stock', metodo: 'run', param: 'sku', accion: 'retrieveStock',
    prefijoError: 'DEMO', adapterType: 'typeorm', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: true, ...over
  })

const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}

test('the name comes from the engine, nobody is asked for it', async () => {
  for (const [motor, name, label, upper] of [
    ['mssql', 'Mssql', 'SQL Server', 'MSSQL'],
    ['postgres', 'Postgres', 'PostgreSQL', 'POSTGRES'],
    ['mysql', 'Mysql', 'MySQL', 'MYSQL']
  ]) {
    const root = await service(motor)
    try {
      const env = read(root, '.env.example')
      assert.match(env, new RegExp(`# --- Database connection '${name}' \\(${label}\\) ---`))
      assert.match(env, new RegExp(`^DB_${upper}_HOST=`, 'm'))
      assert.match(read(root, 'src/app.module.ts'), new RegExp(`${name}`), 'the connection is wired in AppModule')
      assert.equal(verify(root).errors.length, 0, JSON.stringify(verify(root).errors))
      assert.equal(defaultConnectionName(motor), name)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a use case without a connection name reuses the single connection of that engine', async () => {
  const root = await service('mssql')
  try {
    const before = dbFiles(root)
    const r = await useCase(root, { motor: 'mssql' })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.deepEqual(dbFiles(root), before, 'no second connection was created')
    assert.doesNotMatch(read(root, '.env.example'), /DB_MSSQL2_/)
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'MssqlConnection'/)
    // not even the engine is needed when the project has exactly one connection
    const again = await useCase(root, { dominio: 'billing', caso: 'RetrieveInvoice', entidad: 'Invoice', accion: 'retrieveInvoice' })
    assert.notEqual(again.isError, true, again.content[0].text)
    assert.deepEqual(dbFiles(root), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('another engine gets its own connection named after it, with its own variables', async () => {
  const root = await service('mssql')
  try {
    const r = await useCase(root, { motor: 'postgres' })
    assert.notEqual(r.isError, true, r.content[0].text)
    const env = read(root, '.env.example')
    assert.match(env, /^DB_POSTGRES_PORT=5432$/m)
    assert.match(env, /^DB_MSSQL_PORT=1433$/m)
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'PostgresConnection'/)
    assert.equal(verify(root).errors.length, 0, JSON.stringify(verify(root).errors))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an additional connection of the same engine is numbered: Mssql2, Mssql3', async () => {
  const root = await service('mssql')
  try {
    const r = await useCase(root, { motor: 'mssql', conexion: 'Mssql2' })
    assert.notEqual(r.isError, true, r.content[0].text)
    const env = read(root, '.env.example')
    assert.match(env, /^DB_MSSQL_HOST=/m)
    assert.match(env, /^DB_MSSQL2_HOST=/m, 'the number is part of the variable names, no hyphen')
    assert.match(env, /^DB_MSSQL2_PORT=1433$/m)
    assert.equal(dbFiles(root).length, 2)
    assert.match(read(root, 'src/app.module.ts'), /UtilsModule\.register\(\[[^\]]*'Mssql2'/, 'its stored procedures get their own database service')
    assert.equal(verify(root).errors.length, 0, JSON.stringify(verify(root).errors))
    assert.equal(nextConnectionName('mssql', ['Mssql', 'Mssql2']), 'Mssql3')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('with two connections of one engine and no name, the caller must say which one', async () => {
  const root = await service('mssql')
  try {
    await useCase(root, { motor: 'mssql', conexion: 'Mssql2' })
    const r = await useCase(root, { motor: 'mssql', dominio: 'billing', caso: 'RetrieveInvoice', entidad: 'Invoice', accion: 'retrieveInvoice' })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /Mssql.*Mssql2|Mssql2.*Mssql/)
    assert.match(r.content[0].text, /indica cual/)
    assert.equal(existsSync(join(root, 'src/billing')), false, 'nothing was written')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('without a name and without an engine nothing is guessed on an empty project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'midd-conn-'))
  try {
    const choice = chooseConnection({ projectRoot: root })
    assert.ok('error' in choice)
    assert.match(choice.error, /motor/)
    const r = await scaffoldService({ projectRoot: root, motor: undefined, prefijoApi: 'x', prefijoError: 'X', overwrite: true })
    assert.equal(r.isError, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a name the project already uses is respected as is', async () => {
  const root = mkdtempSync(join(tmpdir(), 'midd-conn-'))
  try {
    const r = await scaffoldService({ projectRoot: root, conexion: 'Catalog', motor: 'postgres', prefijoApi: 'midd-demo', prefijoError: 'DEMO', overwrite: true })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.match(read(root, '.env.example'), /^DB_CATALOG_HOST=/m)
    // later calls without a name find it by its engine
    const choice = chooseConnection({ projectRoot: root, motor: 'postgres' })
    assert.deepEqual(choice, { name: 'Catalog', exists: true })
    const ok = await useCase(root, { motor: 'postgres' })
    assert.notEqual(ok.isError, true, ok.content[0].text)
    assert.equal(dbFiles(root).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const SPEC = (engine, name) => `module: inventory
entity: Stock
description: x
stack: nestjs
error_prefix: INVENTORY
connection:
${name ? `  name: ${name}\n` : ''}  engine: ${engine}
  style: named
use_cases:
  - name: RetrieveStock
    action: retrieveStock
    resource_type: stock
    adapter: typeorm
    methods:
      - { name: run, request: RetrieveStockRequest, response: Stock }
dtos:
  input: { warehouse: string }
  output: { warehouse: string }
business_rules: { none: true, rules: [] }
complexity: { level: 0, signals: [] }
`

test('a spec may leave the connection unnamed: dry run, generation and inventory agree on the name', async () => {
  const root = await service('postgres')
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(spec, SPEC('postgres'))
    const plan = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: true, overwrite: false })
    assert.notEqual(plan.isError, true, plan.content[0].text)
    assert.match(plan.content[0].text, /conexión: Postgres \(named, PostgreSQL\)/)
    assert.equal(dbFiles(root).length, 1, 'a dry run creates nothing')

    const real = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(real.isError, true, real.content[0].text)
    assert.equal(dbFiles(root).length, 1, 'it reused the connection of the engine')

    const rec = await recordArchitecture({ projectRoot: root, specPath: spec, writeAuditFile: true })
    assert.notEqual(rec.isError, true, rec.content[0].text)
    const inventory = JSON.parse(read(root, 'docs/architecture-inventory.json'))
    assert.equal(inventory.modules.inventory.connection.name, 'Postgres')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a spec for an engine the project does not have yet creates that connection', async () => {
  const root = await service('mssql')
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(spec, SPEC('mysql'))
    const real = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(real.isError, true, real.content[0].text)
    assert.match(read(root, '.env.example'), /^DB_MYSQL_PORT=3306$/m)
    assert.equal(verify(root).errors.length, 0, JSON.stringify(verify(root).errors))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a spec that names an additional connection keeps it (idempotent on a second run)', async () => {
  const root = await service('mssql')
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(spec, SPEC('mssql', 'Mssql2'))
    for (let i = 0; i < 2; i++) {
      const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: true })
      assert.notEqual(r.isError, true, r.content[0].text)
    }
    assert.equal(dbFiles(root).length, 2)
    const env = read(root, '.env.example')
    assert.equal(env.match(/^DB_MSSQL2_HOST=/gm).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inspect_project tells the agent the name each new connection would take', async () => {
  const root = await service('mssql')
  try {
    const text = (await inspectProjectTool({ projectRoot: root })).content[0].text
    assert.match(text, /Conexiones creadas por el MCP: Mssql \(mssql\)/)
    assert.match(text, /mssql -> Mssql2 \| postgres -> Postgres \| mysql -> Mysql/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- refactor: the project already has its connection; it is found and reused, never asked, never created ---

function legacyProject(appModule) {
  const root = mkdtempSync(join(tmpdir(), 'midd-legacy-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'legacy', dependencies: { '@nestjs/core': '^11', typeorm: '^0.3' } }))
  writeFileSync(join(root, 'src/app.module.ts'), appModule)
  return root
}

const ONE_NAMED = `import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
@Module({ imports: [TypeOrmModule.forRoot({ name: 'LegacyConnection', type: 'mssql' })] })
export class AppModule {}
`
const TWO_NAMED = `import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
@Module({ imports: [TypeOrmModule.forRoot({ name: 'LegacyConnection', type: 'mssql' }), TypeOrmModule.forRoot({ name: 'OrdersConnection', type: 'mssql' })] })
export class AppModule {}
`
const PLAIN = `import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
@Module({ imports: [TypeOrmModule.forRoot({ type: 'mssql' })] })
export class AppModule {}
`
const refactorCase = (root, over = {}) => useCase(root, { mode: 'refactor', ...over })
const nothingCreated = (root) => {
  assert.equal(existsSync(join(root, 'src/shared/infrastructure/database-context')), false, 'a refactor never creates a connection')
  assert.equal(existsSync(join(root, '.env.example')), false, 'nor its variables')
}

test('refactor: the only named connection of the project is found and reused, without being told', async () => {
  const root = legacyProject(ONE_NAMED)
  try {
    const r = await refactorCase(root)
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'LegacyConnection'/)
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor: an engine is not needed either, the project owns its connection', async () => {
  const root = legacyProject(ONE_NAMED)
  try {
    const withEngine = await refactorCase(root, { motor: 'postgres' })
    assert.notEqual(withEngine.isError, true, withEngine.content[0].text)
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'LegacyConnection'/, 'the engine does not rename or create anything')
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor: with several named connections the caller says which one the use case works with', async () => {
  const root = legacyProject(TWO_NAMED)
  try {
    const ambiguous = await refactorCase(root)
    assert.equal(ambiguous.isError, true)
    assert.match(ambiguous.content[0].text, /Legacy, Orders/)
    assert.equal(existsSync(join(root, 'src/stock')), false, 'nothing was written')
    const chosen = await refactorCase(root, { conexion: 'Orders' })
    assert.notEqual(chosen.isError, true, chosen.content[0].text)
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'OrdersConnection'/)
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor: the default forRoot connection needs no name at all', async () => {
  const root = legacyProject(PLAIN)
  try {
    const r = await refactorCase(root, { connectionStyle: 'default' })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.doesNotMatch(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /Connection'/, 'adapters inject no connection name')
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor: asking for a named connection the project does not have says so and points to the default style', async () => {
  const root = legacyProject(PLAIN)
  try {
    const r = await refactorCase(root)
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /connectionStyle="default"/)
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor from a spec: no engine and no connection name, the project connection is reused', async () => {
  const root = legacyProject(ONE_NAMED)
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(spec, SPEC('', undefined).replace('  engine: \n', ''))
    const plan = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'refactor', dryRun: true, overwrite: false })
    assert.notEqual(plan.isError, true, plan.content[0].text)
    assert.match(plan.content[0].text, /conexión: Legacy \(named, conexion del proyecto\)/)
    const real = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'refactor', dryRun: false, overwrite: false })
    assert.notEqual(real.isError, true, real.content[0].text)
    nothingCreated(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('greenfield from a spec still has to say the engine: it creates the connection', async () => {
  const root = await service('mssql')
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(spec, SPEC('', undefined).replace('  engine: \n', ''))
    const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: true, overwrite: false })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /connection\.engine es obligatorio/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
