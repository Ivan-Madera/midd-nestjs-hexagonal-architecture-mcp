import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recordInventory, writeAudit } from '../dist/lib/inventory.js'

const root = join(tmpdir(), `mcp-inv-test-${process.pid}`)

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function entry(module, entity) {
  return {
    module,
    entity,
    stack: 'nestjs',
    connection: { name: entity, style: 'named' },
    complexity: { level: 0, signals: [] },
    useCases: [{ name: `Create${entity}`, adapter: 'sp', methods: [{ name: 'create', request: `${entity}Req`, response: entity, sp: `Create${entity}` }] }],
    businessRules: []
  }
}

test('recordInventory crea el envelope y agrega una entrada', () => {
  const r = recordInventory({ projectRoot: root, entry: entry('catalog', 'Product') })
  assert.equal(r.created, true)
  const json = JSON.parse(readFileSync(r.file, 'utf8'))
  assert.ok(json.mcpVersion)
  assert.ok(json.generatedAt)
  assert.ok(json.modules.catalog)
  assert.equal(json.modules.catalog.entity, 'Product')
})

test('recordInventory agrega un 2º módulo sin tocar el 1º', () => {
  recordInventory({ projectRoot: root, entry: entry('catalog', 'Product') })
  const r2 = recordInventory({ projectRoot: root, entry: entry('clientes', 'Cliente') })
  assert.equal(r2.created, false)
  const json = JSON.parse(readFileSync(r2.file, 'utf8'))
  assert.ok(json.modules.catalog, 'catalog debe seguir presente')
  assert.ok(json.modules.clientes, 'clientes debe estar presente')
  assert.equal(Object.keys(json.modules).length, 2)
})

test('recordInventory reemplaza la entrada del mismo módulo', () => {
  recordInventory({ projectRoot: root, entry: entry('catalog', 'Product') })
  const r = recordInventory({ projectRoot: root, entry: { ...entry('catalog', 'Product'), description: 'nueva' } })
  assert.equal(r.replaced, true)
  const json = JSON.parse(readFileSync(r.file, 'utf8'))
  assert.equal(json.modules.catalog.description, 'nueva')
  assert.equal(Object.keys(json.modules).length, 1)
})

test('writeAudit escribe un markdown con la versión del MCP', () => {
  const a = writeAudit({ projectRoot: root, entry: entry('catalog', 'Product'), compliance: 'OK', buildStatus: 'build OK' })
  const md = readFileSync(a.file, 'utf8')
  assert.ok(md.includes('# Auditoría — módulo `catalog`'))
  assert.ok(md.includes('midd-nestjs-hexagonal-architecture-mcp v'))
  assert.ok(md.includes('build OK'))
})
