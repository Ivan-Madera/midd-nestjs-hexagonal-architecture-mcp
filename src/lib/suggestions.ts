/**
 * Suggested answers to the five general questions of the agent, read from an EXISTING project (refactor).
 *
 * Deterministic on purpose: the same project gives the same suggestions every time, each one with the evidence it
 * came from, so the agent never "guesses" and the user can see why a value is proposed. A suggestion is only a
 * default to confirm: the agent still asks every question, one at a time, and the user confirms or changes it.
 * When there is no evidence there is no suggestion (absence of a guard is not a decision about authorization).
 *
 * Secrets: .env is read ONLY for the API_CONTEXT line; no other value of it is looked at or returned.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export type Suggestion = { value: string; evidence: string }
export type SuggestedAnswers = {
  prefijoApi?: Suggestion
  prefijoError?: Suggestion
  motor?: Suggestion
  authorization?: Suggestion
  postman?: Suggestion
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ERROR_PREFIX = /^[A-Z][A-Z0-9_]{0,31}$/
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

function walk(dir: string, accept: (file: string) => boolean, out: string[] = [], depth = 0): string[] {
  if (!existsSync(dir) || depth > 8) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === 'coverage') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, accept, out, depth + 1)
    else if (accept(full)) out.push(full)
  }
  return out
}

/** The value of ONE key of an env file, without reading anything else of it into the result. */
function envKey(file: string, key: string): string | undefined {
  const m = new RegExp(`^${key}[ \\t]*=[ \\t]*["']?([^"'\\r\\n#]*)`, 'm').exec(read(file))
  const value = m?.[1].trim()
  return value || undefined
}

function suggestApiPrefix(projectRoot: string, pkg: Record<string, any>): Suggestion | undefined {
  for (const file of ['.env.example', '.env']) {
    const value = envKey(join(projectRoot, file), 'API_CONTEXT')
    if (value && KEBAB.test(value)) return { value, evidence: `${file}: API_CONTEXT` }
  }
  const name = typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : ''
  if (/^midd-/.test(name) && KEBAB.test(name)) return { value: name, evidence: 'package.json: name' }
  const folder = basename(projectRoot).toLowerCase()
  if (/^midd-/.test(folder) && KEBAB.test(folder)) return { value: folder, evidence: 'nombre de la carpeta del proyecto' }
  if (name && KEBAB.test(name)) return { value: name, evidence: 'package.json: name (no empieza con midd-: revisalo)' }
  return undefined
}

function suggestErrorPrefix(sources: Array<[string, string]>, api?: Suggestion): Suggestion | undefined {
  const counts = new Map<string, number>()
  for (const [, code] of sources) {
    for (const m of code.matchAll(/code\s*:\s*['"`]([A-Z][A-Z0-9_]*)-[A-Z0-9]+-\d{3,4}['"`]/g)) {
      if (m[1] === 'SERVICE') continue // the shared layer of the area, not the API's own prefix
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (best) return { value: best[0], evidence: `${best[1]} codigo(s) de error del proyecto ya usan ${best[0]}-...` }
  if (api) {
    const derived = api.value.replace(/^midd-/, '').replace(/-/g, '').toUpperCase()
    if (ERROR_PREFIX.test(derived)) return { value: derived, evidence: `derivado del prefijo de la API (${api.value}, sin "midd-")` }
  }
  return undefined
}

const ENGINE_BY_TYPE: Record<string, string> = { mssql: 'mssql', postgres: 'postgres', mysql: 'mysql', mariadb: 'mysql' }
const ENGINE_BY_DRIVER: Array<[string, string]> = [['mssql', 'mssql'], ['pg', 'postgres'], ['mysql2', 'mysql'], ['mysql', 'mysql']]

function suggestEngine(projectRoot: string, sources: Array<[string, string]>, deps: Record<string, string>): Suggestion | undefined {
  const found: Array<[string, string]> = []
  for (const [file, code] of sources) {
    for (const m of code.matchAll(/\btype\s*:\s*['"`](mssql|postgres|mysql|mariadb)['"`]/g)) {
      const engine = ENGINE_BY_TYPE[m[1]]
      if (!found.some(([e]) => e === engine)) found.push([engine, relative(projectRoot, file).replace(/\\/g, '/')])
    }
  }
  if (found.length) {
    const others = found.slice(1).map(([e]) => e)
    return {
      value: found[0][0],
      evidence: `TypeORM type '${found[0][0]}' en ${found[0][1]}${others.length ? ` (tambien usa: ${others.join(', ')}; pregunta cual)` : ''}`
    }
  }
  const driver = ENGINE_BY_DRIVER.find(([name]) => deps[name])
  if (driver) return { value: driver[1], evidence: `package.json: driver ${driver[0]}` }
  if (!deps.typeorm && !deps['@nestjs/typeorm']) return { value: 'none', evidence: 'el proyecto no usa TypeORM ni un driver de base de datos' }
  return undefined
}

function suggestAuthorization(projectRoot: string, sources: Array<[string, string]>, deps: Record<string, string>): Suggestion | undefined {
  if (existsSync(join(projectRoot, 'src', 'shared', 'authorization'))) return { value: 'si', evidence: 'ya existe src/shared/authorization' }
  const dep = ['@nestjs/passport', 'passport-jwt', '@nestjs/jwt', 'jsonwebtoken'].find((name) => deps[name])
  if (dep) return { value: 'si', evidence: `package.json: ${dep}` }
  for (const [file, code] of sources) {
    const path = relative(projectRoot, file).replace(/\\/g, '/')
    if (path.startsWith('src/shared/infrastructure/')) continue // the rate limit guard of the area is not authorization
    if (/headers\s*(\[\s*['"`]authorization['"`]\s*\]|\.authorization)\b|['"`]Bearer\s/i.test(code))
      return { value: 'si', evidence: `${path} lee la cabecera Authorization` }
    if (/@UseGuards\s*\(/.test(code) || /implements\s+CanActivate\b/.test(code))
      return { value: 'si', evidence: `${path} protege endpoints con un guard` }
  }
  return undefined
}

function suggestPostman(projectRoot: string): Suggestion | undefined {
  const collection = walk(projectRoot, (f) => /\.postman_collection\.json$/i.test(f))[0]
  return collection ? { value: 'si', evidence: `ya existe ${relative(projectRoot, collection).replace(/\\/g, '/')}` } : undefined
}

export function suggestAnswers(projectRoot: string): SuggestedAnswers {
  let pkg: Record<string, any> = {}
  try {
    pkg = JSON.parse(read(join(projectRoot, 'package.json')) || '{}')
  } catch {
    pkg = {}
  }
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies }
  const sources: Array<[string, string]> = walk(join(projectRoot, 'src'), (f) => f.endsWith('.ts')).map((f) => [f, stripComments(read(f))])
  const prefijoApi = suggestApiPrefix(projectRoot, pkg)
  const out: SuggestedAnswers = {
    prefijoApi,
    prefijoError: suggestErrorPrefix(sources, prefijoApi),
    motor: suggestEngine(projectRoot, sources, deps),
    authorization: suggestAuthorization(projectRoot, sources, deps),
    postman: suggestPostman(projectRoot)
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as SuggestedAnswers
}

export const SUGGESTION_LABELS: Array<[keyof SuggestedAnswers, string]> = [
  ['prefijoApi', '1. Prefijo de la API'],
  ['prefijoError', '2. Prefijo de errores'],
  ['motor', '3. Base de datos'],
  ['authorization', '4. Autorizacion'],
  ['postman', '5. Postman']
]
