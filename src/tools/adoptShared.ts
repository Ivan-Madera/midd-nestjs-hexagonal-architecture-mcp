import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { materializeTree, materializeFile, readTemplate } from '../lib/dataset.js'
import { buildPlaceholderMap } from '../lib/placeholders.js'
import { extractJoiDefaults, extractJoiKeys } from '../lib/env.js'
import { addEnvEntries, sectionOf } from '../lib/envFile.js'
import { addImport, appendToArray } from '../lib/moduleMerge.js'
import { inspectProject } from '../lib/inspect.js'
import { learnConventions } from '../lib/learnings.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// adopt_shared_layer (REFACTOR): brings the mandatory shared layer of the area into an EXISTING NestJS project.
//
// A refactor must not run scaffold_service (it would replace the project's main.ts, app.module.ts, package.json),
// but the project still needs the same security, observability, configuration and error layer as a new service.
// Without this tool an agent writes that layer by hand and invents names, values and error codes.
//
// What it does, never destructive:
//   - writes the files of the shared layer that are MISSING under src/shared (an existing file is never touched),
//   - adds to package.json only the dependencies that are missing (an existing version is never changed),
//   - adds to .env.example only the variables that are missing, with the defaults of the area,
//   - copies scripts/verify-standards.mjs when the project has none.
// main.ts and app.module.ts belong to the project: they are patched ONLY with patchEntry=true, which the agent passes
// after the user agreed. Otherwise the tool lists the exact changes to make.
// ---------------------------------------------------------------------------

export const adoptSharedLayerSchema = {
  projectRoot: s.projectRoot,
  prefijoApi: s.prefijoApi.optional(),
  patchEntry: z
    .boolean()
    .default(false)
    .describe(
      'Si true, agrega a src/main.ts y src/app.module.ts del proyecto lo que les falte de la capa obligatoria (solo inserciones, nada se borra). El agente lo pone en true SOLO despues de que el usuario acepto que se toquen esos archivos. Con false (default) no los toca y devuelve los cambios exactos a hacer.'
    )
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const BANNED: Record<string, string> = {
  axios: 'cambialo por el fetch nativo a traves de HttpClientService (shared/utils/services/http-client.service.ts)',
  uuid: "cambialo por randomUUID de 'node:crypto'"
}
const PARALLEL_SECURITY = ['@nestjs/throttler', 'express-rate-limit']

/** The dependencies the shared layer imports, taken from the template package (the single source of versions). */
function sharedDependencies(): Record<string, string> {
  const snippet = JSON.parse(readTemplate('config/package.snippet.json'))
  return snippet.dependencies ?? {}
}

function patchPackageJson(projectRoot: string): { added: string[]; banned: string[]; parallel: string[] } {
  const file = join(projectRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  const added: string[] = []
  pkg.dependencies = pkg.dependencies ?? {}
  for (const [name, version] of Object.entries(sharedDependencies())) {
    if (declared[name]) continue
    pkg.dependencies[name] = version
    added.push(`${name}@${version}`)
  }
  pkg.scripts = pkg.scripts ?? {}
  if (!pkg.scripts['verify:standards']) {
    pkg.scripts['verify:standards'] = 'node scripts/verify-standards.mjs'
    added.push('script verify:standards')
  }
  if (added.length) {
    pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  return {
    added,
    banned: Object.keys(BANNED).filter((name) => all[name] || all[`@types/${name}`]),
    parallel: PARALLEL_SECURITY.filter((name) => all[name])
  }
}

function patchEnvExample(projectRoot: string, prefijoApi?: string): string[] {
  const joi = readTemplate('shared/infrastructure/config/joi-schema.ts')
  const defaults = extractJoiDefaults(joi)
  const file = join(projectRoot, '.env.example')
  let content = read(file)
  const before = content
  const added: string[] = []
  for (const key of extractJoiKeys(joi)) {
    const value = key === 'API_CONTEXT' ? prefijoApi ?? '' : defaults[key] ?? ''
    const next = addEnvEntries(content, sectionOf(key), [[key, value]])
    if (next !== content) added.push(key)
    content = next
  }
  if (content !== before) writeFileSync(file, content, 'utf8')
  return added
}

// --- main.ts / app.module.ts ------------------------------------------------------------------

type EntryChange = { what: string; done: boolean }

const MAIN_IMPORTS = {
  config: [
    "import { ConfigType } from '@nestjs/config'",
    "import ConfigurationVariables from './shared/infrastructure/config/configuration-variables'"
  ],
  cache: ["import { cacheControlNoStore } from './shared/infrastructure/security/cache-control.middleware'"],
  correlation: ["import { correlationMiddleware } from './shared/infrastructure/observability/correlation.middleware'"],
  payload: ["import { createPayloadSizeMiddleware } from './shared/infrastructure/security/payload-size.middleware'"],
  helmet: ["import helmet from 'helmet'"],
  permissions: ["import { NextFunction, Request, Response } from 'express'"],
  filter: ["import { AllExceptionsFilter } from './shared/infrastructure/http-server/exception-filters/generic-exception-filter'"]
}

/**
 * The pieces of the mandatory edge that main.ts lacks, as code to insert right after NestFactory.create (so
 * Cache-Control stays the first app.use). A piece the project already has is never added twice.
 */
function mainChanges(main: string, app: string) {
  const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const lines: string[] = []
  const imports: string[] = []
  const changes: string[] = []
  const missing = {
    cache: !/cacheControlNoStore|Cache-Control/.test(code),
    correlation: !/app\.use\(\s*correlation/i.test(code),
    payload: !/createPayloadSizeMiddleware/.test(code),
    helmet: !/\bhelmet\s*\(/.test(code),
    permissions: !/Permissions-Policy/.test(code),
    cors: !/enableCors\s*\(/.test(code),
    filter: !/useGlobalFilters\s*\(/.test(code)
  }
  const needsConfig = missing.payload || missing.cors
  if (needsConfig) {
    imports.push(...MAIN_IMPORTS.config)
    lines.push(`  const standardConfig = ${app}.get<ConfigType<typeof ConfigurationVariables>>(ConfigurationVariables.KEY)`)
  }
  if (missing.cache) {
    imports.push(...MAIN_IMPORTS.cache)
    lines.push(`  ${app}.use(cacheControlNoStore)`)
    changes.push('Cache-Control: no-store como PRIMER app.use')
  }
  if (missing.correlation) {
    imports.push(...MAIN_IMPORTS.correlation)
    lines.push(`  ${app}.use(correlationMiddleware)`)
    changes.push('correlation id (valida el que llega, genera uno si falta)')
  }
  if (missing.payload) {
    imports.push(...MAIN_IMPORTS.payload)
    lines.push(
      `  ${app}.use(\n    createPayloadSizeMiddleware({\n      maxBytes: standardConfig.security.rateLimit.maxPayloadBytes,\n      maxJsonBytes: standardConfig.security.rateLimit.maxJsonPayloadBytes\n    })\n  )`
    )
    changes.push('limite de tamano del payload (C3, 413)')
  }
  if (missing.helmet) {
    imports.push(...MAIN_IMPORTS.helmet)
    lines.push(
      `  ${app}.use(\n    helmet({\n      hsts: { maxAge: 31536000, includeSubDomains: true },\n      contentSecurityPolicy: {\n        directives: { defaultSrc: [\"'self'\"], objectSrc: [\"'none'\"], frameAncestors: [\"'none'\"], baseUri: [\"'self'\"] }\n      },\n      noSniff: true,\n      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },\n      frameguard: { action: 'deny' }\n    })\n  )`
    )
    changes.push('cabeceras de seguridad (helmet)')
  }
  if (missing.permissions) {
    imports.push(...MAIN_IMPORTS.permissions)
    lines.push(
      `  ${app}.use((_req: Request, res: Response, next: NextFunction) => {\n    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')\n    res.removeHeader('X-Powered-By')\n    next()\n  })`
    )
    changes.push('Permissions-Policy y sin X-Powered-By')
  }
  if (missing.cors) {
    lines.push(
      `  const allowAnyOrigin = standardConfig.security.corsAllowedOrigins.includes('*')\n  ${app}.enableCors({\n    origin: allowAnyOrigin ? '*' : standardConfig.security.corsAllowedOrigins,\n    methods: ['POST'],\n    allowedHeaders: ['Authorization', 'Content-Type', 'x-correlation-id'],\n    exposedHeaders: ['x-correlation-id', 'Retry-After']\n  })`
    )
    changes.push('CORS desde CORS_ALLOWED_ORIGINS')
  }
  if (missing.filter) {
    imports.push(...MAIN_IMPORTS.filter)
    lines.push(`  ${app}.useGlobalFilters(new AllExceptionsFilter())`)
    changes.push('filtro global de errores (sobre JSON:API del area)')
  }
  return { lines, imports, changes, existing: Object.entries(missing).filter(([, m]) => !m).map(([k]) => k) }
}

function patchMain(file: string, apply: boolean): { changes: EntryChange[]; notes: string[] } {
  const main = read(file)
  const notes: string[] = []
  if (!main) return { changes: [], notes: ['No existe src/main.ts: no se puede cablear el borde HTTP.'] }
  const create = /^([ \t]*)const\s+(\w+)\s*=\s*await\s+NestFactory\.create[^\n]*\n/m.exec(main)
  if (!create) {
    return { changes: [], notes: ['src/main.ts no tiene "const app = await NestFactory.create(...)": agrega a mano el borde HTTP de config/main.ts del MCP (get_template).'] }
  }
  const planned = mainChanges(main, create[2])
  if (planned.existing.includes('helmet') || planned.existing.includes('cors'))
    notes.push('src/main.ts ya configura helmet y/o CORS: no se duplicaron. Revisa que coincidan con el estandar (get_template config/main.ts).')
  if (!/setGlobalPrefix\s*\(/.test(main) || !/enableVersioning\s*\(/.test(main))
    notes.push(
      'RUTAS (decision del usuario): el estandar sirve /<prefijo>/api/v{N}/<recurso> (setGlobalPrefix + enableVersioning) y solo POST. Las rutas actuales del proyecto cambiarian y eso rompe a quien lo consume: muestrale la tabla ruta actual -> ruta nueva y preguntale. No se agrego.'
    )
  if (!/vnd\.api\+json/.test(main))
    notes.push('El estandar acepta solo Content-Type application/vnd.api+json (ValidationHeaderMiddleware y json({ type, limit })). Tambien cambia el contrato: preguntale al usuario antes de agregarlo.')
  const changes = planned.changes.map((what) => ({ what, done: apply }))
  if (apply && planned.lines.length) {
    let next = main
    for (const line of planned.imports) next = addImport(next, line)
    const at = /^([ \t]*)const\s+(\w+)\s*=\s*await\s+NestFactory\.create[^\n]*\n/m.exec(next)!
    const end = at.index + at[0].length
    const block = `  // --- Mandatory HTTP edge of the area (adopt_shared_layer; order matters, outermost first) ---\n${planned.lines.join('\n')}\n`
    next = next.slice(0, end) + block + next.slice(end)
    writeFileSync(file, next, 'utf8')
  }
  return { changes, notes }
}

function patchAppModule(
  file: string,
  apply: boolean,
  opts: { projectConfig: boolean; connections: string[] }
): { changes: EntryChange[]; notes: string[] } {
  const content = read(file)
  const notes: string[] = []
  if (!content) return { changes: [], notes: ['No existe src/app.module.ts: registra a mano SecurityModule y HealthModule.'] }
  const wanted: Array<{ id: string; line: string; element: string }> = []
  if (!opts.projectConfig)
    wanted.push({ id: 'GlobalSettingModule', line: "import { GlobalSettingModule } from './shared/infrastructure/global-setting.module'", element: 'GlobalSettingModule' })
  if (!/\bUtilsModule\b/.test(content))
    wanted.push({
      id: 'UtilsModule',
      line: "import { UtilsModule } from './shared/utils/utils.module'",
      element: `UtilsModule.register([${opts.connections.map((c) => `'${c}'`).join(', ')}])`
    })
  wanted.push({ id: 'SecurityModule', line: "import { SecurityModule } from './shared/infrastructure/security/security.module'", element: 'SecurityModule' })
  wanted.push({ id: 'HealthModule', line: "import { HealthModule } from './shared/infrastructure/http-server/health.module'", element: 'HealthModule' })
  const missing = wanted.filter((w) => !new RegExp(`imports:\\s*\\[[\\s\\S]*?\\b${w.id}\\b`).test(content))
  if (/\bAuthorizationModule\b/.test(content) && missing.some((w) => w.id === 'SecurityModule'))
    notes.push('AppModule ya importa AuthorizationModule: deja SecurityModule ANTES de el (el rate limit corre primero).')
  const changes = missing.map((w) => ({ what: `AppModule importa ${w.element}`, done: apply }))
  if (apply && missing.length) {
    let next = content
    for (const w of missing) {
      next = addImport(next, w.line)
      next = appendToArray(next, 'imports', w.element)
    }
    writeFileSync(file, next, 'utf8')
  }
  return { changes, notes }
}

export async function adoptSharedLayer(args: { projectRoot: string; prefijoApi?: string; patchEntry: boolean }) {
  const { projectRoot } = args
  const fail = (text: string) => ({ content: [{ type: 'text' as const, text: `ERROR: ${text}` }], isError: true })
  if (!existsSync(join(projectRoot, 'package.json')) || !existsSync(join(projectRoot, 'src'))) {
    return fail('no encontre package.json y src/ en projectRoot. adopt_shared_layer es para un proyecto NestJS EXISTENTE (refactor); un servicio nuevo se crea con scaffold_service.')
  }
  const inspection = inspectProject(projectRoot)
  if (!inspection.isNestProject) return fail('el proyecto no usa NestJS (@nestjs/core). Este MCP solo refactoriza servicios NestJS.')

  // The connections the project already has: the default forRoot one is registered as 'Default'.
  const connections =
    inspection.connection.style === 'forRoot-default'
      ? ['Default']
      : inspection.connection.namedConnections
  const map = buildPlaceholderMap({
    dominio: 'Sample',
    caso: 'Sample',
    entidad: 'Sample',
    metodo: 'retrieveSample',
    param: 'id',
    accion: 'sample',
    prefijoError: 'SERVICE',
    rutaDominio: 'sample',
    tipoRecurso: 'sample',
    conexion: connections[0] ?? 'Default',
    servicio: args.prefijoApi
  })
  const shared = materializeTree({ subdir: 'shared', destRoot: join(projectRoot, 'src', 'shared'), map, overwrite: false })
  const written = shared.written.map((f) => `src/shared/${f}`)
  const verifier = materializeFile({
    templateRelPath: 'config/verify-standards.mjs',
    destFullPath: join(projectRoot, 'scripts', 'verify-standards.mjs'),
    map,
    overwrite: false
  })
  if (verifier.written.length) written.push('scripts/verify-standards.mjs')
  mkdirSync(projectRoot, { recursive: true })
  const pkg = patchPackageJson(projectRoot)
  const env = patchEnvExample(projectRoot, args.prefijoApi)

  // The project may already load its own configuration: a second ConfigModule.forRoot is not added.
  const rel = (p: string) => relative(projectRoot, p).replace(/\\/g, '/')
  const projectConfigFiles = walk(join(projectRoot, 'src'))
    .filter((f) => f.endsWith('.ts') && !rel(f).startsWith('src/shared/'))
    .filter((f) => /ConfigModule\.forRoot\s*\(/.test(read(f)))
    .map(rel)
  const main = patchMain(join(projectRoot, 'src', 'main.ts'), args.patchEntry)
  const appModule = patchAppModule(join(projectRoot, 'src', 'app.module.ts'), args.patchEntry, {
    projectConfig: projectConfigFiles.length > 0,
    connections
  })

  if (args.prefijoApi) learnConventions(projectRoot, { serviceContext: args.prefijoApi })

  const ownInfra = [
    inspection.existingInfra.configVariables && `configuracion: ${inspection.existingInfra.configVariables}`,
    inspection.existingInfra.jsonApiResponse && `respuesta JSON:API: ${inspection.existingInfra.jsonApiResponse}`,
    inspection.existingInfra.errorType && `tipo de error: ${inspection.existingInfra.errorType}`,
    inspection.existingInfra.jsonApiMiddleware && `middleware JSON:API: ${inspection.existingInfra.jsonApiMiddleware}`
  ].filter(Boolean) as string[]
  const entry = [...main.changes, ...appModule.changes]
  const pendingEntry = entry.filter((c) => !c.done)
  const lines: string[] = [
    `Capa compartida del estandar adoptada en ${projectRoot} (refactor: solo se agrego lo que faltaba, no se borro ni se piso nada).`,
    '',
    `Escritos (${written.length}):`,
    ...written.map((f) => `  + ${f}`),
    shared.skipped.length ? `Ya existian y NO se tocaron (${shared.skipped.length}): ${shared.skipped.map((f) => `src/shared/${f}`).join(', ')}` : '',
    pkg.added.length ? `package.json: agregado ${pkg.added.join(', ')} (las versiones existentes no se cambiaron).` : 'package.json: ya tenia todo lo que la capa necesita.',
    env.length ? `.env.example: agregadas con el valor por defecto del area ${env.join(', ')}.` : '.env.example: ya tenia todas las variables de la capa.',
    '',
    entry.length === 0
      ? 'main.ts y app.module.ts ya tienen todo el borde obligatorio.'
      : args.patchEntry
        ? `Cableado en main.ts / app.module.ts (solo inserciones): ${entry.map((c) => c.what).join('; ')}.`
        : `main.ts y app.module.ts NO se tocaron (son del proyecto). Les falta: ${pendingEntry.map((c) => c.what).join('; ')}. AGENTE: muestraselo al usuario y, si acepta, vuelve a llamar adopt_shared_layer con patchEntry=true. No lo escribas a mano.`,
    '',
    'Pendientes y decisiones:',
    ...main.notes.map((n) => `  - ${n}`),
    ...appModule.notes.map((n) => `  - ${n}`),
    projectConfigFiles.length
      ? `  - OBLIGATORIO: el proyecto ya carga su configuracion (${projectConfigFiles.join(', ')}), asi que NO se agrego GlobalSettingModule. Agrega ConfigurationVariables (src/shared/infrastructure/config/configuration-variables.ts) a su "load" y las claves de src/shared/infrastructure/config/joi-schema.ts a su validacion; sin eso las variables RL_* llegan sin valor y el arranque falla.`
      : '',
    ownInfra.length
      ? `  - El proyecto tiene infra propia (${ownInfra.join('; ')}). No se borro. Los casos nuevos usan la de src/shared (infraStyle="dataset"); migrar o retirar la propia es decision del usuario.`
      : '',
    ...pkg.banned.map((name) => `  - Dependencia prohibida "${name}": ${BANNED[name]}. No se quito: hazlo al migrar el codigo que la usa.`),
    ...pkg.parallel.map((name) => `  - "${name}" duplica el rate limit del area (SecurityModule): retiralo cuando el borde estandar este cableado.`),
    '  - AGENTE: no escribas a mano seguridad, configuracion, correlation id ni codigos de error del borde: vienen de esta capa. No borres codigo ni tests del proyecto sin que el usuario lo apruebe, y nunca antes de un build verde.',
    '  - Siguiente: npm install, npm run build y verify_standards. Despues migra los casos de uso con add_use_case / generate_from_spec (mode="refactor", infraStyle="dataset").'
  ]
  return { content: [{ type: 'text' as const, text: lines.filter((l) => l !== '').join('\n') }] }
}
