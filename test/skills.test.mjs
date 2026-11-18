import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, readSkill } from '../dist/lib/skills.js'
import { getSkill } from '../dist/tools/skills.js'

const skill = (root, name, body = 'cuerpo', description = 'Hace algo util. Y mas cosas.') => {
  mkdirSync(join(root, name), { recursive: true })
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`)
}
const tmp = () => mkdtempSync(join(tmpdir(), 'skills-'))

test('the bundled skills come in the offering order, with the vulnerability fix last', () => {
  assert.deepEqual(
    listSkills().map((s) => s.name),
    [
      'midd-audit-unused-dependencies',
      'midd-feature-atlas-flow',
      'midd-generate-readme-ts',
      'midd-fix-snyk-vulnerabilities'
    ]
  )
  for (const s of listSkills()) {
    assert.ok(s.summary.length > 20 && s.summary.length <= 160, `${s.name}: the summary is one or two short lines`)
    assert.ok(!s.summary.includes('\n'))
  }
})

test('a skill added later goes before the vulnerability fix, and takes its summary from the description', () => {
  const root = tmp()
  try {
    for (const n of ['midd-fix-snyk-vulnerabilities', 'midd-generate-readme-ts', 'midd-zeta', 'midd-alfa']) skill(root, n)
    assert.deepEqual(
      listSkills(root).map((s) => s.name),
      ['midd-generate-readme-ts', 'midd-alfa', 'midd-zeta', 'midd-fix-snyk-vulnerabilities']
    )
    assert.equal(listSkills(root).find((s) => s.name === 'midd-zeta').summary, 'Hace algo util.')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('get_skill: no name lists them in order; a name (with or without midd-) returns the real content', async () => {
  const list = (await getSkill({})).content[0].text
  const at = (n) => list.indexOf(n)
  assert.ok(at('midd-audit-unused-dependencies') < at('midd-feature-atlas-flow'))
  assert.ok(at('midd-generate-readme-ts') < at('midd-fix-snyk-vulnerabilities'))
  const short = await getSkill({ name: 'generate-readme-ts' })
  assert.notEqual(short.isError, true)
  assert.equal(short.content[0].text, readFileSync(new URL('../templates/skills/midd-generate-readme-ts/SKILL.md', import.meta.url), 'utf8'))
  const atlas = (await getSkill({ name: 'midd-feature-atlas-flow' })).content[0].text
  assert.ok(atlas.includes('standards.md'), 'it tells which extra files the skill has')
  const extra = await getSkill({ name: 'midd-feature-atlas-flow', file: 'standards.md' })
  assert.notEqual(extra.isError, true)
})

test('get_skill refuses unknown skills and any file that is not part of the skill', async () => {
  assert.equal((await getSkill({ name: 'nope' })).isError, true)
  assert.equal((await getSkill({ name: 'midd-generate-readme-ts', file: '../midd-fix-snyk-vulnerabilities/SKILL.md' })).isError, true)
  assert.equal(readSkill('midd-generate-readme-ts', '..\\..\\..\\package.json').ok, false)
})
