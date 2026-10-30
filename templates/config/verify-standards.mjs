#!/usr/bin/env node
/**
 * verify-standards.mjs
 * -------------------------------------------------------------------------
 * Structural, security and code-quality verification of the Middleware area
 * hexagonal standard. It covers what ESLint cannot see and what compiles clean
 * but breaks the architecture.
 *
 * Usage:  node scripts/verify-standards.mjs [--json]
 * Exit:   0 when compliant; 1 when there are blocking violations (CI / pre-commit).
 *
 * Severity:
 *   - ERROR -> blocks (exit 1). Mandatory security baseline, route convention,
 *     forbidden naming, hard code rules.
 *   - WARN  -> reported, does not block (conventions in adoption, soft smells).
 *
 * Every violation carries a stable RULE id (shared vocabulary with the MCP
 * guidelines) so an agent can read the report and fix it in a loop.
 * --json prints { errors: [...], warnings: [...] } for programmatic use.
 * -------------------------------------------------------------------------
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SRC = join(ROOT, 'src')
const AS_JSON = process.argv.includes('--json')

const errors = []
const warnings = []
const add = (list, rule, message, file = '', line = 0) =>
  list.push({ rule, message, file: file.replace(/\\/g, '/'), line })
const addError = (rule, message, file, line) => add(errors, rule, message, file, line)
const addWarn = (rule, message, file, line) => add(warnings, rule, message, file, line)

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (/^(node_modules|dist|coverage|\.git)$/.test(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const norm = (p) => p.replace(/\\/g, '/')
const rel = (p) => norm(relative(ROOT, p))
const stripComment = (line) => line.replace(/(^|\s)\/\/.*$/, '$1')
// Whole-file checks must look at code, not at a mention in a comment.
const readCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const allFiles = walk(SRC)
const tsFiles = allFiles.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
const contents = new Map(tsFiles.map((f) => [f, read(f)]))
// Identifiers listed in the `imports: [...]` array of a module, in order, ignoring
// comments. Order and presence are security properties (guards run in module order),
// so they are read from the real array and not from the whole text.
function importsArrayIdentifiers(moduleText) {
  const open = moduleText.match(/\bimports\s*:\s*\[/)
  if (!open) return []
  const start = open.index + open[0].length - 1
  let depth = 0
  let end = -1
  for (let i = start; i < moduleText.length; i++) {
    if (moduleText[i] === '[') depth++
    else if (moduleText[i] === ']' && --depth === 0) {
      end = i
      break
    }
  }
  if (end === -1) return []
  const withoutComments = moduleText
    .slice(start + 1, end)
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n')
  return withoutComments.match(/[A-Za-z_]\w*/g) ?? []
}
const anyFileMatches = (re, predicate = () => true) =>
  [...contents].some(([f, text]) => predicate(rel(f)) && re.test(text))

// ───────────────────────────────────────────────────────────────────────────
// 1. NAMING: historical typos and files with spaces (ERROR)
// ───────────────────────────────────────────────────────────────────────────
const typoRules = [
  { re: /infraestructure/i, fix: 'infrastructure' },
  { re: /htttp-server/i, fix: 'http-server' },
  { re: /Adapater/i, fix: 'Adapter' }
]
for (const file of allFiles) {
  const path = rel(file)
  const base = basename(file)
  for (const { re, fix } of typoRules) {
    if (re.test(path)) addError('NAMING_TYPO', `Typo in path; must be "${fix}".`, path)
  }
  if (/\s/.test(base)) addError('NAMING_SPACES', 'File name contains spaces.', path)
  if (/,entity\.ts$/i.test(base))
    addError('NAMING_TYPO', 'Comma before "entity"; must be "<name>.entity.ts" (with a dot).', path)
}

// 1b. Domain entities must be named "<Name>.entity.ts" (WARN, adoption)
for (const file of allFiles) {
  const path = rel(file)
  if (!/core\/domain\/entities\/[^/]+\.ts$/.test(path)) continue
  const base = basename(file)
  if (/\.spec\.ts$/i.test(base) || /,entity\.ts$/i.test(base)) continue
  if (!/\.entity\.ts$/i.test(base))
    addWarn('NAMING_ENTITY', 'Domain entity without ".entity.ts" suffix (canon: "<Name>.entity.ts").', path)
}

// ───────────────────────────────────────────────────────────────────────────
// 2. MANDATORY HTTP SECURITY BASELINE (ERROR) — main.ts + shared/infrastructure/security
// ───────────────────────────────────────────────────────────────────────────
const mainPath = join(SRC, 'main.ts')
const main = read(mainPath)
if (!main) {
  addError('MISSING_HTTP_SECURITY', 'src/main.ts not found: the security baseline cannot be verified.')
} else {
  const headerChecks = [
    [/helmet\s*\(/, 'Helmet is not applied.'],
    [/hsts/i, 'HSTS is not configured in Helmet.'],
    [/31536000/, 'HSTS must use max-age 31536000 (1 year).'],
    [/contentSecurityPolicy|content-security-policy/i, 'Content-Security-Policy is missing.'],
    [/noSniff|nosniff|X-Content-Type-Options/i, 'X-Content-Type-Options: nosniff is missing.'],
    [/referrerPolicy|referrer-policy/i, 'Referrer-Policy is missing.'],
    [/[Pp]ermissions-?[Pp]olicy/, 'Permissions-Policy is missing.'],
    [/enableCors|Access-Control-Allow-Origin/i, 'CORS is not configured.']
  ]
  for (const [re, msg] of headerChecks) {
    if (!re.test(main)) addError('MISSING_HTTP_SECURITY', msg, 'src/main.ts')
  }

  // CORS: the env var CORS_ALLOWED_ORIGINS defaults to '*' (tolerated), so a wildcard VALUE is fine.
  // What is not fine is hardcoding it in code: real origins could then never be configured.
  // It is a WARN, never an ERROR. An empty enableCors() is still blocked.
  if (/origin\s*:\s*(\[\s*)?['"`]\*['"`]/.test(main))
    addWarn(
      'CORS_WILDCARD',
      "CORS hardcodes origin '*'. Read the origins from CORS_ALLOWED_ORIGINS (config) so concrete origins can be set later without touching the code.",
      'src/main.ts'
    )
  if (/enableCors\(\s*\)/.test(main))
    addError('MISSING_HTTP_SECURITY', 'Empty enableCors(). Configure the allowed origins explicitly.', 'src/main.ts')

  // Cache-Control: no-store GLOBAL and registered before anything else.
  const noStoreDefined = anyFileMatches(/Cache-Control['"]?\s*,\s*['"]no-store/i)
  if (!noStoreDefined)
    addError('MISSING_CACHE_CONTROL', 'No global "Cache-Control: no-store" middleware found.', 'src/main.ts')
  else {
    const firstUse = main.match(/app\.use\(\s*([^\n]*)/)
    if (!firstUse || !/cacheControl|Cache-Control/i.test(firstUse[1]))
      addError(
        'MISSING_CACHE_CONTROL',
        'Cache-Control: no-store must be the FIRST app.use(...) so rejections (401/403/429/413) carry it too.',
        'src/main.ts'
      )
  }

  // Correlation id: caller-independent (generate-if-absent) and registered in main.ts.
  const correlationDefined = anyFileMatches(/x-correlation-id/i) && anyFileMatches(/randomUUID\s*\(/)
  const correlationRegistered = /app\.use\(\s*correlation/i.test(main)
  if (!correlationDefined || !correlationRegistered)
    addError(
      'MISSING_CORRELATION_ID',
      'End-to-end correlation id missing: an early global middleware must read x-correlation-id and GENERATE one (node:crypto randomUUID) when absent, and be registered in main.ts.',
      'src/main.ts'
    )

  // Rate limiting: THREE mandatory controls. C1 + C2 live in a registered global guard.
  const guardRegistered = anyFileMatches(/APP_GUARD/) && anyFileMatches(/maxRequestsPerWindow/, (p) => !/ConfigurationVariables/.test(p))
  const concurrency = anyFileMatches(/maxConcurrentPerIp/, (p) => !/ConfigurationVariables/.test(p))
  const payload = /maxJsonPayloadBytes|createPayloadSizeMiddleware/.test(main)
  const missingRl = []
  if (!guardRegistered) missingRl.push('C1 rate per IP (global APP_GUARD)')
  if (!concurrency) missingRl.push('C2 concurrency per IP')
  if (!payload) missingRl.push('C3 payload size middleware (413) in main.ts')
  if (missingRl.length)
    addError(
      'INCOMPLETE_RATE_LIMITING',
      `Rate limiting needs ALL THREE controls. Missing: ${missingRl.join(', ')}.`,
      'src/main.ts'
    )
  const appModule = read(join(SRC, 'app.module.ts'))
  if (appModule && !importsArrayIdentifiers(appModule).includes('SecurityModule'))
    addError('INCOMPLETE_RATE_LIMITING', 'SecurityModule (rate limit guard) is not imported in AppModule.', 'src/app.module.ts')

  // json parser for the org media type must also carry the JSON size limit.
  if (/json\s*\(\s*\{[^}]*vnd\.api\+json[^}]*\}\s*\)/s.test(main) && !/limit\s*:/.test(main))
    addWarn(
      'JSON_BODY_LIMIT',
      'The vnd.api+json body parser has no explicit "limit" (Express defaults to 100kb, below the 2MB policy).',
      'src/main.ts'
    )

  // Base URL convention: /{context}/api/v{N}/{resource}
  const prefixCall = main.match(/setGlobalPrefix\(\s*([^)]*)\)/)
  if (!prefixCall) {
    addError('MISSING_API_BASE_PATH', 'app.setGlobalPrefix(<API_CONTEXT>) is missing in main.ts.', 'src/main.ts')
  } else if (/['"`]/.test(prefixCall[1])) {
    addError(
      'MISSING_API_BASE_PATH',
      'The global prefix must come from config (API_CONTEXT), not a string literal, and must NEVER contain the version.',
      'src/main.ts'
    )
  }
  if (!/enableVersioning\s*\(/.test(main) || !/prefix\s*:\s*['"`]api\/v['"`]/.test(main))
    addError(
      'MISSING_API_BASE_PATH',
      "app.enableVersioning({ type: URI, prefix: 'api/v', defaultVersion: '1' }) is required (version lives in each controller).",
      'src/main.ts'
    )
}

// Env validation: every mandatory variable must be in the Joi schema AND in .env.example
const joiFile = allFiles.find((f) => /joiSchema\.ts$/i.test(f))
const mandatoryEnv = [
  'API_CONTEXT',
  'CORS_ALLOWED_ORIGINS',
  'RL_MAX_REQUESTS_PER_WINDOW',
  'RL_WINDOW_SECONDS',
  'RL_MAX_CONCURRENT_PER_IP',
  'RL_MAX_PAYLOAD_BYTES',
  'RL_MAX_JSON_PAYLOAD_BYTES',
  'RL_CACHE_TTL_MS',
  'RL_CACHE_MAX_ENTRIES',
  'RL_TRUSTED_PROXIES'
]
if (joiFile) {
  const joi = read(joiFile)
  // Code only: a default that is mentioned in a comment (whole line or trailing) is not a default.
  const joiCode = readCode(joiFile).split('\n').map(stripComment).join('\n')
  for (const key of mandatoryEnv) {
    if (!new RegExp(`\\b${key}\\s*:\\s*Joi\\.`).test(joiCode))
      addError('MISSING_ENV_VALIDATION', `${key} is not validated in the Joi schema (fail fast at boot).`, rel(joiFile))
    // Everything but the context has an area default, so a missing variable never leaves the edge unprotected.
    else if (key !== 'API_CONTEXT' && !new RegExp(`\\b${key}\\s*:\\s*Joi\\.[^\\n]*\\.default\\(`).test(joiCode))
      addError(
        'MISSING_ENV_DEFAULT',
        `${key} has no .default(...) in the Joi schema: when it is not configured the service would run without that protection.`,
        rel(joiFile)
      )
  }
} else if (main) {
  addError('MISSING_ENV_VALIDATION', 'No joiSchema.ts found: environment variables are not validated.')
}

// Every variable ConfigurationVariables reads must be validated in Joi: a variable that is read but not
// validated lets the service boot with `undefined` and fail later, far from the cause.
const configFile = allFiles.find((f) => /ConfigurationVariables\.ts$/.test(f))
if (configFile && joiFile) {
  const validated = new Set([...readCode(joiFile).matchAll(/([A-Z0-9_]+)\s*:\s*Joi\./g)].map((m) => m[1]))
  const readKeys = [...new Set([...readCode(configFile).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))]
  for (const key of readKeys) {
    if (!validated.has(key))
      addError(
        'MISSING_ENV_VALIDATION',
        `${key} is read in ConfigurationVariables but is not validated in the Joi schema (fail fast at boot).`,
        rel(configFile)
      )
  }
}

// .env.example synced with the Joi schema
const envExamplePath = join(ROOT, '.env.example')
if (joiFile) {
  const joiKeys = [...read(joiFile).matchAll(/([A-Z0-9_]+)\s*:\s*Joi\./g)].map((m) => m[1])
  if (!existsSync(envExamplePath)) {
    addWarn('ENV_EXAMPLE', '.env.example does not exist but there is a Joi schema.')
  } else {
    const envKeys = new Set(
      read(envExamplePath)
        .split(/\r?\n/)
        .map((l) => l.split('=')[0].trim())
        .filter((k) => k && !k.startsWith('#'))
    )
    for (const key of joiKeys)
      if (!envKeys.has(key)) addWarn('ENV_EXAMPLE', `.env.example is missing "${key}" (present in the Joi schema).`, '.env.example')
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2b. FORBIDDEN DEPENDENCIES (ERROR): the area bans these packages outright.
//     axios  -> use the native fetch (consumoHttp). Fewer dependencies, fewer CVEs.
//     uuid   -> use randomUUID from 'node:crypto'. The package is ESM-only and
//               crashes a CommonJS build at runtime even though it compiles.
// ───────────────────────────────────────────────────────────────────────────
const FORBIDDEN_DEPENDENCIES = {
  axios: "Use the native fetch (see shared/utils/services/consumoHttp.ts). axios is banned.",
  uuid: "Use randomUUID from 'node:crypto'. uuid is banned (ESM-only: compiles but crashes with ERR_REQUIRE_ESM)."
}
const packageJson = read(join(ROOT, 'package.json'))
if (packageJson) {
  let manifest = {}
  try {
    manifest = JSON.parse(packageJson)
  } catch {
    addError('FORBIDDEN_DEPENDENCY', 'package.json is not valid JSON.', 'package.json')
  }
  const declared = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies
  }
  for (const [name, advice] of Object.entries(FORBIDDEN_DEPENDENCIES)) {
    if (declared[name] || declared[`@types/${name}`])
      addError('FORBIDDEN_DEPENDENCY', `"${name}" is declared in package.json. ${advice}`, 'package.json')
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2c. AUTHORIZATION (opt-in: only checked when src/shared/authorization exists).
//     The service may legitimately NOT have it (the user decides), but when it does
//     it must be registered, ordered after the rate limit, validated and fail-closed.
// ───────────────────────────────────────────────────────────────────────────
const authorizationDir = join(SRC, 'shared', 'authorization')
if (existsSync(authorizationDir)) {
  const importedModules = importsArrayIdentifiers(read(join(SRC, 'app.module.ts')))
  if (!importedModules.includes('AuthorizationModule')) {
    addError('AUTHORIZATION_NOT_REGISTERED', 'src/shared/authorization exists but AuthorizationModule is not in the imports of AppModule: the endpoints are NOT protected.', 'src/app.module.ts')
  } else if (importedModules.indexOf('SecurityModule') > importedModules.indexOf('AuthorizationModule')) {
    addError(
      'AUTHORIZATION_ORDER',
      'AuthorizationModule must be imported AFTER SecurityModule so the rate limit guard runs first and floods never reach the authorizer.',
      'src/app.module.ts'
    )
  }
  if (joiFile && !/\bAUTHORIZATION_API_URL\s*:\s*Joi\./.test(read(joiFile)))
    addError('MISSING_ENV_VALIDATION', 'AUTHORIZATION_API_URL is not validated in the Joi schema (fail fast at boot).', rel(joiFile))
  const healthFile = join(SRC, 'shared', 'infrastructure', 'http-server', 'controllers', 'health.controller.ts')
  if (existsSync(healthFile) && !/@SkipAuthorization\s*\(/.test(readCode(healthFile)))
    addError(
      'HEALTH_NOT_PUBLIC',
      'The health probe must stay public when authorization is enabled: mark it @SkipAuthorization(), or it answers 401 and stops proving that the service started.',
      rel(healthFile)
    )
  const guardFile = join(authorizationDir, 'authorization.guard.ts')
  if (!existsSync(guardFile) || !/\bthrow\b/.test(readCode(guardFile)))
    addError('AUTHORIZATION_FAIL_OPEN', 'The authorization guard must reject (throw) when the request is not authorized.', rel(guardFile))
  for (const file of walk(join(authorizationDir, 'infrastructure')).filter((f) => f.endsWith('.ts'))) {
    if (/catch\s*(\([^)]*\))?\s*\{[^}]*allowed\s*:\s*true/.test(read(file)))
      addError('AUTHORIZATION_FAIL_OPEN', 'The verifier allows the request when the authorizer fails. It must be FAIL-CLOSED (unreachable = denied).', rel(file))
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2d. DATABASE CONNECTIONS: a connection a module uses must exist, be imported in AppModule and be
//     registered in UtilsModule.register (which feeds the stored procedure service). A connection
//     referenced but not created compiles fine and then fails at boot, or worse, a stored procedure
//     silently uses another connection. Only checked when the project has the database-context folder
//     of this standard (a refactor may own its connections elsewhere).
// ───────────────────────────────────────────────────────────────────────────
const databaseContext = join(SRC, 'shared', 'infrastructure', 'database-context')
if (existsSync(databaseContext)) {
  const withoutComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const declared = new Map()
  for (const file of walk(databaseContext).filter((f) => f.endsWith('.module.ts'))) {
    const code = withoutComments(read(file))
    const name = /name:\s*'(\w+)Connection'/.exec(code)?.[1]
    const className = /export class (\w+)/.exec(code)?.[1]
    if (name && className) declared.set(name, className)
  }
  const referenced = new Set()
  for (const [file, text] of contents) {
    if (norm(file).includes('/database-context/')) continue
    const code = withoutComments(text)
    for (const m of code.matchAll(/['"`](\w+)Connection['"`]/g)) referenced.add(m[1])
    for (const m of code.matchAll(/databaseServiceToken\(\s*'(\w+)'\s*\)/g)) referenced.add(m[1])
  }
  const appModuleText = readCode(join(SRC, 'app.module.ts'))
  const importedModules = importsArrayIdentifiers(appModuleText)
  const registerCall = /UtilsModule\.register\(\s*\[([^\]]*)\]/.exec(appModuleText)
  const registered = registerCall ? [...registerCall[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null
  for (const name of [...new Set([...referenced, ...declared.keys()])].sort()) {
    const className = declared.get(name)
    if (!className) {
      addError(
        'DB_CONNECTION_MISSING',
        `A module uses the connection "${name}" but no database module declares "${name}Connection". Create it with add_use_case / generate_from_spec (it needs the engine).`,
        'src/shared/infrastructure/database-context'
      )
      continue
    }
    if (!importedModules.includes(className))
      addError('DB_CONNECTION_MISSING', `${className} (connection "${name}") is not imported in AppModule: the service would not start.`, 'src/app.module.ts')
    if (registered && !registered.includes(name))
      addError('DB_CONNECTION_MISSING', `"${name}" is not in UtilsModule.register([...]): its stored procedures would have no database service.`, 'src/app.module.ts')
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. CONTROLLERS: POST-only, version declared in the controller
// ───────────────────────────────────────────────────────────────────────────
for (const file of tsFiles.filter((f) => /http-server\/controllers\/.*\.ts$/.test(norm(f)))) {
  const path = rel(file)
  const text = contents.get(file)
  const nonPost = text.match(/@(Get|Put|Patch|Delete|All|Head|Options)\s*\(/g) ?? []
  for (const verb of nonPost)
    addError(
      'NON_POST_ENDPOINT',
      `${verb.replace('(', '')}: only @Post endpoints are allowed (cybersecurity policy). Carry the intent in the JSON:API body.`,
      path
    )
  const controllerDecorator = text.match(/@Controller\s*\(([\s\S]*?)\)\s*\n/)
  if (controllerDecorator && !/version\s*:\s*['"`]\d+['"`]/.test(controllerDecorator[1]))
    addError(
      'MISSING_API_BASE_PATH',
      "The controller must declare its version: @Controller({ path: '<resource>', version: '1' }).",
      path
    )
  if (/@Version\s*\(/.test(text))
    addWarn('MISSING_API_BASE_PATH', 'Per-method @Version found: declare the version in @Controller({ path, version }).', path)
}

// ───────────────────────────────────────────────────────────────────────────
// 4. CODE RULES (line based). Each rule: id, severity, where it applies, test.
// ───────────────────────────────────────────────────────────────────────────
const MONEY_WORD =
  /(amount|monto|importe|precio|pago|payment|capital|interes|interest|enganche|downpayment|membership|membresia|tasa|rate|costo|\bcost\b|\bcat\b|total|balance|saldo)/i
const isConfig = (p) => /shared\/infrastructure\/config\//.test(p) || /ConfigurationVariables/.test(p)

const LINE_RULES = [
  {
    rule: 'ENV_DIRECT',
    severity: 'error',
    message: 'process.env read outside the typed config module. Use ConfigurationVariables / ConfigService.',
    applies: (p) => !isConfig(p),
    test: (l) => /\bprocess\.env\b/.test(l)
  },
  {
    rule: 'RAW_ERROR',
    severity: 'error',
    message: 'throw new Error(...). Throw GenericException with an entry of the module error catalog.',
    applies: (p) => !isConfig(p),
    test: (l) => /\bthrow\s+new\s+Error\s*\(/.test(l)
  },
  {
    rule: 'ESM_ONLY_IMPORT',
    severity: 'error',
    message: "Imports the banned `uuid` package (ESM-only: compiles but crashes with ERR_REQUIRE_ESM in a CommonJS build). Use `randomUUID` from 'node:crypto'.",
    applies: () => true,
    test: (l) => /\bfrom\s+['"]uuid['"]/.test(l) || /\brequire\s*\(\s*['"]uuid['"]\s*\)/.test(l)
  },
  {
    rule: 'FORBIDDEN_DEPENDENCY',
    severity: 'error',
    message: 'Imports the banned `axios` package. Use the native fetch (see shared/utils/services/consumoHttp.ts).',
    applies: () => true,
    test: (l) => /\bfrom\s+['"]axios['"]/.test(l) || /\brequire\s*\(\s*['"]axios['"]\s*\)/.test(l)
  },
  {
    rule: 'HTTP_IN_CORE',
    severity: 'error',
    message: 'Direct HTTP (fetch) inside core/. The domain and application layers reach the outside only through an outbound port implemented in infrastructure.',
    applies: (p) => /(^|\/)core\//.test(p),
    test: (l) => /(^|[^.\w])fetch\s*\(/.test(l)
  },
  {
    rule: 'CONSOLE_LOG',
    severity: 'error',
    message: 'console.* used. Use the LoggerService (structured logging, carries the correlation id).',
    applies: (p) => p !== 'src/main.ts',
    test: (l) => /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(l)
  },
  {
    rule: 'UNTYPED_MIDDLEWARE',
    severity: 'error',
    message: 'app.use((req, res, next) => ...) with untyped params breaks noImplicitAny (TS7006). Type them with Request/Response/NextFunction.',
    applies: () => true,
    test: (l) => /\bapp\.use\s*\(\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)\s*=>/.test(l) && !/:\s*(Request|Response|NextFunction)/.test(l)
  },
  {
    rule: 'SOURCE_IMPORT_OUTSIDE_INFRA',
    severity: 'error',
    message: 'Data source import (typeorm) inside core/. Only infrastructure adapters may know the data source.',
    applies: (p) => /(^|\/)core\//.test(p),
    test: (l) => /from\s+['"](typeorm|@nestjs\/typeorm)/.test(l)
  },
  {
    rule: 'FETCH_ALL_FILTER_IN_MEMORY',
    severity: 'error',
    message: 'find()/findAll() followed by .some/.find/.filter in memory. Push the filter to the database.',
    applies: () => true,
    test: (l) => /\b(findAll|find)\s*\(\s*\)\s*\)*\s*\.\s*(some|find|filter)\s*\(/.test(l)
  },
  {
    rule: 'UNBOUNDED_FIND_ALL',
    severity: 'warn',
    message: 'Unbounded find()/findAll() in an adapter. Lists must be paginated.',
    applies: (p) => /infrastructure\/adapters\//.test(p),
    test: (l) => /\.(findAll|find)\s*\(\s*\)/.test(l)
  },
  {
    rule: 'MONEY_AS_FLOAT',
    severity: 'error',
    message: 'Money coerced to a JS float. Use decimal.js and keep money as string at the boundary.',
    applies: () => true,
    test: (l) => /\b(parseFloat|parseInt|Number)\s*\([^)]*\)/.test(l) && MONEY_WORD.test(l)
  },
  {
    rule: 'HARDCODED_MONEY_CONSTANT',
    severity: 'error',
    message: 'Business money value hardcoded. It must come from the spec, config or a parameter. Ask or leave a marked TODO.',
    applies: () => true,
    test: (l) => {
      const m = /\bDecimal\s*\(\s*['"`]?(-?\d[\d_]*(?:\.\d+)?)['"`]?\s*\)/.exec(l)
      return !!m && Math.abs(parseFloat(m[1].replace(/_/g, ''))) > 1
    }
  },
  {
    rule: 'BLIND_CAST',
    severity: 'warn',
    message: 'Blind "as" cast on a row/entity. Map fields explicitly.',
    applies: (p) => /infrastructure\//.test(p),
    test: (l) => /\bas\s+[A-Z]\w*(Row|Entity|Dto)\b/.test(l)
  }
]

for (const [file, text] of contents) {
  const path = rel(file)
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = stripComment(raw)
    for (const r of LINE_RULES) {
      if (r.applies(path) && r.test(line)) {
        add(r.severity === 'error' ? errors : warnings, r.rule, r.message, path, i + 1)
      }
    }
  })

  // FAT_SERVICE_METHOD (soft): application/domain service methods of 100+ lines.
  if (/\.(application|domain\.service)\.ts$/.test(path) || /core\/(application|domain)\/services\//.test(path)) {
    const lines = text.split(/\r?\n/)
    const signature = /^ {2}(?:public |private |protected |async |static )*([A-Za-z_]\w*)\s*\([^)]*\)\s*(?::[^=]*)?\{?\s*$/
    for (let i = 0; i < lines.length; i++) {
      const m = signature.exec(lines[i])
      if (!m || ['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(m[1])) continue
      for (let j = i + 1; j < lines.length; j++) {
        if (/^ {2}\}/.test(lines[j])) {
          if (j - i + 1 >= 100)
            addWarn(
              'FAT_SERVICE_METHOD',
              `Method '${m[1]}' is ${j - i + 1} lines. Split it into named steps (SRP); move source mapping to the adapter.`,
              path,
              i + 1
            )
          i = j
          break
        }
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 5. STORED PROCEDURES (opt-in): the SP name must be declared in config (ERROR)
// ───────────────────────────────────────────────────────────────────────────
const spAdapters = allFiles.filter((f) => /\.sp\.adapter\.ts$/.test(norm(f)))
if (spAdapters.length > 0) {
  const cfg = allFiles.find((f) => /ConfigurationVariables\.ts$/.test(f))
  const declaredSps = new Set([...read(cfg ?? '').matchAll(/([A-Za-z0-9_]+)\s*:\s*process\.env\./g)].map((m) => m[1]))
  for (const file of spAdapters) {
    const path = rel(file)
    const used = [...read(file).matchAll(/storedProcedures\.([A-Za-z0-9_]+)/g)].map((m) => m[1])
    if (used.length === 0)
      addError('SP_NOT_DECLARED', 'SP adapter without ConfigurationVariables.storedProcedures.<Name>. SP is opt-in: declare it in config.', path)
    for (const sp of used)
      if (!declaredSps.has(sp))
        addError('SP_NOT_DECLARED', `Stored procedure "${sp}" is not declared in ConfigurationVariables (register it in config + joiSchema + .env.example).`, path)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 6. API DOCUMENTATION (warning): every module with controllers has its contract and its diagram, and the
//    contract still lists every endpoint of the code. Regenerate with the generate_api_docs tool.
// ------------------------------------------------------------------------------------------------
for (const entry of existsSync(SRC) ? readdirSync(SRC) : []) {
  const moduleDir = join(SRC, entry)
  if (entry === 'shared' || !statSync(moduleDir).isDirectory()) continue
  const controllers = walk(moduleDir).filter((f) => f.endsWith('.controller.ts'))
  const endpoints = []
  for (const file of controllers) {
    const code = readCode(file)
    const header = /@Controller\(\s*(?:\{\s*path:\s*'([^']*)'|'([^']*)')/.exec(code)
    if (!header) continue
    const base = (header[1] ?? header[2] ?? '').replace(/^\/+|\/+$/g, '')
    for (const m of code.matchAll(/@Post\(\s*(?:'([^']*)')?\s*\)/g)) endpoints.push([base, m[1] ?? ''].filter(Boolean).join('/'))
  }
  if (endpoints.length === 0) continue
  const contract = join(moduleDir, 'contracts', `${entry}.api.md`)
  const diagram = join(moduleDir, 'diagrams', `${entry}.flow.mmd`)
  if (!existsSync(contract))
    addWarn('API_DOCS_MISSING', `Module "${entry}" has no API contract (src/${entry}/contracts/${entry}.api.md).`, `src/${entry}`)
  else {
    const text = read(contract)
    for (const path of endpoints)
      if (!text.includes(`/${path}`)) addWarn('API_DOCS_STALE', `The contract of "${entry}" does not list the endpoint /${path}: it is out of date.`, rel(contract))
  }
  if (!existsSync(diagram))
    addWarn('API_DOCS_MISSING', `Module "${entry}" has no flow diagram (src/${entry}/diagrams/${entry}.flow.mmd).`, `src/${entry}`)
}
// ───────────────────────────────────────────────────────────────────────────
// 7. ERROR CODES: <PREFIX>-<SLUG>-<NNN>, a number from 001 to 999 that is a sequence per prefix. Two errors of the
//    domain catalogs must never share a number under the same prefix (error), and the number has three digits (warning).
// ------------------------------------------------------------------------------------------------
const errorCatalogs = allFiles.filter((f) => /[\\/]core[\\/](domain|application)[\\/]errors[\\/][^\\/]+\.error\.ts$/.test(f))
const seenErrorNumbers = new Map()
for (const file of errorCatalogs) {
  for (const m of readCode(file).matchAll(/code\s*:\s*'([A-Z][A-Z0-9_]*)-([A-Z][A-Z0-9_]*)-(\d+)'/g)) {
    const prefix = m[1]
    const digits = m[3]
    const code = `${m[1]}-${m[2]}-${m[3]}`
    const number = Number(digits)
    if (number === 0) continue // the generic fallback entry of a catalog
    if (digits.length !== 3 || number > 999)
      addWarn('ERROR_CODE_FORMAT', `"${code}": the number must have three digits, from 001 to 999.`, rel(file))
    const key = `${prefix}-${number}`
    if (seenErrorNumbers.has(key))
      addError('ERROR_CODE_DUPLICATE', `"${code}" repeats the number ${digits} of the prefix ${prefix}, already used in ${seenErrorNumbers.get(key)}. Each error takes the next free number.`, rel(file))
    else seenErrorNumbers.set(key, rel(file))
  }
}
// ───────────────────────────────────────────────────────────────────────────
// 8. SECRETS: a real .env (credentials, URLs) must be ignored by git. .env.example is the one that is committed.
// ------------------------------------------------------------------------------------------------
if (existsSync(join(ROOT, '.env'))) {
  const ignored = /^\/?\.env(\*|\.\*)?\s*$/m.test(read(join(ROOT, '.gitignore')))
  if (!ignored)
    addError('ENV_NOT_IGNORED', '.env exists but .gitignore does not ignore it: its credentials would be committed. Add a line ".env" to .gitignore.', '.gitignore')
}
// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────
if (AS_JSON) {
  console.log(JSON.stringify({ errors, warnings }, null, 2))
  process.exit(errors.length ? 1 : 0)
}

const format = (v) => `[${v.rule}] ${v.file ? `${v.file}${v.line ? `:${v.line}` : ''} - ` : ''}${v.message}`
// ASCII only on purpose: Windows consoles (code page 850/437) garble UTF-8 box characters and symbols.
const line = '-'.repeat(70)
console.log(line)
console.log('  Standards verification - midd-nestjs-hexagonal-architecture')
console.log(line)

if (warnings.length) {
  console.log(`\n  [WARN] ${warnings.length} warning(s) (do not block):`)
  for (const w of warnings) console.log(`     - ${format(w)}`)
}

if (errors.length) {
  console.log(`\n  [ERROR] ${errors.length} error(s) (block):`)
  for (const e of errors) console.log(`     - ${format(e)}`)
  console.log(`\n${line}`)
  console.log('  RESULT: FAILED. Fix the errors above.')
  console.log(line)
  process.exit(1)
}

console.log(`\n${line}`)
console.log(warnings.length ? '  RESULT: OK (with warnings). No blocking errors.' : '  RESULT: OK. Standard met.')
console.log(line)
process.exit(0)
