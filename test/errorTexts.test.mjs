import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { generateApiDocsTool } from '../dist/tools/apiDocs.js'
import { entityText, capitalize } from '../dist/lib/errorCodes.js'

const read = (root, file) => readFileSync(join(root, file), 'utf8')
const verify = (root) => {
  const r = spawnSync(process.execPath, ['scripts/verify-standards.mjs', '--json'], { cwd: root, encoding: 'utf8' })
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
}
const TEMPLATE_TEXT = /Título legible|Acción sugerida para el consumidor|Mensaje técnico con \{placeholders\}/

async function service() {
  const root = mkdtempSync(join(tmpdir(), 'midd-texts-'))
  const r = await scaffoldService({ projectRoot: root, motor: 'mssql', prefijoApi: 'midd-lock', prefijoError: 'LOCK', overwrite: true })
  assert.notEqual(r.isError, true, r.content[0].text)
  return root
}
const useCase = (root, over = {}) =>
  addUseCase({
    projectRoot: root, dominio: 'locks', caso: 'RetrieveLockType', entidad: 'LockType', metodo: 'run', param: 'imei', accion: 'retrieveLockType',
    prefijoError: 'LOCK', motor: 'mssql', adapterType: 'typeorm', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset', overwrite: false, ...over
  })

test('the words of an entity name', () => {
  assert.equal(entityText('LockType'), 'lock type')
  assert.equal(entityText('Product'), 'product')
  assert.equal(entityText('IMEIData'), 'imei data')
  assert.equal(entityText('Order2Item'), 'order2 item')
  assert.equal(capitalize('lock type'), 'Lock type')
})

test('the error texts are written in Spanish from the entity, with the code in the new format', async () => {
  const root = await service()
  try {
    const r = await useCase(root)
    assert.notEqual(r.isError, true, r.content[0].text)
    const domain = read(root, 'src/locks/core/domain/errors/locks.domain.error.ts')
    assert.match(domain, /message: 'No se encontró lock type con los parámetros enviados\.'/)
    assert.match(domain, /title: 'Lock type no encontrado\.'/)
    assert.match(domain, /suggestedActions: 'Valide los parámetros enviados e intente nuevamente\.'/)
    assert.match(domain, /code: 'LOCK-LOCKTYPE-002'/)
    const application = read(root, 'src/locks/core/application/errors/locks.application.error.ts')
    assert.match(application, /title: 'No se pudo procesar la solicitud de lock type\.'/)
    assert.match(application, /suggestedActions: 'Revise la información enviada e intente nuevamente\.'/)
    assert.match(application, /code: 'LOCK-LOCKTYPE-001'/)
    assert.doesNotMatch(domain + application, TEMPLATE_TEXT, 'no template text is left')
    assert.equal(verify(root).warnings.some((w) => w.rule === 'ERROR_CATALOG_PLACEHOLDER'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a case added to a domain that already exists gets texts of its own entity, not the first one', async () => {
  const root = await service()
  try {
    await useCase(root)
    const second = await useCase(root, { caso: 'RetrieveBlockReason', entidad: 'BlockReason', accion: 'retrieveBlockReason' })
    assert.notEqual(second.isError, true, second.content[0].text)
    const domain = read(root, 'src/locks/core/domain/errors/locks.domain.error.ts')
    assert.match(domain, /'BLOCK_REASON_ERROR': \{[\s\S]*?message: 'No se encontró block reason con los parámetros enviados\.'[\s\S]*?title: 'Block reason no encontrado\.'/)
    const application = read(root, 'src/locks/core/application/errors/locks.application.error.ts')
    assert.match(application, /'BLOCK_REASON_ERROR': \{[\s\S]*?title: 'No se pudo procesar la solicitud de block reason\.'/)
    assert.doesNotMatch(domain + application, TEMPLATE_TEXT)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the external API error is in Spanish too', async () => {
  const root = await service()
  try {
    const r = await useCase(root, { adapterType: 'http', apiExterna: 'LockCore', rutaApi: '/locks' })
    assert.notEqual(r.isError, true, r.content[0].text)
    const domain = read(root, 'src/locks/core/domain/errors/locks.domain.error.ts')
    assert.match(domain, /EXTERNAL_API_ERROR: \{[\s\S]*?message: 'La API externa no respondió correctamente\.'[\s\S]*?title: 'Error en la API externa\.'/)
    assert.match(domain, /suggestedActions: 'Intente nuevamente más tarde\. Si persiste, contacte al equipo responsable de la API externa\.'/)
    assert.doesNotMatch(domain, /Try again|External API error/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the contract of the API shows the real titles', async () => {
  const root = await service()
  try {
    await useCase(root)
    await generateApiDocsTool({ projectRoot: root, postman: false, architecture: false })
    const contract = read(root, 'src/locks/contracts/locks.api.md')
    assert.match(contract, /\| `LOCK-LOCKTYPE-002` \| 404 \| Lock type no encontrado\. \|/)
    assert.doesNotMatch(contract, TEMPLATE_TEXT)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards warns (never blocks) about a catalog that still has the old template text', async () => {
  const root = await service()
  try {
    await useCase(root)
    const file = join(root, 'src/locks/core/domain/errors/locks.domain.error.ts')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace("title: 'Lock type no encontrado.'", "title: 'Título legible del error.'"), 'utf8')
    const report = verify(root)
    const warn = report.warnings.filter((w) => w.rule === 'ERROR_CATALOG_PLACEHOLDER')
    assert.equal(warn.length, 1)
    assert.match(warn[0].file, /locks\.domain\.error\.ts$/)
    assert.equal(report.errors.some((e) => e.rule === 'ERROR_CATALOG_PLACEHOLDER'), false, 'it is a warning, not an error')
    // template text in a comment is not text of the catalog
    writeFileSync(file, text + "\n// 'Título legible del error.'\n", 'utf8')
    assert.equal(verify(root).warnings.some((w) => w.rule === 'ERROR_CATALOG_PLACEHOLDER'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
