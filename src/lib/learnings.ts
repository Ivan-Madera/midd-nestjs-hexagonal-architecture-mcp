import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mcpVersion } from './inventory.js'

/**
 * Per-repo learnings: what the MCP remembers between sessions of the SAME repository.
 * Stored in docs/mcp-learnings.json (next to architecture-inventory.json).
 *
 * Design guarantees, so that learning can never question the base rules:
 *  - It is ADVISORY data. The base rules (rules.yaml), the verifier and the templates
 *    never read this file; deleting it changes nothing about what is allowed.
 *  - Every field has a CLOSED shape (a regex or an enum). There is no free text field:
 *    text that came from a user or from the file itself is never echoed back to an agent.
 *    The words an agent reads about an error come from HINTS, written here and shipped
 *    with the MCP, keyed by the verifier's rule id.
 *  - Reading and writing share ONE sanitizer, so a hand-edited or hostile file is cleaned
 *    on the way in and on the way out.
 *  - It never records a preference that would turn an opt-in rule into a default
 *    (for example "this repo uses stored procedures"): SP stays opt-in, always asked.
 */

export const LEARNINGS_FILE = 'docs/mcp-learnings.json'
export const SCHEMA_VERSION = 1

/** A pitfall is shown to the agent once it has appeared this many times in the repo. */
export const PITFALL_MIN_COUNT = 2
const MAX_PITFALLS_SHOWN = 5
const MAX_PREFIXES = 50
const MAX_CONNECTIONS = 20
export const MAX_OUTPUT_CHARS = 2500

const SERVICE_CONTEXT = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ERROR_PREFIX = /^[A-Z][A-Z0-9_]{0,31}$/
const CONNECTION_NAME = /^[A-Z][A-Za-z0-9]{0,47}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Decisions a user can take once for the whole repo. Closed on purpose. */
export const DECISIONS = {
  authorization: ['enabled', 'disabled']
} as const
export type DecisionKey = keyof typeof DECISIONS

/**
 * What an agent is told about a rule that keeps failing. Static text written by the maintainers
 * of the MCP: it only explains how to SATISFY the rule, never how to relax it.
 * A test requires an entry for every rule id the verifier can emit.
 */
export const HINTS: Record<string, string> = {
  AUTHORIZATION_FAIL_OPEN: 'The authorization guard and verifier must deny when the authorizer denies or is unreachable.',
  AUTHORIZATION_NOT_REGISTERED: 'Import AuthorizationModule in AppModule when src/shared/authorization exists.',
  AUTHORIZATION_ORDER: 'Import AuthorizationModule AFTER SecurityModule so the rate limit runs first.',
  BLIND_CAST: 'Map source fields explicitly in the adapter instead of casting a row with "as".',
  CONSOLE_LOG: 'Use the LoggerService, never console.*.',
  CORS_WILDCARD: 'Read the CORS origins from CORS_ALLOWED_ORIGINS instead of hardcoding them in main.ts.',
  DB_CONNECTION_MISSING: 'A connection a module uses needs its database module in AppModule and its name in UtilsModule.register: create it with add_use_case.',
  ENV_DIRECT: 'Read configuration only from ConfigurationVariables, never process.env elsewhere.',
  ENV_EXAMPLE: 'Keep .env.example in sync with every key of the Joi schema.',
  ESM_ONLY_IMPORT: 'Use randomUUID from node:crypto. The uuid package is banned.',
  FAT_SERVICE_METHOD: 'Split long use case methods into small named steps; move source mapping to the adapter.',
  FETCH_ALL_FILTER_IN_MEMORY: 'Push filters to the database instead of loading everything and filtering in memory.',
  FORBIDDEN_DEPENDENCY: 'axios and uuid are banned: use native fetch and randomUUID from node:crypto.',
  HARDCODED_MONEY_CONSTANT: 'Business amounts come from the spec, config or a parameter, never a literal.',
  HEALTH_NOT_PUBLIC: 'Mark the health probe with @SkipAuthorization() so it answers without a token.',
  MISSING_ENV_DEFAULT: 'Give CORS_ALLOWED_ORIGINS and every RL_* variable its area default with Joi .default(...) so an unset variable never disables the protection.',
  ENV_NOT_IGNORED: 'Add a line .env to .gitignore before putting real values in .env: credentials must never be committed.',
  ERROR_CODE_DUPLICATE: 'Two errors of the same prefix share a number: give the repeated one the next free number, from 001 to 999.',
  ERROR_CODE_FORMAT: 'An error code is PREFIX-SLUG-NNN with a three digit number from 001 to 999: rewrite the number.',
  API_DOCS_MISSING: 'Run generate_api_docs: it writes the contract and the flow diagram of every module from the code.',
  API_DOCS_STALE: 'The contract is out of date with the controllers: run generate_api_docs again.',
  HTTP_IN_CORE: 'core/ never calls HTTP directly: go through an outbound port implemented in infrastructure.',
  INCOMPLETE_RATE_LIMITING: 'Rate limiting needs all three controls: rate per IP, concurrency per IP and payload size. Use the SecurityModule from scaffold_service.',
  JSON_BODY_LIMIT: 'Give the vnd.api+json body parser an explicit limit.',
  MISSING_API_BASE_PATH: 'Prefix = only the context from API_CONTEXT; the version lives in each controller: @Controller({ path, version }).',
  MISSING_CACHE_CONTROL: 'Cache-Control: no-store must be the first app.use() in main.ts.',
  MISSING_CORRELATION_ID: 'Register the correlation middleware in main.ts; it generates the id when the caller sends none.',
  MISSING_ENV_VALIDATION: 'Every variable the service reads must be validated in the Joi schema.',
  MISSING_HTTP_SECURITY: 'Keep the security headers and CORS configuration of main.ts from scaffold_service.',
  MONEY_AS_FLOAT: 'Use decimal.js for money and keep amounts as strings at the boundary.',
  NAMING_ENTITY: 'Name domain entities <Name>.entity.ts.',
  NAMING_SPACES: 'File names must not contain spaces.',
  NAMING_TYPO: 'Use the canonical spellings: infrastructure, http-server, Adapter, and "<name>.entity.ts" with a dot.',
  NON_POST_ENDPOINT: 'Expose only @Post endpoints; carry the intent in the JSON:API body.',
  RAW_ERROR: 'Throw GenericException with an entry of the error catalog, never throw new Error.',
  SOURCE_IMPORT_OUTSIDE_INFRA: 'Only infrastructure adapters may import the data source (typeorm).',
  SP_NOT_DECLARED: 'Declare every stored procedure in ConfigurationVariables, the Joi schema and .env.example.',
  UNBOUNDED_FIND_ALL: 'Paginate lists; do not read a whole table.',
  UNTYPED_MIDDLEWARE: 'Type the middleware parameters with Request, Response and NextFunction from express.'
}

export type Learnings = {
  schemaVersion: number
  mcpVersion: string
  updatedAt: string
  conventions: {
    serviceContext?: string
    errorPrefixes: string[]
    connections: Record<string, 'named' | 'default'>
  }
  decisions: Partial<Record<DecisionKey, string>>
  pitfalls: Record<string, { count: number; lastSeen: string }>
  /** Rule ids that were failing on the last verification, to count each appearance once. */
  lastVerify: string[]
}

export type LoadResult =
  | { state: 'missing'; data: Learnings }
  | { state: 'ok'; data: Learnings }
  | { state: 'unreadable'; data: Learnings }

const today = (): string => new Date().toISOString().slice(0, 10)

export function emptyLearnings(): Learnings {
  return {
    schemaVersion: SCHEMA_VERSION,
    mcpVersion: mcpVersion(),
    updatedAt: today(),
    conventions: { errorPrefixes: [], connections: {} },
    decisions: {},
    pitfalls: {},
    lastVerify: []
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const uniqueSorted = (values: string[]): string[] => [...new Set(values)].sort()

/**
 * The ONLY gate every piece of data goes through, on read and on write.
 * Anything that does not match its closed shape is dropped, never repaired or echoed.
 */
export function sanitize(input: unknown): Learnings {
  const out = emptyLearnings()
  if (!isRecord(input)) return out

  if (typeof input.updatedAt === 'string' && ISO_DATE.test(input.updatedAt)) out.updatedAt = input.updatedAt

  const conventions = isRecord(input.conventions) ? input.conventions : {}
  if (typeof conventions.serviceContext === 'string' && conventions.serviceContext.length <= 64 && SERVICE_CONTEXT.test(conventions.serviceContext)) {
    out.conventions.serviceContext = conventions.serviceContext
  }
  if (Array.isArray(conventions.errorPrefixes)) {
    out.conventions.errorPrefixes = uniqueSorted(
      conventions.errorPrefixes.filter((p): p is string => typeof p === 'string' && ERROR_PREFIX.test(p))
    ).slice(0, MAX_PREFIXES)
  }
  if (isRecord(conventions.connections)) {
    for (const [name, style] of Object.entries(conventions.connections).sort(([a], [b]) => a.localeCompare(b))) {
      if (Object.keys(out.conventions.connections).length >= MAX_CONNECTIONS) break
      if (CONNECTION_NAME.test(name) && (style === 'named' || style === 'default')) out.conventions.connections[name] = style
    }
  }

  const decisions = isRecord(input.decisions) ? input.decisions : {}
  for (const key of Object.keys(DECISIONS) as DecisionKey[]) {
    const value = decisions[key]
    if (typeof value === 'string' && (DECISIONS[key] as readonly string[]).includes(value)) out.decisions[key] = value
  }

  const pitfalls = isRecord(input.pitfalls) ? input.pitfalls : {}
  for (const [ruleId, raw] of Object.entries(pitfalls).sort(([a], [b]) => a.localeCompare(b))) {
    if (!(ruleId in HINTS) || !isRecord(raw)) continue
    const count = Number(raw.count)
    if (!Number.isInteger(count) || count < 1 || count > 9999) continue
    const lastSeen = typeof raw.lastSeen === 'string' && ISO_DATE.test(raw.lastSeen) ? raw.lastSeen : today()
    out.pitfalls[ruleId] = { count, lastSeen }
  }

  if (Array.isArray(input.lastVerify)) {
    out.lastVerify = uniqueSorted(input.lastVerify.filter((id): id is string => typeof id === 'string' && id in HINTS))
  }
  return out
}

export const learningsPath = (projectRoot: string): string => join(projectRoot, LEARNINGS_FILE)

export function loadLearnings(projectRoot: string): LoadResult {
  const file = learningsPath(projectRoot)
  if (!existsSync(file)) return { state: 'missing', data: emptyLearnings() }
  try {
    return { state: 'ok', data: sanitize(JSON.parse(readFileSync(file, 'utf8'))) }
  } catch {
    return { state: 'unreadable', data: emptyLearnings() }
  }
}

/** Stable key order and LF line endings so the file diffs cleanly in git. */
const serialize = (data: Learnings): string => {
  const ordered = {
    schemaVersion: data.schemaVersion,
    mcpVersion: data.mcpVersion,
    updatedAt: data.updatedAt,
    conventions: {
      ...(data.conventions.serviceContext ? { serviceContext: data.conventions.serviceContext } : {}),
      errorPrefixes: data.conventions.errorPrefixes,
      connections: data.conventions.connections
    },
    decisions: data.decisions,
    pitfalls: data.pitfalls,
    lastVerify: data.lastVerify
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

// updatedAt and mcpVersion are stamps, not knowledge: a change in them alone must not rewrite the file.
const knowledge = (data: Learnings): string => serialize({ ...data, updatedAt: '', mcpVersion: '' })

/**
 * Applies a change and writes ONLY when the knowledge changed (no git noise on repeated runs).
 * Never throws: learning is a side effect and must not break the tool that triggered it.
 * An unreadable file is left untouched (it may contain hand edits we must not destroy).
 */
export function updateLearnings(projectRoot: string, change: (draft: Learnings) => void): boolean {
  try {
    const loaded = loadLearnings(projectRoot)
    if (loaded.state === 'unreadable') return false

    // A missing file counts as "empty knowledge": nothing is created until there is something to remember.
    const before = knowledge(loaded.data)
    const draft = sanitize(JSON.parse(JSON.stringify(loaded.data)))
    change(draft)
    const next = sanitize(draft)
    if (knowledge(next) === before) return false

    next.updatedAt = today()
    next.mcpVersion = mcpVersion()
    const file = learningsPath(projectRoot)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, serialize(next), 'utf8')
    return true
  } catch {
    return false
  }
}

// --- capture (deterministic: no model involved) ------------------------------

export function learnConventions(
  projectRoot: string,
  facts: { serviceContext?: string; errorPrefix?: string; connection?: { name: string; style: 'named' | 'default' } }
): boolean {
  return updateLearnings(projectRoot, (draft) => {
    if (facts.serviceContext) draft.conventions.serviceContext = facts.serviceContext
    if (facts.errorPrefix) draft.conventions.errorPrefixes = uniqueSorted([...draft.conventions.errorPrefixes, facts.errorPrefix])
    if (facts.connection) draft.conventions.connections[facts.connection.name] = facts.connection.style
  })
}

export function learnDecision(projectRoot: string, key: DecisionKey, value: string): boolean {
  return updateLearnings(projectRoot, (draft) => {
    draft.decisions[key] = value
  })
}

/**
 * Counts each APPEARANCE of a failing rule once. A violation that survives several fix attempts
 * counts once; if it is fixed and comes back later, that is a new appearance.
 */
export function learnVerifyRun(projectRoot: string, failingRuleIds: string[]): boolean {
  const failing = uniqueSorted(failingRuleIds.filter((id) => id in HINTS))
  return updateLearnings(projectRoot, (draft) => {
    const previous = new Set(draft.lastVerify)
    for (const id of failing) {
      if (previous.has(id)) continue
      const current = draft.pitfalls[id]
      draft.pitfalls[id] = { count: (current?.count ?? 0) + 1, lastSeen: today() }
    }
    draft.lastVerify = failing
  })
}

// --- consult (what the agent reads) ------------------------------------------

export const ADVISORY_NOTICE =
  'Datos de usos anteriores de ESTE repo. Son consultivos: NO sustituyen ni relajan las reglas base (get_rules) ' +
  'ni el verificador, y si algo choca mandan siempre las reglas base. Usalos para PROPONER defaults y confirmalos con ' +
  'el usuario; nunca los apliques en silencio.'

export function renderLearnings(result: LoadResult): string {
  if (result.state === 'unreadable') {
    return `APRENDIZAJES DE ESTE REPO: el archivo ${LEARNINGS_FILE} no se pudo leer (JSON invalido). Se ignora y no se modifica; ` +
      'revisalo a mano. Continua con las reglas base.'
  }
  const { data } = result
  const lines: string[] = []

  const { serviceContext, errorPrefixes, connections } = data.conventions
  const connectionList = Object.entries(connections).map(([name, style]) => `${name} (${style})`)
  if (serviceContext) lines.push(`- Contexto del servicio (API_CONTEXT): ${serviceContext}`)
  if (errorPrefixes.length) lines.push(`- Prefijos de error ya usados (no los repitas en otro modulo): ${errorPrefixes.join(', ')}`)
  if (connectionList.length) lines.push(`- Conexiones TypeORM existentes: ${connectionList.join(', ')}`)
  const conventions = lines.splice(0)

  const decided: string[] = []
  if (data.decisions.authorization === 'enabled') decided.push('- Autorizacion: activada en este repo.')
  if (data.decisions.authorization === 'disabled') {
    decided.push(
      '- Autorizacion: el usuario decidio NO usarla en este repo. No vuelvas a preguntar; mencionalo en el reporte y ' +
        'cambiala solo si el usuario lo pide.'
    )
  }

  const recurring = Object.entries(data.pitfalls)
    .filter(([, p]) => p.count >= PITFALL_MIN_COUNT)
    .sort(([ai, a], [bi, b]) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen) || ai.localeCompare(bi))
    .slice(0, MAX_PITFALLS_SHOWN)
    .map(([id, p]) => `- ${id} (${p.count} veces, ultima ${p.lastSeen}): ${HINTS[id]}`)

  if (!conventions.length && !decided.length && !recurring.length) {
    return 'APRENDIZAJES DE ESTE REPO: todavia no hay nada util registrado. Continua con las reglas base.'
  }

  const sections = [`APRENDIZAJES DE ESTE REPO (consultivo)\n${ADVISORY_NOTICE}`]
  if (conventions.length) sections.push(['Convenciones:', ...conventions].join('\n'))
  if (decided.length) sections.push(['Decisiones del usuario registradas:', ...decided].join('\n'))
  if (recurring.length) {
    sections.push(['Errores que se repiten en este repo (los detecta el verificador; evitalos desde el inicio):', ...recurring].join('\n'))
  }
  return sections.join('\n\n').slice(0, MAX_OUTPUT_CHARS)
}
