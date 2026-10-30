import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoKitEnabled } from './kitSwitch.js'

/**
 * The answers the user gives ONCE per repo, kept in plain sight in AGENTS.md.
 *
 *   AUTHORIZATION: required | none | undefined
 *   POSTMAN: yes | no | undefined
 *
 * `undefined` means "not asked yet". The agent asks only what is undefined and writes the answer here, so the second
 * module of the same repo does not ask again and the user can read, and change, what was decided by editing a value.
 *
 * The block has its own markers: the managed section of the MCP is replaced on every update, this one never is. Only
 * closed values are read back (anything else counts as undefined), so a hand-edited line can never carry text into
 * the agent.
 */
export const PREFS_BEGIN =
  '<!-- BEGIN midd-nestjs-preferences (managed by midd-nestjs-hexagonal-architecture-mcp: the agent writes your answers here, you can edit the values) -->'
export const PREFS_END = '<!-- END midd-nestjs-preferences -->'

export type PreferenceKey = 'authorization' | 'postman'
export type PreferenceValue = 'enabled' | 'disabled'

export const PREFERENCES: Record<PreferenceKey, { line: string; enabled: string; disabled: string; hint: string }> = {
  authorization: { line: 'AUTHORIZATION', enabled: 'required', disabled: 'none', hint: 'required = autorizacion activa | none = endpoints publicos' },
  postman: { line: 'POSTMAN', enabled: 'yes', disabled: 'no', hint: 'yes | no' }
}

const KEYS = Object.keys(PREFERENCES) as PreferenceKey[]

const blockText = (): string =>
  [
    PREFS_BEGIN,
    '## Decisiones de esta API (las guarda el agente; puedes editarlas)',
    'El agente de middleware pregunta esto UNA vez por repo y lo recuerda aqui. Para cambiar una, edita su valor.',
    '`undefined` = todavia no se pregunto.',
    ...KEYS.map((key) => `${PREFERENCES[key].line}: undefined   # ${PREFERENCES[key].hint}`),
    PREFS_END,
    ''
  ].join('\n')

type Located = { state: 'none' } | { state: 'broken' } | { state: 'found'; begin: number; end: number }

function locate(content: string): Located {
  const begin = content.indexOf('<!-- BEGIN midd-nestjs-preferences')
  const end = content.indexOf(PREFS_END)
  if (begin === -1 && end === -1) return { state: 'none' }
  if (begin === -1 || end === -1 || end < begin) return { state: 'broken' }
  return { state: 'found', begin, end: end + PREFS_END.length }
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const eolOf = (content: string): string => (content.includes('\r\n') ? '\r\n' : '\n')

/** What the user decided, read from the block. Anything that is not a closed value is "not decided". */
export function readPreferences(projectRoot: string): Partial<Record<PreferenceKey, PreferenceValue>> {
  const content = read(join(projectRoot, 'AGENTS.md'))
  const where = locate(content)
  if (where.state !== 'found') return {}
  const block = content.slice(where.begin, where.end)
  const out: Partial<Record<PreferenceKey, PreferenceValue>> = {}
  for (const key of KEYS) {
    const m = new RegExp(`^${PREFERENCES[key].line}:[ \\t]*(\\S+)`, 'm').exec(block)
    if (!m) continue
    if (m[1] === PREFERENCES[key].enabled) out[key] = 'enabled'
    else if (m[1] === PREFERENCES[key].disabled) out[key] = 'disabled'
  }
  return out
}

/** Creates the block (all `undefined`) when it is missing. Never touches a block that is already there. */
export function ensurePreferencesBlock(projectRoot: string): 'created' | 'unchanged' | 'skipped-broken-markers' {
  const path = join(projectRoot, 'AGENTS.md')
  if (!existsSync(path)) {
    writeFileSync(path, blockText(), 'utf8')
    return 'created'
  }
  const content = readFileSync(path, 'utf8')
  const where = locate(content)
  if (where.state === 'found') return 'unchanged'
  if (where.state === 'broken') return 'skipped-broken-markers'
  const eol = eolOf(content)
  const separator = content.endsWith('\n') ? '' : eol
  writeFileSync(path, content + separator + eol + blockText().replace(/\n/g, eol), 'utf8')
  return 'created'
}

/**
 * Writes one answer into the block. Returns true when the file changed. With the automatic installation off, a repo
 * that has no block is left alone: the user did not want the MCP to write to AGENTS.md.
 */
export function writePreference(projectRoot: string, key: PreferenceKey, value: PreferenceValue): boolean {
  const path = join(projectRoot, 'AGENTS.md')
  const hasBlock = locate(read(path)).state === 'found'
  if (!hasBlock && !autoKitEnabled()) return false
  if (!hasBlock && ensurePreferencesBlock(projectRoot) === 'skipped-broken-markers') return false

  const content = readFileSync(path, 'utf8')
  const where = locate(content)
  if (where.state !== 'found') return false
  const eol = eolOf(content)
  const mapped = PREFERENCES[key][value]
  let block = content.slice(where.begin, where.end)
  const line = new RegExp(`^(${PREFERENCES[key].line}:[ \\t]*)\\S+`, 'm')
  if (line.test(block)) {
    block = block.replace(line, (_m, head: string) => `${head}${mapped}`)
  } else {
    // The user deleted the line: put it back before the closing marker.
    block = block.replace(PREFS_END, `${PREFERENCES[key].line}: ${mapped}   # ${PREFERENCES[key].hint}${eol}${PREFS_END}`)
  }
  const next = content.slice(0, where.begin) + block + content.slice(where.end)
  if (next === content) return false
  writeFileSync(path, next, 'utf8')
  return true
}
