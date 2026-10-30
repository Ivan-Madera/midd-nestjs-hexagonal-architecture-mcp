/**
 * Sections for `.env.example`.
 *
 * The file is grouped by topic so a person can find a variable, but it carries exactly the same keys and
 * values as before: sections are only comment lines (`# --- Title ---`), which every reader of the file
 * (the verifier, the docs generator, the e2e test) already ignores.
 *
 * Every writer (scaffold, connections, authorization, stored procedures) goes through `addEnvEntries`, so
 * each variable lands in its own section whatever the order the tools run in.
 */

export const ENV_SECTIONS = {
  server: 'Server',
  cors: 'CORS',
  rateLimit: 'Ratelimit',
  authorization: 'Authorization',
  externalApis: 'External APIs',
  storedProcedures: 'Stored procedures',
  other: 'Other'
} as const

export type EnvEntry = [key: string, value: string]

const HEADER = /^# --- (.+) ---$/

/** Display order of the sections. Database sections come after CORS and rate limit, before authorization. */
function rank(title: string): number {
  if (/^Server/.test(title)) return 0
  if (/^CORS$/.test(title)) return 1
  if (/^Ratelimit$/.test(title)) return 2
  if (/^Database/.test(title)) return 3
  if (/^Authorization/.test(title)) return 4
  if (/^External APIs/.test(title)) return 5
  if (/^Stored procedures/.test(title)) return 6
  return 7
}

export const sectionHeader = (title: string): string => `# --- ${title} ---`

/** Section a variable belongs to, by name. Unknown names go to "Other". */
export function sectionOf(key: string): string {
  if (key === 'PORT' || key === 'API_CONTEXT') return ENV_SECTIONS.server
  if (key === 'CORS_ALLOWED_ORIGINS') return ENV_SECTIONS.cors
  if (/^RL_/.test(key)) return ENV_SECTIONS.rateLimit
  if (key === 'AUTHORIZATION_API_URL') return ENV_SECTIONS.authorization
  if (/_BASE_URL$/.test(key)) return ENV_SECTIONS.externalApis
  if (/(^|_)SP$/.test(key)) return ENV_SECTIONS.storedProcedures
  return ENV_SECTIONS.other
}

const hasKey = (lines: string[], key: string): boolean => lines.some((l) => l.startsWith(`${key}=`))

/**
 * Adds the entries that are not in the file yet, inside `section` (created in its place if missing).
 * Keys that already exist are left exactly as they are, value included. Returns the new content.
 */
export function addEnvEntries(content: string, section: string, entries: EnvEntry[]): string {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized === '' ? [] : normalized.replace(/\n+$/, '').split('\n')
  const missing = entries.filter(([key]) => !hasKey(lines, key))
  if (missing.length === 0) return content

  const header = sectionHeader(section)
  const start = lines.indexOf(header)
  const block = missing.map(([k, v]) => `${k}=${v}`)

  if (start >= 0) {
    // After the last variable of the section (a section ends at the next header or at the end of the file).
    let end = start
    for (let i = start + 1; i < lines.length && !HEADER.test(lines[i]); i++) if (lines[i].trim() !== '') end = i
    lines.splice(end + 1, 0, ...block)
  } else {
    const newRank = rank(section)
    const next = lines.findIndex((l) => {
      const m = HEADER.exec(l)
      return m !== null && rank(m[1]) > newRank
    })
    const created = [header, ...block]
    if (next >= 0) lines.splice(next, 0, ...created, '')
    else {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
      lines.push(...created)
    }
  }
  return lines.join('\n') + '\n'
}

/** Builds a whole file from comment lines plus entries, each one in the section its name belongs to. */
export function buildSectionedEnv(preamble: string[], entries: EnvEntry[]): string {
  let content = preamble.join('\n') + '\n'
  const bySection = new Map<string, EnvEntry[]>()
  for (const entry of entries) {
    const title = sectionOf(entry[0])
    bySection.set(title, [...(bySection.get(title) ?? []), entry])
  }
  const titles = [...bySection.keys()].sort((a, b) => rank(a) - rank(b))
  for (const title of titles) content = addEnvEntries(content, title, bySection.get(title)!)
  return content
}
