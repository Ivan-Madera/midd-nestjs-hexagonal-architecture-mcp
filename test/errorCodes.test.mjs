import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { nextErrorNumbers, usedErrorNumbers, formatErrorNumber, ErrorCodesExhausted, ERROR_CODE_MAX } from '../dist/lib/errorCodes.js'
import { buildGuard } from '../dist/lib/businessRules.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const codesIn = (text) => [...text.matchAll(/code: '([A-Z0-9_]+-[A-Z0-9_]+-\d+)'/g)].map((m) => m[1])
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}

async function service(prefix = 'CAT') {
  const root = mkdtempSync(join(tmpdir(), 'midd-errs-'))
  const r = await scaffoldService({ projectRoot: root, motor: 'mssql', prefijoApi: 'midd-catalog', prefijoError: prefix, overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}

const useCase = (root, over = {}) =>
  addUseCase({
    projectRoot: root, dominio: 'catalog', caso: 'RetrieveProduct', entidad: 'Product', metodo: 'run', param: 'sku', accion: 'retrieveProduct',
    prefijoError: 'CAT', motor: 'mssql', adapterType: 'typeorm', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: false, ...over
  })

const allCodes = (root) => {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.error\.ts$/.test(e.name) && /core/.test(full)) out.push(...codesIn(readFileSync(full, 'utf8')))
    }
  }
  walk(join(root, 'src'))
  return out
}

test('the number has three digits and runs from 001 to 999', () => {
  assert.equal(formatErrorNumber(1), '001')
  assert.equal(formatErrorNumber(42), '042')
  assert.equal(formatErrorNumber(999), '999')
  assert.equal(ERROR_CODE_MAX, 999)
})

test('a new API: the first case takes 001 (application) and 002 (domain), with the descriptive slug', async () => {
  const root = await service()
  try {
    const r = await useCase(root)
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.deepEqual(codesIn(read(root, 'src/catalog/core/application/errors/catalog.application.error.ts')), ['CAT-PRODUCT-001', 'CAT-GENERICERROR-000'])
    assert.deepEqual(codesIn(read(root, 'src/catalog/core/domain/errors/catalog.domain.error.ts')), ['CAT-PRODUCT-002', 'CAT-GENERICERROR-000'])
    assert.deepEqual(usedErrorNumbers(root, 'CAT'), [0, 1, 2].filter(Boolean))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every error is numbered in sequence per prefix, across cases and domains: never two with the same number', async () => {
  const root = await service()
  try {
    await useCase(root)
    // another case of the SAME domain, another entity: its entries are added to the catalogs that already exist
    const second = await useCase(root, { caso: 'RetrieveCategory', entidad: 'Category', accion: 'retrieveCategory' })
    assert.notEqual(second.isError, true, second.content[0].text)
    // and a case of another domain
    const third = await useCase(root, { dominio: 'orders', caso: 'RetrieveOrder', entidad: 'Order', accion: 'retrieveOrder' })
    assert.notEqual(third.isError, true, third.content[0].text)

    const codes = allCodes(root).filter((c) => !/-000$/.test(c))
    assert.deepEqual(
      codes.map((c) => Number(c.split('-').pop())).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6],
      JSON.stringify(codes)
    )
    assert.equal(new Set(codes).size, codes.length)
    const domain = read(root, 'src/catalog/core/domain/errors/catalog.domain.error.ts')
    assert.match(domain, /'CATEGORY_ERROR': \{[\s\S]*?code: 'CAT-CATEGORY-00\d'/, 'the second case has its own entry in the catalog')
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('two prefixes count apart, and a case that repeats an entity reuses its key instead of taking another number', async () => {
  const root = await service()
  try {
    await useCase(root)
    await useCase(root, { prefijoError: 'BIL', dominio: 'billing', caso: 'RetrieveInvoice', entidad: 'Invoice', accion: 'retrieveInvoice' })
    assert.deepEqual(usedErrorNumbers(root, 'BIL'), [1, 2], 'another prefix starts again at 001')
    assert.deepEqual(usedErrorNumbers(root, 'CAT'), [1, 2])
    const before = allCodes(root).length
    await useCase(root, { caso: 'RetrieveProductByBarcode', accion: 'retrieveProductByBarcode' }) // same entity, same key
    assert.equal(allCodes(root).length, before, 'no duplicate entry for an existing key')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('business rules take the next free numbers, not a number per position', async () => {
  const root = await service()
  try {
    const spec = join(root, 'spec.yaml')
    writeFileSync(
      spec,
      [
        'module: catalog', 'entity: Product', 'description: x', 'stack: nestjs', 'error_prefix: CAT',
        'connection:', '  engine: mssql', '  style: named',
        'use_cases:', '  - name: RetrieveProduct', '    action: retrieveProduct', '    resource_type: product', '    adapter: typeorm',
        '    methods:', '      - { name: run, request: RetrieveProductRequest, response: Product }',
        'dtos:', '  input: { sku: string }', '  output: { sku: string }',
        'business_rules:', '  none: false', '  rules:', '    - "sku es obligatorio"', '    - "el producto debe existir (404 si no se encuentra)"',
        'complexity: { level: 0, signals: [] }', ''
      ].join('\n')
    )
    const r = await generateFromSpec({ projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(r.isError, true, r.content[0].text)
    const application = read(root, 'src/catalog/core/application/services/retrieve-product.application.ts')
    const numbers = [...application.matchAll(/code: 'CAT-[A-Z0-9]+-(\d{3})'/g)].map((m) => Number(m[1]))
    assert.deepEqual(numbers, [3, 4], 'after the 001 and 002 of the case itself')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('buildGuard keeps working on its own: the number is the position unless it is given', () => {
  assert.ok(buildGuard('sku es obligatorio', 2, 'CAT').snippet.includes('-003'))
  assert.ok(buildGuard('sku es obligatorio', 0, 'CAT', 41).snippet.includes('-041'))
})

test('the shared layer speaks the same format: three digits', async () => {
  const root = await service()
  try {
    const shared = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (full.endsWith('.ts')) shared.push(...[...readFileSync(full, 'utf8').matchAll(/'(SERVICE-[A-Z_]+-\d+)'/g)].map((m) => m[1]))
      }
    }
    walk(join(root, 'src/shared'))
    assert.ok(shared.length >= 8)
    for (const code of shared) assert.match(code, /^SERVICE-[A-Z_]+-\d{3}$/, code)
    assert.ok(shared.includes('SERVICE-BADREQUEST-016'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('codes written by an older MCP with four digits still count, so the next one does not collide', () => {
  const root = mkdtempSync(join(tmpdir(), 'midd-legacy-codes-'))
  try {
    mkdirSync(join(root, 'src/old'), { recursive: true })
    writeFileSync(join(root, 'src/old/old.error.ts'), "export const E = { a: { code: 'CAT-OLD-0007' }, b: { code: 'CAT-OLD-0002' } }\n// { code: 'CAT-HIDDEN-0009' }\n")
    assert.deepEqual(usedErrorNumbers(root, 'CAT'), [2, 7, 9], 'a commented code counts too: it will be uncommented one day')
    assert.deepEqual(nextErrorNumbers(root, 'CAT', 2), [10, 11])
    assert.deepEqual(nextErrorNumbers(root, 'OTHER', 1), [1])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('when a prefix runs out of numbers the MCP says so and writes nothing', async () => {
  const root = await service()
  try {
    mkdirSync(join(root, 'src/full'), { recursive: true })
    writeFileSync(join(root, 'src/full/full.ts'), "export const x = 'CAT-LAST-999'\n")
    assert.throws(() => nextErrorNumbers(root, 'CAT', 1), (e) => e instanceof ErrorCodesExhausted && /Usa otro prefijo/.test(e.message))
    const r = await useCase(root)
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /Se agotaron los codigos de error del prefijo CAT/)
    assert.equal(existsSync(join(root, 'src/catalog')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards: a repeated number under a prefix is an error, a four digit number is a warning', async () => {
  const root = await service()
  try {
    await useCase(root)
    assert.equal(verify(root).errors.some((e) => e.rule === 'ERROR_CODE_DUPLICATE'), false)
    const domain = join(root, 'src/catalog/core/domain/errors/catalog.domain.error.ts')
    const text = readFileSync(domain, 'utf8')

    writeFileSync(domain, text.replace('CAT-PRODUCT-002', 'CAT-PRODUCT-001'), 'utf8') // repeats the application one
    const dup = verify(root).errors.filter((e) => e.rule === 'ERROR_CODE_DUPLICATE')
    assert.equal(dup.length, 1)
    assert.match(dup[0].message, /repeats the number 001 of the prefix CAT/)

    writeFileSync(domain, text.replace('CAT-PRODUCT-002', 'CAT-PRODUCT-0002'), 'utf8')
    const report = verify(root)
    assert.equal(report.errors.some((e) => e.rule === 'ERROR_CODE_DUPLICATE'), false)
    assert.ok(report.warnings.some((w) => w.rule === 'ERROR_CODE_FORMAT'), 'four digits warn')

    // the generic fallback (000) and a commented code never count
    writeFileSync(domain, text + "\n// code: 'CAT-PRODUCT-001'\n", 'utf8')
    assert.equal(verify(root).errors.some((e) => e.rule === 'ERROR_CODE_DUPLICATE'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
