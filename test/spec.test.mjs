import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpec, SpecValidationError } from '../dist/lib/spec.js'

const baseValid = {
  module: 'catalog',
  entity: 'Product',
  description: 'x',
  stack: 'nestjs',
  error_prefix: 'CATALOG',
  connection: { name: 'Catalog', style: 'named', engine: 'mssql' },
  use_cases: [
    {
      name: 'RetrieveProduct',
      action: 'retrieveProduct',
      resource_type: 'product',
      adapter: 'sp',
      methods: [{ name: 'retrieveBySku', request: 'RetrieveProductRequest', response: 'Product', sp: 'GetProductBySku' }]
    }
  ],
  business_rules: { none: true, rules: [] }
}

test('validateSpec acepta un spec válido y normaliza', () => {
  const spec = validateSpec(baseValid)
  assert.equal(spec.module, 'catalog')
  assert.equal(spec.entity, 'Product')
  assert.equal(spec.stack, 'nestjs')
  assert.equal(spec.useCases.length, 1)
  assert.equal(spec.useCases[0].methods[0].sp, 'GetProductBySku')
  assert.equal(spec.connection.style, 'named')
})

test('validateSpec rechaza naming incorrecto y acumula problemas', () => {
  try {
    validateSpec({
      ...baseValid,
      module: 'Catalog', // debe ser kebab
      entity: 'product', // debe ser Pascal
      stack: 'java', // no soportado
      error_prefix: 'catalog' // debe ser MAYUS
    })
    assert.fail('debió lanzar SpecValidationError')
  } catch (e) {
    assert.ok(e instanceof SpecValidationError)
    assert.ok(e.problems.length >= 4)
    assert.ok(e.problems.some((p) => p.includes('module')))
    assert.ok(e.problems.some((p) => p.includes('stack')))
  }
})

test('validateSpec exige sp cuando adapter=sp', () => {
  try {
    validateSpec({
      ...baseValid,
      use_cases: [
        {
          name: 'RetrieveProduct',
          action: 'retrieveProduct',
          resource_type: 'product',
          adapter: 'sp',
          methods: [{ name: 'retrieveBySku', request: 'Req', response: 'Product' }] // falta sp
        }
      ]
    })
    assert.fail('debió lanzar')
  } catch (e) {
    assert.ok(e instanceof SpecValidationError)
    assert.ok(e.problems.some((p) => p.includes('.sp es obligatorio')))
  }
})

test('validateSpec exige declarar reglas o none:true', () => {
  try {
    validateSpec({ ...baseValid, business_rules: { none: false, rules: [] } })
    assert.fail('debió lanzar')
  } catch (e) {
    assert.ok(e instanceof SpecValidationError)
    assert.ok(e.problems.some((p) => p.includes('business_rules')))
  }
})

test('validateSpec exige al menos un caso con un método', () => {
  try {
    validateSpec({ ...baseValid, use_cases: [] })
    assert.fail('debió lanzar')
  } catch (e) {
    assert.ok(e instanceof SpecValidationError)
    assert.ok(e.problems.some((p) => p.includes('use_cases')))
  }
})
