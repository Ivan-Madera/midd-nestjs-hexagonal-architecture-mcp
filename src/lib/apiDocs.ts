import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { listConnections } from './connections.js'
import type { AdapterType } from './adapters.js'
import type { Motor } from './engines.js'

/**
 * API documentation generated from the REAL code of the service (controllers, DTOs, error catalogs),
 * never from what an agent remembers. Everything here is deterministic: the same code gives the same
 * files, so the documentation can be regenerated any time and a stale one is detectable.
 *
 * Per module:   src/<module>/contracts/<module>.api.md      contract for the frontend
 *               src/<module>/diagrams/<module>.flow.mmd     Mermaid sequence diagram (one per module)
 * Per service:  docs/api/README.md                          index of the contracts
 *               docs/api/middleware.postman_collection.json one collection, a folder per module (opt-in)
 *               docs/ARCHITECTURE.md                        Mermaid architecture-beta overview (opt-in)
 */

export const API_DOCS_BANNER = 'Generado por midd-nestjs-hexagonal-architecture-mcp (generate_api_docs). No lo edites a mano: se regenera desde el codigo.'

export type FieldDoc = { name: string; type: string; required: boolean }
export type ErrorDoc = { code: string; title: string; status: number }
export type EndpointDoc = {
  method: 'POST'
  /** Path after /{context}/api/v{version}, without leading slash: "inventory/retrieveStock". */
  path: string
  version: string
  handler: string
  resourceType: string
  controllerClass: string
  applicationClass?: string
  adapterClass?: string
  adapterKind?: AdapterType
  /** adapter http: the external API this endpoint calls (read from the adapter) */
  upstream?: { api: string; verb: string; path: string }
  applicationMethod?: string
  requestFields: FieldDoc[]
  responseFields: FieldDoc[]
  responseIsList: boolean
  public: boolean
}
export type ModuleDoc = {
  module: string
  endpoints: EndpointDoc[]
  errors: ErrorDoc[]
  connection?: { name: string; motor?: Motor }
  /** names of the external APIs the module consumes (http adapters) */
  externalApis: string[]
}
export type ServiceDoc = {
  context: string
  port: string
  authorization: boolean
  modules: ModuleDoc[]
}

// --- reading the code -------------------------------------------------------------------------------

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')

/** Removes comments but keeps string literals (a URL inside a string must not look like a comment). */
export function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out += c
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') {
          out += text[i]
          i++
        }
        out += text[i] ?? ''
        i++
      }
      out += quote
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, accept, out)
    else if (accept(full)) out.push(full)
  }
  return out
}

const classNameOf = (text: string): string | undefined => /export\s+class\s+(\w+)/.exec(text)?.[1]

/** Resolves a relative import of `name` found in `text` to a .ts file path. */
function resolveImport(fromFile: string, text: string, name: string): string | undefined {
  const re = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'(\\.[^']*)'`)
  const spec = re.exec(text)?.[1]
  if (!spec) return undefined
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate
  return undefined
}

/** Fields of a class / interface / type literal body: `name?: type`, with decorators that make it optional. */
export function parseFields(text: string, typeName: string): FieldDoc[] {
  const clean = stripComments(text)
  const head = new RegExp(`export\\s+(?:class|interface)\\s+${typeName}\\b[^{]*\\{`).exec(clean)
  if (!head) return []
  let depth = 1
  let i = head.index + head[0].length
  const start = i
  while (i < clean.length && depth > 0) {
    if (clean[i] === '{') depth++
    else if (clean[i] === '}') depth--
    i++
  }
  const body = clean.slice(start, i - 1)
  const fields: FieldDoc[] = []
  let optionalByDecorator = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('@')) {
      if (/^@IsOptional\b/.test(line)) optionalByDecorator = true
      continue
    }
    const field = /^(?:public\s+|readonly\s+)*(\w+)(\?)?\s*:\s*([^;=]+?)\s*[;,]?$/.exec(line)
    if (field) {
      fields.push({ name: field[1], type: field[3].trim(), required: !field[2] && !optionalByDecorator })
    }
    optionalByDecorator = false
  }
  return fields
}

function loadFieldsFrom(file: string | undefined, typeName: string): FieldDoc[] {
  return file ? parseFields(read(file), typeName) : []
}

/** Attributes of the request: controller -> RequestJsonApiDTO -> createRequestDataJsonApi(X) -> class X. */
function requestFieldsOf(controllerFile: string, controllerText: string, bodyType: string): FieldDoc[] {
  const dtoFile = resolveImport(controllerFile, controllerText, bodyType)
  if (!dtoFile) return []
  const dtoText = stripComments(read(dtoFile))
  const attributes = /createRequestDataJsonApi\(\s*(\w+)\s*\)/.exec(dtoText)?.[1]
  if (!attributes) return []
  const attributesFile = resolveImport(dtoFile, dtoText, attributes) ?? dtoFile
  return loadFieldsFrom(attributesFile, attributes)
}

function unwrapType(raw: string): { name: string; list: boolean } {
  let name = raw.replace(/\s*\|\s*(null|undefined)/g, '').trim()
  const array = /^(\w+)\[\]$/.exec(name) ?? /^Array<(\w+)>$/.exec(name)
  if (array) return { name: array[1], list: true }
  name = name.replace(/^Promise<(.*)>$/, '$1').trim()
  const inner = /^(\w+)\[\]$/.exec(name) ?? /^Array<(\w+)>$/.exec(name)
  return inner ? { name: inner[1], list: true } : { name, list: false }
}

/** `async method(...): Promise<X>` of the application interface that backs a controller. */
function responseOf(moduleDir: string, applicationMethod: string): { fields: FieldDoc[]; list: boolean } {
  const interfaces = walk(join(moduleDir, 'core', 'application', 'interfaces'), (f) => f.endsWith('.ts'))
  const entities = walk(join(moduleDir, 'core', 'domain', 'entities'), (f) => f.endsWith('.ts'))
  for (const file of interfaces) {
    const text = stripComments(read(file))
    const match = new RegExp(`\\b${applicationMethod}\\s*\\([^)]*\\)\\s*:\\s*([^;\\n]+)`).exec(text)
    if (!match) continue
    const { name, list } = unwrapType(match[1].trim())
    for (const entityFile of entities) {
      const fields = parseFields(read(entityFile), name)
      if (fields.length) return { fields, list }
    }
    return { fields: [], list }
  }
  return { fields: [], list: false }
}

function errorsOf(moduleDir: string): ErrorDoc[] {
  const files = walk(moduleDir, (f) => /\.error\.ts$/.test(f))
  const found = new Map<string, ErrorDoc>()
  for (const file of files) {
    const text = stripComments(read(file))
    const starts = [...text.matchAll(/code:\s*'([^']+)'/g)]
    starts.forEach((m, index) => {
      const code = m[1]
      if (!code || /-0{3,4}$/.test(code) || code.includes('<')) return
      const segment = text.slice(m.index ?? 0, starts[index + 1]?.index ?? text.length)
      const title = /title:\s*'((?:[^'\\]|\\.)*)'/.exec(segment)?.[1]
      const status = /status:\s*(\d+)/.exec(segment)?.[1]
      if (title && status) found.set(code, { code, title: title.replace(/\\'/g, "'"), status: Number(status) })
    })
  }
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code))
}

function adapterOf(moduleDir: string, caseSlug: string): { cls?: string; kind?: AdapterType; upstream?: EndpointDoc['upstream'] } {
  const adapters = join(moduleDir, 'infrastructure', 'adapters')
  const sp = join(adapters, `${caseSlug}.sp.adapter.ts`)
  const orm = join(adapters, `${caseSlug}.typeorm.adapter.ts`)
  const moduleText = walk(join(moduleDir, 'infrastructure'), (f) => f.endsWith('.module.ts'))
    .map((f) => stripComments(read(f)))
    .join('\n')
  // An external API adapter: the API name and the first call (the principal method) are read from its code.
  const httpFile = join(adapters, `${caseSlug}.http.adapter.ts`)
  if (existsSync(httpFile) && (moduleText.includes(`${caseSlug}.http.adapter`) || (!existsSync(sp) && !existsSync(orm)))) {
    const text = stripComments(read(httpFile))
    const api = /externalApis\.(\w+)\.baseUrl/.exec(text)?.[1]
    const call = /this\.http\.(get|post|put)\(\s*this\.url\('([^']*)'\)/.exec(text)
    return {
      cls: classNameOf(text),
      kind: 'http',
      upstream: api && call ? { api, verb: call[1].toUpperCase(), path: call[2] } : undefined
    }
  }
  // The SP adapter wins only when the module is wired to it (both files can exist after a switch).
  if (existsSync(sp) && (moduleText.includes(`${caseSlug}.sp.adapter`) || !existsSync(orm)))
    return { cls: classNameOf(read(sp)), kind: 'sp' }
  if (existsSync(orm)) return { cls: classNameOf(read(orm)), kind: 'typeorm' }
  return {}
}

function connectionOf(moduleDir: string, projectRoot: string): ModuleDoc['connection'] {
  const text = walk(moduleDir, (f) => f.endsWith('.ts')).map((f) => stripComments(read(f))).join('\n')
  const name = /['"](\w+)Connection['"]/.exec(text)?.[1]
  const connections = listConnections(projectRoot)
  const chosen = connections.find((c) => c.name === name) ?? (name ? undefined : connections[0])
  return chosen ? { name: chosen.name, motor: chosen.motor } : name ? { name } : undefined
}

function envValue(projectRoot: string, key: string): string | undefined {
  const text = read(join(projectRoot, '.env.example'))
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text)
  return m?.[1].trim() || undefined
}

/** Reads the whole service. Controllers under src/shared (the health probe) are infrastructure, not API. */
export function scanService(projectRoot: string): ServiceDoc {
  const src = join(projectRoot, 'src')
  const modules: ModuleDoc[] = []
  if (existsSync(src)) {
    for (const entry of readdirSync(src).sort()) {
      const moduleDir = join(src, entry)
      if (entry === 'shared' || !statSync(moduleDir).isDirectory()) continue
      const controllers = walk(moduleDir, (f) => f.endsWith('.controller.ts')).sort()
      const endpoints: EndpointDoc[] = []
      for (const file of controllers) {
        const text = stripComments(read(file))
        const header = /@Controller\(\s*(?:\{\s*path:\s*'([^']*)'\s*,\s*version:\s*'([^']*)'\s*\}|'([^']*)')\s*\)/.exec(text)
        if (!header) continue
        const base = (header[1] ?? header[3] ?? '').replace(/^\/+|\/+$/g, '')
        const version = header[2] ?? '1'
        const caseSlug = file.split(/[\\/]/).pop()!.replace(/\.controller\.ts$/, '')
        const controllerClass = classNameOf(text) ?? caseSlug
        const resourceType = /\btype:\s*'([^']*)'/.exec(text)?.[1] ?? base
        const application = walk(join(moduleDir, 'core', 'application', 'services'), (f) => f.endsWith(`${caseSlug}.application.ts`))[0]
        const applicationClass = application ? classNameOf(read(application)) : undefined
        const adapter = adapterOf(moduleDir, caseSlug)
        const handlers = [...text.matchAll(/@Post\(\s*(?:'([^']*)')?\s*\)([\s\S]*?)(?:public\s+)?async\s+(\w+)\s*\(([\s\S]*?)\)\s*:/g)]
        for (const h of handlers) {
          const decorators = h[2]
          const params = h[4]
          const bodyType = /@Body\(\)\s+\w+\s*:\s*(\w+)/.exec(params)?.[1]
          const after = text.slice((h.index ?? 0) + h[0].length)
          const applicationMethod = new RegExp(`this\\.\\w+\\.(\\w+)\\(`).exec(after)?.[1]
          const response = applicationMethod ? responseOf(moduleDir, applicationMethod) : { fields: [], list: false }
          endpoints.push({
            method: 'POST',
            path: [base, h[1] ?? ''].filter(Boolean).join('/'),
            version,
            handler: h[3],
            resourceType,
            controllerClass,
            applicationClass,
            adapterClass: adapter.cls,
            adapterKind: adapter.kind,
            upstream: adapter.upstream,
            applicationMethod,
            requestFields: bodyType ? requestFieldsOf(file, text, bodyType) : [],
            responseFields: response.fields,
            responseIsList: response.list,
            public: /@SkipAuthorization\b/.test(decorators)
          })
        }
      }
      if (endpoints.length === 0) continue
      // A module that only consumes external APIs has no database, so it has no connection to report.
      const readsDatabase = endpoints.some((e) => e.adapterKind !== 'http')
      modules.push({
        module: entry,
        endpoints,
        errors: errorsOf(moduleDir),
        connection: readsDatabase ? connectionOf(moduleDir, projectRoot) : undefined,
        externalApis: [...new Set(endpoints.flatMap((e) => (e.upstream ? [e.upstream.api] : [])))]
      })
    }
  }
  const appModule = stripComments(read(join(src, 'app.module.ts')))
  return {
    context: envValue(projectRoot, 'API_CONTEXT') ?? 'service',
    port: envValue(projectRoot, 'PORT') ?? '3000',
    authorization: existsSync(join(src, 'shared', 'authorization')) || /\bAuthorizationModule\b/.test(appModule),
    modules
  }
}

// --- rendering --------------------------------------------------------------------------------------

export const urlOf = (service: ServiceDoc, e: EndpointDoc): string => `/${service.context}/api/v${e.version}/${e.path}`

/** A Mermaid label: plain words only, so no character can break the diagram. */
const label = (text: string): string => text.replace(/[^A-Za-z0-9 _./:-]/g, ' ').replace(/\s+/g, ' ').trim()
const mermaidId = (text: string): string => text.replace(/[^A-Za-z0-9]/g, '_')

const SAMPLE: Record<string, unknown> = { string: 'string', number: 0, boolean: false }
const sampleValue = (type: string): unknown => (type in SAMPLE ? SAMPLE[type] : type.endsWith('[]') ? [] : 'string')

function sampleBody(e: EndpointDoc): string {
  const attributes: Record<string, unknown> = {}
  for (const f of e.requestFields) attributes[f.name] = sampleValue(f.type)
  return JSON.stringify({ data: { type: e.resourceType, attributes } }, null, 2)
}

const dbCall = (motor: Motor | undefined, kind: AdapterType | undefined): string => {
  if (kind !== 'sp') return 'Query via TypeORM'
  if (motor === 'postgres') return 'SELECT * FROM stored function'
  if (motor === 'mysql') return 'CALL stored procedure'
  return 'EXEC stored procedure'
}

export function renderSequence(service: ServiceDoc, m: ModuleDoc): string {
  const L: string[] = []
  L.push(`%% ${API_DOCS_BANNER}`)
  L.push('sequenceDiagram')
  L.push('    autonumber')
  L.push('    actor C as Client')
  L.push(`    participant G as Edge: ${service.authorization ? 'security, rate limit, authorization' : 'security, rate limit'}`)
  const db = m.connection ? `${m.connection.name}${m.connection.motor ? ` ${m.connection.motor}` : ''}` : 'Database'
  m.endpoints.forEach((e, i) => {
    L.push(`    participant X${i} as ${label(e.controllerClass)}`)
    L.push(`    participant A${i} as ${label(e.applicationClass ?? 'Application service')}`)
    L.push(`    participant R${i} as ${label(e.adapterClass ?? 'Repository adapter')}`)
  })
  const readsDatabase = m.endpoints.some((e) => e.adapterKind !== 'http')
  const callsApi = m.endpoints.some((e) => e.adapterKind === 'http')
  if (readsDatabase) L.push(`    participant D as DB ${label(db)}`)
  if (callsApi) L.push(`    participant E as External API ${label(m.externalApis.join(' '))}`)
  m.endpoints.forEach((e, i) => {
    L.push(`    Note over C,${readsDatabase ? 'D' : 'E'}: POST ${label(urlOf(service, e))}`)
    L.push(`    C->>G: POST ${label(urlOf(service, e))}`)
    L.push('    alt rate limit exceeded')
    L.push('        G-->>C: 429 Too Many Requests')
    if (service.authorization && !e.public) {
      L.push('    else no token or not authorized')
      L.push('        G-->>C: 401 or 403')
    }
    L.push('    else request allowed')
    L.push(`        G->>X${i}: JSON:API request`)
    L.push(`        X${i}->>A${i}: ${label(e.applicationMethod ?? e.handler)} attributes`)
    L.push(`        A${i}->>R${i}: ${label(e.applicationMethod ?? e.handler)} data`)
    if (e.adapterKind === 'http') {
      L.push(`        R${i}->>E: ${label(e.upstream ? `${e.upstream.verb} ${e.upstream.path}` : 'call the external API')}`)
      L.push(`        E-->>R${i}: response`)
    } else {
      L.push(`        R${i}->>D: ${dbCall(m.connection?.motor, e.adapterKind)}`)
      L.push(`        D-->>R${i}: result`)
    }
    L.push(`        R${i}-->>A${i}: domain entity`)
    L.push(`        A${i}-->>X${i}: result`)
    L.push('        alt business error')
    L.push(`            X${i}-->>C: error from the module catalog`)
    L.push('        else success')
    L.push(`            X${i}-->>C: 200 JSON:API data`)
    L.push('        end')
    L.push('    end')
  })
  return L.join('\n') + '\n'
}

const fieldTable = (fields: FieldDoc[], withRequired: boolean): string[] => {
  if (fields.length === 0) return ['_No se pudieron leer los campos del codigo; revisa el DTO._', '']
  const rows = withRequired ? ['| Campo | Tipo | Requerido |', '|---|---|---|'] : ['| Campo | Tipo |', '|---|---|']
  for (const f of fields) rows.push(withRequired ? `| \`${f.name}\` | \`${f.type}\` | ${f.required ? 'si' : 'no'} |` : `| \`${f.name}\` | \`${f.type}\` |`)
  return [...rows, '']
}

export function renderContract(service: ServiceDoc, m: ModuleDoc): string {
  const L: string[] = []
  L.push(`<!-- ${API_DOCS_BANNER} -->`)
  L.push(`# API del modulo \`${m.module}\``)
  L.push('')
  L.push('- Todos los endpoints son **POST**. Cualquier otro verbo responde 406.')
  L.push('- `Content-Type` obligatorio: `application/vnd.api+json` (otro valor responde 415).')
  L.push('- Peticiones y respuestas siguen JSON:API: `{ data: { type, attributes } }`.')
  L.push(service.authorization
    ? '- Autorizacion activa: envia `Authorization: Bearer <token>` (sin token 401, no autorizado 403), salvo en endpoints publicos.'
    : '- Este servicio no exige autorizacion.')
  L.push('- Todas las respuestas incluyen la cabecera `x-correlation-id`; los errores la repiten en `meta.correlationId`.')
  L.push('')
  for (const e of m.endpoints) {
    const url = urlOf(service, e)
    L.push(`## POST ${url}`)
    L.push('')
    L.push(`Handler: \`${e.controllerClass}.${e.handler}\`${e.applicationMethod ? ` -> \`${e.applicationMethod}\`` : ''}${e.upstream ? ` · API externa ${e.upstream.api}: ${e.upstream.verb} ${e.upstream.path}` : ''}${e.public ? ' · publico (sin autorizacion)' : ''}`)
    L.push('')
    L.push('### Request (`data.attributes`)')
    L.push('')
    L.push(...fieldTable(e.requestFields, true))
    L.push('```json')
    L.push(sampleBody(e))
    L.push('```')
    L.push('')
    L.push(`### Response 200 (${e.responseIsList ? 'lista de recursos' : 'un recurso'}, \`data.type\` = \`${e.resourceType}\`)`)
    L.push('')
    L.push(...fieldTable(e.responseFields, false))
    L.push('```json')
    const sample: Record<string, unknown> = {}
    for (const f of e.responseFields) sample[f.name] = sampleValue(f.type)
    const resource = { type: e.resourceType, id: '<uuid>', attributes: sample, links: { self: url } }
    L.push(JSON.stringify({ data: e.responseIsList ? [resource] : resource }, null, 2))
    L.push('```')
    L.push('')
    L.push('### curl')
    L.push('')
    L.push('```bash')
    L.push(`curl -X POST "http://localhost:${service.port}${url}" \\`)
    L.push("  -H 'Content-Type: application/vnd.api+json' \\")
    if (service.authorization && !e.public) L.push("  -H 'Authorization: Bearer <token>' \\")
    L.push(`  -d '${JSON.stringify(JSON.parse(sampleBody(e)))}'`)
    L.push('```')
    L.push('')
  }
  L.push('## Errores')
  L.push('')
  L.push('Forma: `{ "errors": [ { code, status, title, detail, suggestedActions, source: { pointer } } ], "meta": { correlationId } }`.')
  L.push('')
  L.push('| Codigo | Status | Titulo |')
  L.push('|---|---|---|')
  for (const e of m.errors) L.push(`| \`${e.code}\` | ${e.status} | ${e.title} |`)
  const common: Array<[string, number, string]> = [
    ['SERVICE-BADREQUEST-016', 400, 'Bad Request (JSON o DTO invalido)'],
    ['SERVICE-UNSUPPORTED_MEDIA_TYPE-013', 415, 'Content-Type distinto de application/vnd.api+json'],
    ['SERVICE-PAYLOADTOOLARGE-019', 413, 'Payload Too Large'],
    ['SERVICE-TOOMANYREQUESTS-017', 429, 'Too Many Requests (cabecera Retry-After)']
  ]
  if (service.authorization) {
    common.push(['SERVICE-UNAUTHORIZED-020', 401, 'Sin token'], ['SERVICE-FORBIDDEN-021', 403, 'No autorizado'])
  }
  for (const [code, status, title] of common) L.push(`| \`${code}\` | ${status} | ${title} |`)
  L.push('')
  return L.join('\n')
}

export function renderApiIndex(service: ServiceDoc, projectRoot: string): string {
  const L: string[] = [`<!-- ${API_DOCS_BANNER} -->`, '# API del servicio', '', `Contexto: \`/${service.context}\``, '']
  const contracts = existsSync(join(projectRoot, 'src'))
    ? readdirSync(join(projectRoot, 'src')).sort().filter((d) => existsSync(join(projectRoot, 'src', d, 'contracts', `${d}.api.md`)))
    : []
  L.push('| Modulo | Contrato | Diagrama |')
  L.push('|---|---|---|')
  for (const d of contracts) {
    const diagram = existsSync(join(projectRoot, 'src', d, 'diagrams', `${d}.flow.mmd`)) ? `[${d}.flow.mmd](../../src/${d}/diagrams/${d}.flow.mmd)` : '-'
    L.push(`| \`${d}\` | [${d}.api.md](../../src/${d}/contracts/${d}.api.md) | ${diagram} |`)
  }
  if (existsSync(join(projectRoot, 'docs', 'api', 'middleware.postman_collection.json'))) {
    L.push('', 'Coleccion de Postman: [middleware.postman_collection.json](middleware.postman_collection.json)')
  }
  L.push('')
  return L.join('\n')
}

type PostmanItem = { name: string; item?: PostmanItem[]; request?: unknown }
type PostmanCollection = {
  info: { name: string; schema: string; _postman_id?: string }
  item: PostmanItem[]
  variable: Array<{ key: string; value: string }>
}

const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

function postmanFolder(service: ServiceDoc, m: ModuleDoc): PostmanItem {
  return {
    name: m.module,
    item: m.endpoints.map((e) => {
      const header = [{ key: 'Content-Type', value: 'application/vnd.api+json' }]
      if (service.authorization && !e.public) header.push({ key: 'Authorization', value: 'Bearer {{token}}' })
      return {
        name: `POST ${e.path}`,
        request: {
          method: 'POST',
          header,
          body: { mode: 'raw', raw: sampleBody(e), options: { raw: { language: 'json' } } },
          url: {
            raw: `{{baseUrl}}${urlOf(service, e)}`,
            host: ['{{baseUrl}}'],
            path: [service.context, 'api', `v${e.version}`, ...e.path.split('/')]
          }
        }
      }
    })
  }
}

/** Merges ONLY this module's folder into the single collection; every other folder stays untouched. */
export function mergePostman(existingText: string | undefined, service: ServiceDoc, m: ModuleDoc): string {
  let collection: PostmanCollection | undefined
  if (existingText) {
    try {
      const parsed = JSON.parse(existingText) as PostmanCollection
      if (parsed && Array.isArray(parsed.item)) collection = parsed
    } catch {
      collection = undefined
    }
  }
  const current: PostmanCollection = collection ?? {
    info: { name: `${service.context} API`, schema: POSTMAN_SCHEMA },
    item: [],
    variable: []
  }
  current.info.schema = current.info.schema || POSTMAN_SCHEMA
  const folder = postmanFolder(service, m)
  const index = current.item.findIndex((i) => i.name === m.module)
  if (index >= 0) current.item[index] = folder
  else current.item.push(folder)
  current.item.sort((a, b) => a.name.localeCompare(b.name))
  const variables = current.variable ?? []
  const ensure = (key: string, value: string) => {
    if (!variables.some((v) => v.key === key)) variables.push({ key, value })
  }
  ensure('baseUrl', `http://localhost:${service.port}`)
  if (service.authorization) ensure('token', '')
  current.variable = variables
  return JSON.stringify(current, null, 2) + '\n'
}

/**
 * Architecture overview with Mermaid `architecture-beta`. `align column` needs Mermaid 11.16+; it is only
 * emitted when two or more nodes share a column (otherwise they can render on top of each other).
 */
export function renderArchitecture(service: ServiceDoc): string {
  const L: string[] = []
  L.push(`<!-- ${API_DOCS_BANNER} -->`)
  L.push('# Arquitectura del servicio', '')
  L.push(`Contexto \`/${service.context}\` · ${service.modules.length} modulo(s). Los diagramas de flujo por modulo estan en \`src/<modulo>/diagrams/\`.`, '')
  L.push('```mermaid')
  L.push('architecture-beta')
  L.push(`    group svc(cloud)[${label(service.context)}]`)
  L.push('    service client(internet)[Client]')
  L.push(`    service edge(server)[${service.authorization ? 'Edge security and authorization' : 'Edge security'}] in svc`)
  L.push('    client:R --> L:edge')
  if (service.authorization) {
    L.push('    service authapi(cloud)[Authorization API]')
    L.push('    edge:T --> B:authapi')
  }
  const moduleIds: string[] = []
  const dbIds = new Map<string, string>()
  for (const m of service.modules) {
    const id = `m_${mermaidId(m.module)}`
    moduleIds.push(id)
    L.push(`    service ${id}(server)[${label(m.module)}] in svc`)
    L.push(`    edge:R --> L:${id}`)
  }
  const apiIds = new Map<string, string>()
  for (const m of service.modules) {
    for (const api of m.externalApis) {
      if (!apiIds.has(api)) {
        const id = `api_${mermaidId(api)}`
        apiIds.set(api, id)
        L.push(`    service ${id}(internet)[${label(api)}]`)
      }
      L.push(`    m_${mermaidId(m.module)}:R --> L:${apiIds.get(api)}`)
    }
  }
  for (const m of service.modules) {
    if (!m.endpoints.some((e) => e.adapterKind !== 'http')) continue // only external APIs: no database
    const conn = m.connection
    const key = conn?.name ?? 'default'
    if (!dbIds.has(key)) {
      const id = `db_${mermaidId(key)}`
      dbIds.set(key, id)
      L.push(`    service ${id}(database)[${label(conn ? `${conn.name}${conn.motor ? ` ${conn.motor}` : ''}` : 'Database')}]`)
    }
    L.push(`    m_${mermaidId(m.module)}:R --> L:${dbIds.get(key)}`)
  }
  if (moduleIds.length >= 2) L.push(`    align column ${moduleIds.join(' ')}`)
  if (dbIds.size >= 2) L.push(`    align column ${[...dbIds.values()].join(' ')}`)
  if (apiIds.size >= 2) L.push(`    align column ${[...apiIds.values()].join(' ')}`)
  L.push('```', '')
  L.push('> `architecture-beta` se dibuja con Mermaid 11.1 o superior; las lineas `align column` requieren 11.16 o superior (GitHub y Visual Studio recientes lo soportan).', '')
  L.push('## Endpoints', '')
  L.push('| Modulo | Endpoint | Publico | Adapter |')
  L.push('|---|---|---|---|')
  for (const m of service.modules)
    for (const e of m.endpoints)
      L.push(`| \`${m.module}\` | \`POST ${urlOf(service, e)}\` | ${e.public ? 'si' : 'no'} | ${e.adapterKind ?? '-'} |`)
  L.push('')
  return L.join('\n')
}

// --- writing ----------------------------------------------------------------------------------------

export type GenerateOptions = {
  projectRoot: string
  /** Only these modules (default: all). */
  modules?: string[]
  /** Create/refresh the Postman collection even if it does not exist yet. Existing ones are always refreshed. */
  postman?: boolean
  /** Create/refresh docs/ARCHITECTURE.md even if it does not exist yet. An existing one is always refreshed. */
  architecture?: boolean
}
export type GenerateResult = { written: string[]; modules: string[]; unchanged: string[] }

function writeIfChanged(file: string, content: string, result: GenerateResult, root: string): void {
  const rel = relative(root, file).replace(/\\/g, '/')
  if (existsSync(file) && read(file) === content) {
    result.unchanged.push(rel)
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  result.written.push(rel)
}

export function generateApiDocs(options: GenerateOptions): GenerateResult {
  const { projectRoot } = options
  const result: GenerateResult = { written: [], modules: [], unchanged: [] }
  const service = scanService(projectRoot)
  const selected = service.modules.filter((m) => !options.modules?.length || options.modules.includes(m.module))
  const postmanFile = join(projectRoot, 'docs', 'api', 'middleware.postman_collection.json')
  const architectureFile = join(projectRoot, 'docs', 'ARCHITECTURE.md')
  const wantPostman = options.postman === true || existsSync(postmanFile)
  const wantArchitecture = options.architecture === true || existsSync(architectureFile)

  for (const m of selected) {
    result.modules.push(m.module)
    writeIfChanged(join(projectRoot, 'src', m.module, 'contracts', `${m.module}.api.md`), renderContract(service, m), result, projectRoot)
    writeIfChanged(join(projectRoot, 'src', m.module, 'diagrams', `${m.module}.flow.mmd`), renderSequence(service, m), result, projectRoot)
  }
  if (wantPostman && selected.length > 0) {
    let collection = existsSync(postmanFile) ? read(postmanFile) : undefined
    for (const m of selected) collection = mergePostman(collection, service, m)
    writeIfChanged(postmanFile, collection!, result, projectRoot)
  }
  if (selected.length > 0) writeIfChanged(join(projectRoot, 'docs', 'api', 'README.md'), renderApiIndex(service, projectRoot), result, projectRoot)
  if (wantArchitecture && service.modules.length > 0) writeIfChanged(architectureFile, renderArchitecture(service), result, projectRoot)
  return result
}

/** Non-fatal refresh used after generating code: documentation must never make a generation fail. */
export function refreshApiDocs(projectRoot: string, module?: string): GenerateResult | undefined {
  try {
    return generateApiDocs({ projectRoot, modules: module ? [module.toLowerCase()] : undefined })
  } catch {
    return undefined
  }
}
