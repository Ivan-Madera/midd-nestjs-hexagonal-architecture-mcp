import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { addAuthorization } from '../dist/tools/addAuthorization.js'
import { generateApiDocsTool } from '../dist/tools/apiDocs.js'
import { recordArchitecture } from '../dist/tools/architecture.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { parseFields, stripComments } from '../dist/lib/apiDocs.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')

async function service({ authorization = false } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-docs-'))
  await scaffoldService({ projectRoot, conexion: 'Catalog', motor: 'postgres', prefijoApi: 'midd-catalog', prefijoError: 'CATALOG', overwrite: true })
  if (authorization) await addAuthorization({ projectRoot, authorizationApiUrl: 'http://127.0.0.1:1/authorization/v1', overwrite: false })
  return projectRoot
}

const useCase = (projectRoot, dominio, caso, adapterType = 'typeorm') =>
  addUseCase({
    projectRoot,
    dominio,
    caso,
    entidad: caso.replace(/^Retrieve/, ''),
    metodo: 'run',
    param: 'sku',
    accion: caso[0].toLowerCase() + caso.slice(1),
    prefijoError: 'CATALOG',
    conexion: 'Catalog',
    motor: 'postgres',
    adapterType,
    nombreSp: adapterType === 'sp' ? 'GetThing' : undefined,
    mode: 'greenfield',
    connectionStyle: 'named',
    infraStyle: 'dataset',
    overwrite: true
  })

test('add_use_case writes the contract and the sequence diagram of the module by itself', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    const api = read(root, 'src/catalog/contracts/catalog.api.md')
    assert.match(api, /POST \/midd-catalog\/api\/v1\/catalog\/retrieveProduct/)
    assert.match(api, /\| `sku` \| `string` \| si \|/, 'the request attributes come from the DTO class')
    assert.match(api, /application\/vnd\.api\+json/)
    assert.doesNotMatch(api, /Authorization: Bearer/, 'no authorization module, no token documented')
    const flow = read(root, 'src/catalog/diagrams/catalog.flow.mmd')
    assert.match(flow, /^%% Generado/m)
    assert.match(flow, /sequenceDiagram/)
    assert.match(flow, /participant D as DB Catalog postgres/, 'the engine of the connection is in the diagram')
    assert.match(flow, /R0->>D: Query via TypeORM/)
    assert.match(read(root, 'docs/api/README.md'), /catalog\.api\.md/)
    assert.equal(existsSync(join(root, 'docs/api/middleware.postman_collection.json')), false, 'Postman is opt-in')
    assert.equal(existsSync(join(root, 'docs/ARCHITECTURE.md')), false, 'architecture-beta is opt-in')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the authorization module is reflected: token in the contract, 401/403 in the diagram, none for public endpoints', async () => {
  const root = await service({ authorization: true })
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    assert.match(read(root, 'src/catalog/contracts/catalog.api.md'), /Authorization: Bearer <token>/)
    assert.match(read(root, 'src/catalog/diagrams/catalog.flow.mmd'), /G-->>C: 401 or 403/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stored procedure adapters use the dialect of the engine in the diagram', async () => {
  const root = await service()
  try {
    await useCase(root, 'inventory', 'RetrieveStock', 'sp')
    assert.match(read(root, 'src/inventory/diagrams/inventory.flow.mmd'), /SELECT \* FROM stored function/, 'postgres calls a function')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Postman: only on request, one folder per module, merging never touches the other folders', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    await useCase(root, 'inventory', 'RetrieveStock')
    const file = join(root, 'docs/api/middleware.postman_collection.json')
    assert.equal(existsSync(file), false)

    const first = await generateApiDocsTool({ projectRoot: root, modules: ['catalog'], postman: true, architecture: false })
    assert.notEqual(first.isError, true)
    let collection = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(collection.item.map((i) => i.name), ['catalog'])
    assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json')
    assert.deepEqual(collection.variable.map((v) => v.key), ['baseUrl'])
    const request = collection.item[0].item[0].request
    assert.equal(request.method, 'POST')
    assert.deepEqual(request.header, [{ key: 'Content-Type', value: 'application/vnd.api+json' }])
    assert.equal(request.url.raw, '{{baseUrl}}/midd-catalog/api/v1/catalog/retrieveProduct')
    assert.deepEqual(JSON.parse(request.body.raw), { data: { type: 'product', attributes: { sku: 'string' } } })

    // a hand-made folder from another team member must survive, and the new module is added next to it
    collection.item.push({ name: 'foreign', item: [{ name: 'keep me' }] })
    writeFileSync(file, JSON.stringify(collection), 'utf8')
    await generateApiDocsTool({ projectRoot: root, modules: ['inventory'], postman: true, architecture: false })
    collection = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(collection.item.map((i) => i.name), ['catalog', 'foreign', 'inventory'])
    assert.deepEqual(collection.item.find((i) => i.name === 'foreign').item, [{ name: 'keep me' }])

    // once the collection exists, any later add_use_case keeps it in step without asking again
    await useCase(root, 'catalog', 'RetrieveOrder')
    collection = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(collection.item.find((i) => i.name === 'catalog').item.length, 2)
    assert.ok(collection.item.some((i) => i.name === 'foreign'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('authorization adds the token header and variable to Postman', async () => {
  const root = await service({ authorization: true })
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    await generateApiDocsTool({ projectRoot: root, postman: true, architecture: false })
    const collection = JSON.parse(read(root, 'docs/api/middleware.postman_collection.json'))
    assert.ok(collection.item[0].item[0].request.header.some((h) => h.key === 'Authorization' && h.value === 'Bearer {{token}}'))
    assert.ok(collection.variable.some((v) => v.key === 'token'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('architecture-beta: opt-in, one node per module, DB with its engine, align only with 2+ modules', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    await generateApiDocsTool({ projectRoot: root, postman: false, architecture: true })
    let doc = read(root, 'docs/ARCHITECTURE.md')
    assert.match(doc, /^architecture-beta$/m)
    assert.match(doc, /service db_Catalog\(database\)\[Catalog postgres\]/)
    assert.doesNotMatch(/```mermaid\n([\s\S]*?)```/.exec(doc)[1], /align column/, 'a single module needs no alignment')

    await useCase(root, 'inventory', 'RetrieveStock')
    doc = read(root, 'docs/ARCHITECTURE.md') // refreshed by add_use_case because it already existed
    assert.match(/```mermaid\n([\s\S]*?)```/.exec(doc)[1], /align column m_catalog m_inventory/)
    assert.match(doc, /POST \/midd-catalog\/api\/v1\/inventory\/retrieveStock/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('record_architecture refreshes the documentation of the module it closes', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    rmSync(join(root, 'src/catalog/contracts'), { recursive: true, force: true })
    const spec = join(root, 'agentic/specs/catalog/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(
      spec,
      `module: catalog\nentity: Product\ndescription: x\nstack: nestjs\nerror_prefix: CATALOG\nconnection:\n  name: Catalog\n  engine: postgres\n  style: named\nuse_cases:\n  - name: RetrieveProduct\n    action: retrieveProduct\n    resource_type: product\n    adapter: typeorm\n    methods:\n      - { name: run, request: RetrieveProductRequest, response: Product }\ndtos:\n  input: { sku: string }\n  output: { id: number }\nbusiness_rules: { none: true, rules: [] }\ncomplexity: { level: 0, signals: [] }\n`
    )
    const out = await recordArchitecture({ projectRoot: root, specPath: spec, writeAuditFile: true })
    assert.match(out.content[0].text, /Documentacion de la API actualizada/)
    assert.ok(existsSync(join(root, 'src/catalog/contracts/catalog.api.md')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('commented-out endpoints and the health probe never reach the documentation', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    const controller = join(root, 'src/catalog/infrastructure/http-server/controllers/retrieveProduct.controller.ts')
    const code = readFileSync(controller, 'utf8')
    writeFileSync(controller, code + "\n// @Post('ghost')\n/* @Post('phantom') */\n", 'utf8')
    await generateApiDocsTool({ projectRoot: root, postman: false, architecture: false })
    const api = read(root, 'src/catalog/contracts/catalog.api.md')
    assert.doesNotMatch(api, /ghost|phantom/)
    assert.doesNotMatch(read(root, 'docs/api/README.md'), /health/)
    assert.equal(existsSync(join(root, 'src/shared/contracts')), false, 'src/shared is not a module')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the tool refuses to run without controllers or for an unknown module', async () => {
  const root = await service()
  try {
    const none = await generateApiDocsTool({ projectRoot: root, postman: false, architecture: false })
    assert.equal(none.isError, true)
    await useCase(root, 'catalog', 'RetrieveProduct')
    const unknown = await generateApiDocsTool({ projectRoot: root, modules: ['nope'], postman: false, architecture: false })
    assert.equal(unknown.isError, true)
    assert.match(unknown.content[0].text, /catalog/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('same code gives the same files (deterministic, nothing rewritten the second time)', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    const again = await generateApiDocsTool({ projectRoot: root, postman: true, architecture: true })
    const second = await generateApiDocsTool({ projectRoot: root, postman: true, architecture: true })
    assert.match(again.content[0].text, /Escritos/)
    assert.doesNotMatch(second.content[0].text, /Escritos \([1-9]/, 'second run writes nothing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generate_from_spec leaves the documentation ready too', async () => {
  const root = await service()
  try {
    const spec = join(root, 'agentic/specs/inventory/input/specs/middleware.spec.yaml')
    mkdirSync(join(spec, '..'), { recursive: true })
    writeFileSync(
      spec,
      `module: inventory\nentity: Stock\ndescription: x\nstack: nestjs\nerror_prefix: INVENTORY\nconnection:\n  name: Catalog\n  engine: postgres\n  style: named\nuse_cases:\n  - name: RetrieveStock\n    action: retrieveStock\n    resource_type: stock\n    adapter: typeorm\n    methods:\n      - { name: run, request: RetrieveStockRequest, response: Stock }\ndtos:\n  input: { warehouse: string }\n  output: { warehouse: string, quantity: number }\nbusiness_rules: { none: true, rules: [] }\ncomplexity: { level: 0, signals: [] }\n`
    )
    const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(r.isError, true, r.content[0].text)
    const api = read(root, 'src/inventory/contracts/inventory.api.md')
    assert.match(api, /\| `warehouse` \| `string` \| si \|/)
    assert.match(api, /\| `quantity` \| `number` \|/, 'the response comes from the domain entity')
    assert.match(api, /INVENTORY-/, 'the error catalog of the module is listed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards warns (never blocks) when the documentation is missing or stale', async () => {
  const root = await service()
  try {
    await useCase(root, 'catalog', 'RetrieveProduct')
    const run = () => {
      const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
      const text = r.stdout
      return JSON.parse(text.slice(text.indexOf('{')))
    }
    let report = run()
    assert.deepEqual(report.warnings.filter((w) => w.rule.startsWith('API_DOCS')), [], 'docs generated => no warning')

    const api = join(root, 'src/catalog/contracts/catalog.api.md')
    writeFileSync(api, readFileSync(api, 'utf8').replace(/retrieveProduct/g, 'renamed'), 'utf8')
    report = run()
    assert.ok(report.warnings.some((w) => w.rule === 'API_DOCS_STALE'))
    assert.equal(report.errors.some((e) => e.rule.startsWith('API_DOCS')), false, 'documentation never blocks')

    rmSync(join(root, 'src/catalog/diagrams'), { recursive: true, force: true })
    rmSync(api)
    report = run()
    assert.ok(report.warnings.filter((w) => w.rule === 'API_DOCS_MISSING').length >= 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parser helpers: comments are ignored, optional fields detected', () => {
  assert.equal(stripComments("const a = 'http://x' // tail\n/* gone */ b"), "const a = 'http://x' \n b")
  const fields = parseFields(
    "export class A {\n  @IsString()\n  name: string\n  // hidden: string\n  @IsOptional()\n  @IsNumber()\n  age: number\n  nick?: string\n}\n",
    'A'
  )
  assert.deepEqual(fields, [
    { name: 'name', type: 'string', required: true },
    { name: 'age', type: 'number', required: false },
    { name: 'nick', type: 'string', required: false }
  ])
})
