import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { toKebab, toPascal, toCamel, toUpperSnake, domainFolder, nameWords, isKebabFileName } from '../dist/lib/names.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return { ...JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))), status: r.status }
}
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

async function service() {
  const root = mkdtempSync(join(tmpdir(), 'midd-naming-'))
  const r = await scaffoldService({ projectRoot: root, motor: 'none', prefijoApi: 'midd-store', prefijoError: 'STORE', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}

const apiCase = (root, over = {}) =>
  addUseCase({
    projectRoot: root, dominio: 'store-configuration', caso: 'RetrieveExchangeRate', entidad: 'ExchangeRate', metodo: 'retrieveExchangeRate',
    param: 'currency', accion: 'retrieveExchangeRate', prefijoError: 'STORE', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates',
    mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: false, ...over
  })

test('names: one convention for files (kebab), classes (Pascal), variables (camel) and constants (UPPER_SNAKE)', () => {
  assert.deepEqual(nameWords('RetrieveIMEIStatus'), ['retrieve', 'imei', 'status'])
  assert.equal(toKebab('RetrieveIMEIStatus'), 'retrieve-imei-status')
  assert.equal(toKebab('store-configuration'), 'store-configuration')
  assert.equal(toKebab('StoreConfiguration'), 'store-configuration')
  assert.equal(toPascal('store-configuration'), 'StoreConfiguration')
  assert.equal(toPascal('RetrieveIMEIStatus'), 'RetrieveIMEIStatus', 'an acronym stays an acronym')
  assert.equal(toPascal('catalog'), 'Catalog')
  assert.equal(toCamel('store-configuration'), 'storeConfiguration')
  assert.equal(toUpperSnake('RetrieveProduct'), 'RETRIEVE_PRODUCT')
  assert.equal(domainFolder('StoreConfiguration'), 'store-configuration')
  assert.equal(isKebabFileName('retrieve-product.controller.ts'), true)
  assert.equal(isKebabFileName('retrieveProduct.controller.ts'), false)
  assert.equal(isKebabFileName('Product.entity.ts'), false)
})

test('a module of several words generates valid identifiers, kebab-case files and a clean verifier', async () => {
  const root = await service()
  try {
    const r = await apiCase(root)
    assert.notEqual(r.isError, true, r.content[0].text)

    // Folders and files: kebab-case with a dotted suffix, in the area layout.
    const dom = 'src/store-configuration'
    for (const file of [
      'store-configuration.module.ts',
      'core/store-configuration.core.module.ts',
      'core/domain/ports/inbound/retrieve-exchange-rate.inbound.port.ts',
      'core/domain/ports/outbound/retrieve-exchange-rate.outbound.port.ts',
      'core/domain/services/retrieve-exchange-rate.domain.service.ts',
      'core/domain/entities/exchange-rate.entity.ts',
      'core/domain/errors/store-configuration.domain.error.ts',
      'core/application/interfaces/retrieve-exchange-rate.application.interface.ts',
      'core/application/services/retrieve-exchange-rate.application.ts',
      'core/application/errors/store-configuration.application.error.ts',
      'infrastructure/store-configuration.infrastructure.module.ts',
      'infrastructure/adapters/retrieve-exchange-rate.http.adapter.ts',
      'infrastructure/http-server/controllers/retrieve-exchange-rate.controller.ts',
      'infrastructure/http-server/dto/retrieve-exchange-rate.dto.ts',
      'infrastructure/http-server/dto/retrieve-exchange-rate-request-json-api.dto.ts'
    ]) {
      assert.ok(existsSync(join(root, dom, file)), `missing ${dom}/${file}`)
    }

    // Classes: PascalCase, no dash in any identifier.
    const everything = walk(join(root, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n')
    assert.match(everything, /export class StoreConfigurationModule/)
    assert.match(everything, /export class StoreConfigurationCoreModule/)
    assert.match(everything, /export class InfrastructureStoreConfigurationModule/)
    assert.match(everything, /export class RetrieveExchangeRateController/)
    assert.doesNotMatch(everything, /(class|interface|const|import \{)\s+\w*-\w*/, 'a dash would not compile as an identifier')
    assert.match(read(root, 'src/app.module.ts'), /from '\.\/store-configuration\/store-configuration\.module'/)

    // The URL and the JSON:API type follow the kebab-case rule.
    const controller = read(root, `${dom}/infrastructure/http-server/controllers/retrieve-exchange-rate.controller.ts`)
    assert.match(controller, /path: 'store-configuration'/)
    assert.match(controller, /type: 'exchange-rate'/)

    // The standard is checked by the verifier too: nothing generated breaks it.
    const { errors, warnings } = verify(root)
    assert.deepEqual(errors, [])
    assert.deepEqual(warnings.filter((w) => w.rule === 'NAMING_FILE_CASE'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a second use case in a multi-word module is merged with the kebab-case file names', async () => {
  const root = await service()
  try {
    assert.notEqual((await apiCase(root)).isError, true)
    const second = await apiCase(root, { caso: 'ConvertExchangeRate', metodo: 'convertExchangeRate', accion: 'convertExchangeRate', rutaApi: '/convert' })
    assert.notEqual(second.isError, true, second.content[0].text)
    const dom = 'src/store-configuration'
    const core = read(root, `${dom}/core/store-configuration.core.module.ts`)
    assert.match(core, /from '\.\/domain\/ports\/inbound\/convert-exchange-rate\.inbound\.port'/)
    assert.match(core, /from '\.\/domain\/ports\/outbound\/convert-exchange-rate\.outbound\.port'/)
    assert.match(core, /from '\.\/application\/services\/convert-exchange-rate\.application'/)
    assert.match(read(root, `${dom}/infrastructure/store-configuration.infrastructure.module.ts`), /convert-exchange-rate\.http\.adapter/)
    assert.match(read(root, `${dom}/infrastructure/http-server/http-server.module.ts`), /controllers\/convert-exchange-rate\.controller/)
    assert.deepEqual(verify(root).errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the JSON:API type is the one given (the resource_type of the spec), the kebab-case entity otherwise', async () => {
  const root = await service()
  try {
    const r = await apiCase(root, { tipoRecurso: 'fx-rate' })
    assert.notEqual(r.isError, true, r.content[0].text)
    assert.match(
      read(root, 'src/store-configuration/infrastructure/http-server/controllers/retrieve-exchange-rate.controller.ts'),
      /type: 'fx-rate'/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a domain written with the previous layout is not mixed with the new one: add_use_case refuses and writes nothing', async () => {
  const root = await service()
  try {
    const legacy = join(root, 'src/orders/infrastructure')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'infrastructure.orders.module.ts'), 'export class InfrastructureOrdersModule {}\n', 'utf8')
    const r = await apiCase(root, { dominio: 'orders', caso: 'RetrieveOrder', entidad: 'Order', metodo: 'retrieveOrder', accion: 'retrieveOrder' })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /estructura anterior/)
    assert.equal(existsSync(join(root, 'src/orders/orders.module.ts')), false, 'nothing was generated')
    assert.equal(existsSync(join(root, 'src/orders/core')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards warns (never blocks) about a file or folder that is not kebab-case', async () => {
  const root = await service()
  try {
    mkdirSync(join(root, 'src/billing/Core'), { recursive: true })
    writeFileSync(join(root, 'src/billing/Core/retrieveInvoice.service.ts'), 'export class RetrieveInvoiceService {}\n', 'utf8')
    const { errors, warnings, status } = verify(root)
    assert.equal(status, 0, 'a naming warning must not fail the build')
    assert.deepEqual(errors, [])
    const naming = warnings.filter((w) => w.rule === 'NAMING_FILE_CASE')
    assert.ok(naming.length >= 1, 'expected NAMING_FILE_CASE')
    assert.match(naming[0].message, /kebab-case/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
