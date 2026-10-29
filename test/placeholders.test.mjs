import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlaceholderMap, substitute } from '../dist/lib/placeholders.js'

test('buildPlaceholderMap deriva case correctamente', () => {
  const map = buildPlaceholderMap({
    dominio: 'catalog',
    caso: 'RetrieveProduct',
    entidad: 'Product',
    metodo: 'retrieveBySku',
    param: 'sku',
    accion: 'retrieveProduct',
    prefijoError: 'CATALOG',
    rutaDominio: 'catalog',
    tipoRecurso: 'product',
    conexion: 'Catalog'
  })
  assert.equal(map['__Dominio__'], 'Catalog')
  assert.equal(map['__dominio__'], 'catalog')
  assert.equal(map['__Caso__'], 'RetrieveProduct')
  assert.equal(map['__caso__'], 'retrieveProduct')
  assert.equal(map['__CASO__'], 'RETRIEVE_PRODUCT')
  assert.equal(map['__Request__'], 'RetrieveProductRequest') // default <Caso>Request
})

test('__Request__ respeta el valor explícito', () => {
  const map = buildPlaceholderMap({
    dominio: 'x', caso: 'C', entidad: 'E', metodo: 'm', param: 'p',
    accion: 'a', prefijoError: 'X', rutaDominio: 'x', tipoRecurso: 'e', conexion: 'X',
    request: 'MiRequestCustom'
  })
  assert.equal(map['__Request__'], 'MiRequestCustom')
})

test('substitute es case-sensitive y reemplaza llaves largas primero', () => {
  const map = { '__CASO__': 'RETRIEVE', '__Caso__': 'Retrieve', '__caso__': 'retrieve' }
  const out = substitute('__CASO__ __Caso__ __caso__', map)
  assert.equal(out, 'RETRIEVE Retrieve retrieve')
})

test('substitute del ConexionArg named vs default', () => {
  const named = buildPlaceholderMap({
    dominio: 'x', caso: 'C', entidad: 'E', metodo: 'm', param: 'p',
    accion: 'a', prefijoError: 'X', rutaDominio: 'x', tipoRecurso: 'e', conexion: 'Catalog',
    connectionStyle: 'named'
  })
  assert.equal(named['<ConexionArg>'], ", 'CatalogConnection'")
  const def = buildPlaceholderMap({
    dominio: 'x', caso: 'C', entidad: 'E', metodo: 'm', param: 'p',
    accion: 'a', prefijoError: 'X', rutaDominio: 'x', tipoRecurso: 'e', conexion: 'Catalog',
    connectionStyle: 'default'
  })
  assert.equal(def['<ConexionArg>'], '')
})
