import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { listConnections } from '../dist/lib/connections.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix))
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}
const useCase = (projectRoot, over = {}) =>
  addUseCase({
    projectRoot, dominio: 'stock', caso: 'RetrieveStock', entidad: 'Stock', metodo: 'run', param: 'sku', accion: 'retrieveStock',
    prefijoError: 'DEMO', adapterType: 'typeorm', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: true, ...over
  })

// --- a NEW service whose user answers "no database" ----------------------------------------------------

async function noDbService() {
  const root = tmp('midd-nodb-')
  const r = await scaffoldService({ projectRoot: root, motor: 'none', prefijoApi: 'midd-demo', prefijoError: 'DEMO', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return { root, report: r.content[0].text }
}

test('"none": no connection of any engine is generated', async () => {
  const { root, report } = await noDbService()
  try {
    assert.equal(existsSync(join(root, 'src/shared/infrastructure/database-context/mssql.database.module.ts')), false)
    const dbDir = join(root, 'src/shared/infrastructure/database-context')
    const modules = existsSync(dbDir) ? readdirSync(dbDir).filter((f) => f.endsWith('.module.ts')) : []
    assert.deepEqual(modules, [], 'no database module')
    assert.deepEqual(listConnections(root), [])
    const env = read(root, '.env.example')
    assert.doesNotMatch(env, /DB_|Database connection/, 'no DB variables')
    assert.match(env, /# --- Server ---/)
    assert.match(env, /# --- CORS ---/)
    assert.match(env, /# --- Ratelimit ---/)
    const pkg = JSON.parse(read(root, 'package.json'))
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const driver of ['mssql', 'pg', 'mysql2']) assert.equal(driver in all, false, `${driver} is not a dependency`)
    const app = read(root, 'src/app.module.ts')
    assert.doesNotMatch(app, /DatabaseModule/)
    assert.match(report, /SIN base de datos/)
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('"none": the TypeORM and SP adapters are refused, nothing is written, and the engine is asked again if the answer changes', async () => {
  const { root } = await noDbService()
  try {
    const refused = await useCase(root, { motor: 'none' })
    assert.equal(refused.isError, true)
    assert.match(refused.content[0].text, /SIN base de datos/)
    assert.equal(existsSync(join(root, 'src/stock')), false)

    const unasked = await useCase(root, {})
    assert.equal(unasked.isError, true, 'without an engine it does not guess')
    assert.match(unasked.content[0].text, /motor/)

    // the user changes his mind and names an engine: THEN the connection is created, named after it
    const later = await useCase(root, { motor: 'postgres' })
    assert.notEqual(later.isError, true, later.content[0].text)
    assert.match(read(root, '.env.example'), /^DB_POSTGRES_PORT=5432$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const SPEC = (engine, extra = '') => `module: inventory
entity: Stock
description: x
stack: nestjs
error_prefix: INVENTORY
connection:
  engine: ${engine}
${extra}  style: named
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

test('"none" in a greenfield spec stops before generating anything, also in a dry run', async () => {
  const { root } = await noDbService()
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(spec, SPEC('none'))
    for (const dryRun of [true, false]) {
      const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun, overwrite: false })
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /SIN base de datos/)
    }
    assert.equal(existsSync(join(root, 'src/inventory')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- REFACTOR: a connection is never generated unless the user explicitly asks for one ------------------

function projectWithout(connection) {
  const root = tmp('midd-refactor-')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'legacy', dependencies: { '@nestjs/core': '^11' } }))
  writeFileSync(
    join(root, 'src/app.module.ts'),
    `import { Module } from '@nestjs/common'\nimport { TypeOrmModule } from '@nestjs/typeorm'\n@Module({ imports: [${connection}] })\nexport class AppModule {}\n`
  )
  return root
}
const refactor = (root, over = {}) => useCase(root, { mode: 'refactor', ...over })
const noConnectionFiles = (root) => {
  assert.equal(existsSync(join(root, 'src/shared')), false, 'nothing generated for a connection')
  assert.equal(existsSync(join(root, '.env.example')), false)
}

test('refactor without a connection: it is NOT generated, the error explains how to ask for one', async () => {
  const root = projectWithout('')
  try {
    const r = await refactor(root)
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /NO crea una por su cuenta/)
    assert.match(r.content[0].text, /crearConexion=true/)
    // an engine alone is not an explicit request: it would be a reflex of the agent
    const withEngine = await refactor(root, { motor: 'mssql' })
    assert.equal(withEngine.isError, true)
    assert.equal(existsSync(join(root, 'src/stock')), false)
    noConnectionFiles(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor, explicit request without an engine: the engine is asked, still nothing is created', async () => {
  const root = projectWithout('')
  try {
    const r = await refactor(root, { crearConexion: true })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /falta el motor/)
    assert.equal(existsSync(join(root, 'src/stock')), false)
    noConnectionFiles(root)
    const none = await refactor(root, { crearConexion: true, motor: 'none' })
    assert.equal(none.isError, true, 'an explicit request with "none" is a contradiction, nothing is created')
    noConnectionFiles(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor, explicit request with the engine: the connection is created, named after the engine, and used', async () => {
  const root = projectWithout('')
  try {
    const r = await refactor(root, { crearConexion: true, motor: 'postgres' })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.match(r.content[0].text, /Conexión nueva "Postgres"/)
    assert.match(r.content[0].text, /REFACTOR: la conexión se creó porque el usuario la pidió expresamente/)
    const env = read(root, '.env.example')
    assert.match(env, /^DB_POSTGRES_PORT=5432$/m)
    assert.deepEqual(listConnections(root), [{ name: 'Postgres', motor: 'postgres' }])
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'PostgresConnection'/)
    // asking again does not create a second one
    const again = await refactor(root, { crearConexion: true, motor: 'postgres', dominio: 'billing', caso: 'RetrieveInvoice', entidad: 'Invoice', accion: 'retrieveInvoice' })
    assert.notEqual(again.isError, true, again.content[0].text)
    assert.equal(listConnections(root).length, 1)
    assert.equal(read(root, '.env.example').match(/^DB_POSTGRES_HOST=/gm).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor, explicit request in a project that already has its own connection: the new one is added next to it', async () => {
  const root = projectWithout("TypeOrmModule.forRoot({ name: 'LegacyConnection', type: 'mssql' })")
  try {
    const plain = await refactor(root, { dominio: 'orders', caso: 'RetrieveOrder', entidad: 'Order', accion: 'retrieveOrder' })
    assert.notEqual(plain.isError, true, plain.content[0].text)
    assert.match(read(root, 'src/orders/infrastructure/orders.infrastructure.module.ts'), /'LegacyConnection'/, 'without the request the project connection is reused')
    assert.deepEqual(listConnections(root), [], 'and nothing is created')

    const asked = await refactor(root, { crearConexion: true, motor: 'mysql' })
    assert.notEqual(asked.isError, true, asked.content[0].text)
    assert.deepEqual(listConnections(root), [{ name: 'Mysql', motor: 'mysql' }])
    assert.match(read(root, 'src/stock/infrastructure/stock.infrastructure.module.ts'), /'MysqlConnection'/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refactor from a spec: "create: true" with the engine creates it; "none" or no engine reuses the project one', async () => {
  const withCreate = projectWithout('')
  const reuse = projectWithout("TypeOrmModule.forRoot({ name: 'LegacyConnection', type: 'mssql' })")
  try {
    const spec1 = join(withCreate, 'spec.yaml')
    writeFileSync(spec1, SPEC('mysql', '  create: true\n'))
    const made = await generateFromSpec({ projectRoot: withCreate, specPath: spec1, mode: 'refactor', dryRun: false, overwrite: false })
    assert.notEqual(made.isError, true, made.content[0].text)
    assert.deepEqual(listConnections(withCreate), [{ name: 'Mysql', motor: 'mysql' }])

    const spec2 = join(reuse, 'spec.yaml')
    writeFileSync(spec2, SPEC('none'))
    const reused = await generateFromSpec({ projectRoot: reuse, specPath: spec2, mode: 'refactor', dryRun: false, overwrite: false })
    assert.notEqual(reused.isError, true, reused.content[0].text)
    assert.deepEqual(listConnections(reuse), [])
    assert.match(read(reuse, 'src/inventory/infrastructure/inventory.infrastructure.module.ts'), /'LegacyConnection'/)
  } finally {
    rmSync(withCreate, { recursive: true, force: true })
    rmSync(reuse, { recursive: true, force: true })
  }
})

test('refactor from a spec without a connection and without "create": not generated, nothing written', async () => {
  const root = projectWithout('')
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(spec, SPEC('mssql'))
    const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'refactor', dryRun: false, overwrite: false })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /NO crea una por su cuenta/)
    assert.equal(existsSync(join(root, 'src/inventory')), false)
    noConnectionFiles(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
