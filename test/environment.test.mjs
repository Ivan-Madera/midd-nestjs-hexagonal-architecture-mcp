import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService, GITIGNORE } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'midd-env-agent-'))
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}
const scaffold = (root, over = {}) =>
  scaffoldService({ projectRoot: root, motor: 'mssql', prefijoApi: 'midd-demo', prefijoError: 'DEMO', overwrite: true, ...over })

test('the next steps are addressed to the AGENT: it runs them, the user is not asked to', async () => {
  const root = tmp()
  try {
    const out = (await scaffold(root)).content[0].text
    assert.match(out, /AGENTE \(hazlo tú con shell, no se lo pidas al usuario\): corre npm install/)
    assert.match(out, /AGENTE: pide al usuario los valores de DB_MSSQL_HOST, _PORT, _USERNAME, _PASSWORD y _NAME y escríbelos tú en el \.env/)
    assert.match(out, /AGENTE: crea el \.env a partir del \.env\.example/)
    assert.doesNotMatch(out, /^\s+- (Corre npm install|Copia \.env\.example)/m, 'no step is phrased as an order to the user')
    assert.match(out, /No repitas la contraseña/)

    const useCase = await addUseCase({
      projectRoot: root, dominio: 'rates', caso: 'RetrieveRate', entidad: 'Rate', metodo: 'retrieveRate', param: 'currency', accion: 'retrieveRate',
      prefijoError: 'DEMO', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates', mode: 'greenfield', connectionStyle: 'named',
      infraStyle: 'dataset', overwrite: false
    })
    assert.match(useCase.content[0].text, /AGENTE: pide al usuario esa URL y escríbela tú en el \.env/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a .gitignore that excludes the real .env is generated, and the one a project already has is respected', async () => {
  const fresh = tmp()
  const existing = tmp()
  try {
    const made = await scaffold(fresh)
    assert.match(made.content[0].text, /\+ \.gitignore/)
    const ignore = readFileSync(join(fresh, '.gitignore'), 'utf8')
    assert.equal(ignore, GITIGNORE)
    for (const line of ['node_modules/', 'dist/', '.env', '.env.*', '!.env.example']) assert.ok(ignore.split('\n').includes(line), line)

    writeFileSync(join(existing, '.gitignore'), 'my-own-rules\n', 'utf8')
    const kept = await scaffold(existing)
    assert.match(kept.content[0].text, /= \.gitignore/)
    assert.equal(readFileSync(join(existing, '.gitignore'), 'utf8'), 'my-own-rules\n', 'never overwritten')
  } finally {
    rmSync(fresh, { recursive: true, force: true })
    rmSync(existing, { recursive: true, force: true })
  }
})

test('verify-standards fails when a real .env would reach git, and passes once it is ignored', async () => {
  const root = tmp()
  try {
    await scaffold(root)
    assert.equal(verify(root).errors.some((e) => e.rule === 'ENV_NOT_IGNORED'), false, 'no .env yet: nothing to protect')

    writeFileSync(join(root, '.env'), 'DB_MSSQL_PASSWORD=secret\n', 'utf8')
    assert.equal(verify(root).errors.some((e) => e.rule === 'ENV_NOT_IGNORED'), false, 'the generated .gitignore already covers it')

    writeFileSync(join(root, '.gitignore'), 'node_modules/\n', 'utf8')
    const failing = verify(root).errors.filter((e) => e.rule === 'ENV_NOT_IGNORED')
    assert.equal(failing.length, 1)
    assert.match(failing[0].message, /would be committed/)

    rmSync(join(root, '.gitignore'))
    assert.equal(verify(root).errors.some((e) => e.rule === 'ENV_NOT_IGNORED'), true, 'no .gitignore at all is the same')

    for (const rule of ['.env', '/.env', '.env*', '.env.*']) {
      writeFileSync(join(root, '.gitignore'), `${rule}\n`, 'utf8')
      assert.equal(verify(root).errors.some((e) => e.rule === 'ENV_NOT_IGNORED'), false, rule)
    }
    // a comment that mentions .env is not a rule
    writeFileSync(join(root, '.gitignore'), '# .env goes here later\n', 'utf8')
    assert.equal(verify(root).errors.some((e) => e.rule === 'ENV_NOT_IGNORED'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the agent is told to prepare the environment itself, and not to leak a password', () => {
  const agent = readFileSync(join(process.cwd(), 'templates/agentic/middleware-generator.md'), 'utf8')
  assert.match(agent, /Fase 6b - Entorno/)
  assert.match(agent, /nunca le digas al usuario "corre npm install" ni "copia el \.env"/)
  assert.match(agent, /Corre `npm install`/)
  assert.match(agent, /Crea `\.env` con el contenido de `\.env\.example`/)
  assert.match(agent, /Nunca repitas una contrasena ni un token/)
  assert.match(agent, /ENV_NOT_IGNORED/)
  assert.equal(existsSync(join(process.cwd(), 'templates/agentic/middleware-generator.md')), true)
})
