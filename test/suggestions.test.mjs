import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { suggestAnswers } from '../dist/lib/suggestions.js'
import { inspectProjectTool } from '../dist/tools/support.js'

const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text, 'utf8')
}

test('a project with clues gets a suggestion for every question, each with its evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sugg-'))
  try {
    write(root, 'package.json', JSON.stringify({ name: 'midd-pf-initial', dependencies: { '@nestjs/core': '^10', '@nestjs/typeorm': '^10', mssql: '^10', '@nestjs/passport': '^10' } }))
    write(root, 'src/app.module.ts', "TypeOrmModule.forRoot({ type: 'mssql', replication: {} })\n")
    write(root, 'src/setups/errors.ts', "export const E = { a: { code: 'INITIAL-NOTFOUND-001' }, b: { code: 'INITIAL-INVALID-002' }, c: { code: 'SERVICE-BADREQUEST-016' } }\n")
    write(root, 'docs/initial.postman_collection.json', '{}')
    write(root, '.env', 'API_CONTEXT=\nDB_PASSWORD=secret-value\n')
    const s = suggestAnswers(root)
    assert.deepEqual(s.prefijoApi, { value: 'midd-pf-initial', evidence: 'package.json: name' })
    assert.equal(s.prefijoError.value, 'INITIAL', 'the prefix the project already uses, never the shared SERVICE')
    assert.match(s.prefijoError.evidence, /2 codigo/)
    assert.equal(s.motor.value, 'mssql')
    assert.match(s.motor.evidence, /src\/app\.module\.ts/)
    assert.deepEqual(s.authorization, { value: 'si', evidence: 'package.json: @nestjs/passport' })
    assert.equal(s.postman.value, 'si')

    const text = (await inspectProjectTool({ projectRoot: root })).content[0].text
    assert.match(text, /1\. Prefijo de la API: midd-pf-initial   \(evidencia: package\.json: name\)/)
    assert.doesNotMatch(text, /secret-value/, 'no value of .env other than API_CONTEXT is ever read into the output')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('API_CONTEXT wins over the package name; with no error codes the prefix is derived; no database means none', () => {
  const root = mkdtempSync(join(tmpdir(), 'sugg-'))
  try {
    write(root, 'package.json', JSON.stringify({ name: 'legacy-app', dependencies: { '@nestjs/core': '^10' } }))
    write(root, '.env.example', 'PORT=3000\nAPI_CONTEXT=midd-stores\n')
    write(root, 'src/main.ts', 'bootstrap()\n')
    const s = suggestAnswers(root)
    assert.deepEqual(s.prefijoApi, { value: 'midd-stores', evidence: '.env.example: API_CONTEXT' })
    assert.equal(s.prefijoError.value, 'STORES')
    assert.match(s.prefijoError.evidence, /derivado del prefijo de la API/)
    assert.equal(s.motor.value, 'none')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no evidence, no suggestion: the absence of a guard is not a "no" to authorization', () => {
  const root = mkdtempSync(join(tmpdir(), 'sugg-'))
  try {
    write(root, 'package.json', JSON.stringify({ name: 'svc', dependencies: { '@nestjs/core': '^10', typeorm: '^0.3' } }))
    write(root, 'src/shared/infrastructure/security/security.module.ts', "providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }]\nclass G implements CanActivate {}\n")
    const s = suggestAnswers(root)
    assert.equal(s.authorization, undefined, 'the rate limit guard of the area is not authorization')
    assert.equal(s.postman, undefined)
    assert.equal(s.motor, undefined, 'TypeORM without a recognisable engine: ask, do not guess')
    assert.equal(s.prefijoApi.value, 'svc')
    assert.match(s.prefijoApi.evidence, /no empieza con midd-/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
