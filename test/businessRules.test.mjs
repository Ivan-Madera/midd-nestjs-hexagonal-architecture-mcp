import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGuard } from '../dist/lib/businessRules.js'

test('infiere guarda de obligatorio (activa)', () => {
  const g = buildGuard('nombre es requerido', 0, 'CAT')
  assert.equal(g.inferred, true)
  assert.ok(g.snippet.includes('=== undefined'))
  assert.ok(g.snippet.includes('(attributes as any).nombre'))
  assert.ok(!g.snippet.trim().startsWith('//')) // activa, no comentada
})

test('infiere guarda de enum (activa, con valores)', () => {
  const g = buildGuard('rol debe ser uno de: administrador | docente | alumno', 0, 'CAT')
  assert.equal(g.inferred, true)
  assert.ok(g.snippet.includes("'administrador'"))
  assert.ok(g.snippet.includes("'docente'"))
  assert.ok(g.snippet.includes('Permitidos'))
})

test('infiere unicidad pero la deja comentada', () => {
  const g = buildGuard('correo debe ser unico (409 si ya registrado)', 0, 'CAT')
  assert.equal(g.inferred, true)
  assert.ok(g.snippet.includes('409'))
  // comentada: todas las líneas de código arrancan con //
  assert.ok(g.snippet.split('\n').every((l) => l.trim() === '' || l.trim().startsWith('//')))
})

test('infiere 404 pero la deja comentada (depende de result)', () => {
  const g = buildGuard('el registro debe existir (404 si no se encuentra)', 0, 'CAT')
  assert.equal(g.inferred, true)
  assert.ok(g.snippet.includes('404'))
  assert.ok(g.snippet.split('\n').every((l) => l.trim() === '' || l.trim().startsWith('//')))
})

test('regla no reconocible -> no inferida, andamiaje comentado', () => {
  const g = buildGuard('alguna regla rara que no sigue patrón', 0, 'CAT')
  assert.equal(g.inferred, false)
  assert.ok(g.snippet.includes('TODO'))
})

test('el código de error usa el prefijo', () => {
  const g = buildGuard('nombre es requerido', 2, 'REGISTROS')
  assert.ok(g.snippet.includes("code: 'REGISTROS-"))
  assert.ok(g.snippet.includes('-003')) // index 2 -> 003
})
