import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { toPropertyName } from '../dist/lib/names.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')

test('property names: camelCase, the words stay as they come', () => {
  assert.equal(toPropertyName('tipo_bloqueo'), 'tipoBloqueo')
  assert.equal(toPropertyName('PFM_Id'), 'pfmId')
  assert.equal(toPropertyName('PfmLockTypeKey'), 'pfmLockTypeKey')
  assert.equal(toPropertyName('IMEIStatus'), 'imeiStatus')
  assert.equal(toPropertyName('sku'), 'sku')
  assert.equal(toPropertyName('fecha_alta'), 'fechaAlta', 'Spanish words are kept, only the case changes')
})

async function generate(adapter, extra = []) {
  const root = mkdtempSync(join(tmpdir(), 'midd-map-'))
  await scaffoldService({ projectRoot: root, conexion: 'Mssql', motor: 'mssql', prefijoApi: 'svc', prefijoError: 'CATALOG', overwrite: true })
  const specPath = join(root, 'middleware.spec.yaml')
  writeFileSync(
    specPath,
    [
      'module: catalog', 'entity: Product', 'stack: nestjs', 'error_prefix: CATALOG',
      'connection: { name: Mssql, style: named, engine: mssql }',
      'use_cases:',
      '  - name: RetrieveProduct',
      '    action: retrieveProduct',
      '    resource_type: product',
      `    adapter: ${adapter}`,
      '    methods:',
      `      - { name: retrieveBySku, request: RetrieveProductRequest, response: Product${adapter === 'sp' ? ', sp: GetProductBySku' : ''} }`,
      'dtos:',
      '  input: { sku: string }',
      '  output: { tipo_bloqueo: number, PFM_Id: number, nombre: string }',
      'business_rules: { none: true, rules: [] }',
      ...extra
    ].join('\n'),
    'utf8'
  )
  const r = await generateFromSpec({ projectRoot: root, specPath, mode: 'greenfield', dryRun: false, overwrite: false })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}

test('stored procedure: the response entity exposes the column names, with camelCase properties, and the adapter maps with Mapper', async () => {
  const root = await generate('sp')
  try {
    const entity = read(root, 'src/catalog/core/domain/entities/product.entity.ts')
    assert.match(entity, /^import \{ Expose \} from 'class-transformer'/m, 'a real import, not the one in the template comment')
    assert.match(entity, /@Expose\(\{ name: 'tipo_bloqueo' \}\)\s+tipoBloqueo\?: number/)
    assert.match(entity, /@Expose\(\{ name: 'PFM_Id' \}\)\s+pfmId\?: number/)
    assert.match(entity, /@Expose\(\)\s+nombre\?: string/)
    const adapter = read(root, 'src/catalog/infrastructure/adapters/retrieve-product.sp.adapter.ts')
    assert.match(adapter, /Mapper\(\s*Product,/)
    assert.doesNotMatch(adapter, /as unknown as/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('TypeORM: @Column keeps the column name, the properties are camelCase, the domain entity uses @Expose() and Mapper', async () => {
  const root = await generate('typeorm')
  try {
    const orm = read(root, 'src/catalog/infrastructure/sql-database/entities/product.entity.ts')
    assert.match(orm, /@Column\(\{ name: 'tipo_bloqueo' \}\)\s+tipoBloqueo: number/)
    assert.match(orm, /@Column\(\{ name: 'PFM_Id' \}\)\s+pfmId: number/)
    const entity = read(root, 'src/catalog/core/domain/entities/product.entity.ts')
    assert.match(entity, /@Expose\(\)\s+tipoBloqueo\?: number/)
    assert.doesNotMatch(entity.replace(/^\s*\/\/.*$/gm, ''), /@Expose\(\{ name:/, 'same property names on both sides: no rename needed')
    const adapter = read(root, 'src/catalog/infrastructure/adapters/retrieve-product.typeorm.adapter.ts')
    assert.match(adapter, /return Mapper\(Product, row\)/)
    assert.doesNotMatch(adapter, /as unknown as/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards warns about casting a row with "as unknown as" in an adapter', async () => {
  const root = await generate('typeorm')
  try {
    const file = join(root, 'src/catalog/infrastructure/adapters/retrieve-product.typeorm.adapter.ts')
    writeFileSync(file, readFileSync(file, 'utf8').replace('Mapper(Product, row)', '({ ...row } as unknown as Product)'), 'utf8')
    const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
    assert.ok(report.warnings.some((w) => w.rule === 'BLIND_CAST'), 'expected BLIND_CAST')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
