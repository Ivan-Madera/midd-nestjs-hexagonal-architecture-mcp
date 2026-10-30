import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { materializeTree } from './dataset.js'
import { addEnvEntries } from './envFile.js'
import { inspectProject } from './inspect.js'
import { addImport, appendToArray } from './moduleMerge.js'
import {
  PROFILES,
  connectionEnv,
  connectionNames,
  connectionPlaceholders,
  isMotor,
  type Motor
} from './engines.js'

/**
 * Database connections of a generated service.
 *
 * A connection is more than the TypeORM options: it needs its module, its options class, its block in
 * ConfigurationVariables, its variables in the Joi schema and in .env.example, its registration in
 * AppModule (imports + UtilsModule.register, which feeds the stored procedure service) and the driver
 * of its engine in package.json. `ensureConnection` creates ALL of it, once, for any engine, so the
 * first connection and every later one go through the same path and none is left half wired.
 */

const DATABASE_CONTEXT = ['src', 'shared', 'infrastructure', 'database-context']
const CONNECTION_NAME = /^[A-Z][A-Za-z0-9]{0,47}$/

export type ConnectionInfo = { name: string; motor?: Motor }

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

export const isValidConnectionName = (name: string): boolean => CONNECTION_NAME.test(name)

/** Connections already created in the project, with the engine read from their options class. */
export function listConnections(projectRoot: string): ConnectionInfo[] {
  const dir = join(projectRoot, ...DATABASE_CONTEXT)
  if (!existsSync(dir)) return []

  const optionsDir = join(dir, 'options')
  const optionTexts = existsSync(optionsDir)
    ? readdirSync(optionsDir)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => read(join(optionsDir, file)))
    : []

  const found: ConnectionInfo[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.module.ts'))) {
    const text = read(join(dir, file))
    const name = /name:\s*'(\w+)Connection'/.exec(text)?.[1]
    if (!name) continue
    const optionClass = /useClass:\s*(\w+)/.exec(text)?.[1]
    const optionText = optionClass
      ? optionTexts.find((candidate) => new RegExp(`export class ${optionClass}\\b`).test(candidate))
      : undefined
    const type = optionText ? /type:\s*'(\w+)'/.exec(optionText)?.[1] : undefined
    found.push({ name, motor: isMotor(type) ? type : undefined })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

// --- patches (each one idempotent) ------------------------------------------------------------

/** Appends an entry to `objectName: { ... }`, handling the comma and keeping trailing comments last. */
function appendToObject(content: string, objectName: string, entry: string, presence: RegExp): string | undefined {
  const open = new RegExp(`\\b${objectName}\\s*:\\s*\\{`).exec(content)
  if (!open) return undefined
  const start = open.index + open[0].length - 1

  let depth = 0
  let end = -1
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return undefined

  const inner = content.slice(start + 1, end)
  if (presence.test(inner)) return content

  let offset = start + 1
  let lastCodeEnd = -1
  let lastCodeChar = ''
  for (const line of inner.split('\n')) {
    const code = line.replace(/\/\/.*$/, '').replace(/\s+$/, '')
    if (code.trim().length > 0) {
      lastCodeEnd = offset + code.length
      lastCodeChar = code.trim().slice(-1)
    }
    offset += line.length + 1
  }
  const separator = lastCodeEnd === -1 || lastCodeChar === ',' ? '' : ','
  const at = lastCodeEnd === -1 ? start + 1 : lastCodeEnd
  return `${content.slice(0, at)}${separator}\n${entry}${content.slice(at)}`
}

type PatchStatus = 'patched' | 'unchanged' | 'anchor-missing' | 'file-missing'

function patchFile(file: string, change: (content: string) => string | undefined): PatchStatus {
  if (!existsSync(file)) return 'file-missing'
  const before = readFileSync(file, 'utf8')
  const after = change(before)
  if (after === undefined) return 'anchor-missing'
  if (after === before) return 'unchanged'
  writeFileSync(file, after, 'utf8')
  return 'patched'
}

function patchConfigurationVariables(file: string, conexion: string): PatchStatus {
  const env = connectionEnv(conexion)
  const entry =
    `      ${conexion}: {\n` +
    `        Server: process.env.${env.host},\n` +
    `        Port: Number(process.env.${env.port}),\n` +
    `        UserName: process.env.${env.username},\n` +
    `        Password: process.env.${env.password},\n` +
    `        DataBaseName: process.env.${env.name}\n` +
    `      }`
  return patchFile(file, (content) => appendToObject(content, 'database', entry, new RegExp(`\\b${conexion}\\s*:\\s*\\{`)))
}

function patchJoiSchema(file: string, conexion: string, motor: Motor): PatchStatus {
  const env = connectionEnv(conexion)
  const profile = PROFILES[motor]
  const block =
    `  // Database connection '${conexion}' (${profile.label})\n` +
    `  ${env.host}: Joi.string().required(),\n` +
    `  ${env.port}: Joi.number().default(${profile.defaultPort}),\n` +
    `  ${env.username}: Joi.string().required(),\n` +
    `  ${env.password}: Joi.string().required(),\n` +
    `  ${env.name}: Joi.string().required(),\n\n`
  return patchFile(file, (content) => {
    if (new RegExp(`\\b${env.host}\\s*:`).test(content)) return content
    const anchor = /^[ \t]*\/\/ Add here the rest of the service variables.*$/m
    if (anchor.test(content)) return content.replace(anchor, (line) => `${block}${line}`)
    const closing = content.lastIndexOf('})')
    return closing === -1 ? undefined : `${content.slice(0, closing)}\n${block}${content.slice(closing)}`
  })
}

function patchEnvExample(file: string, conexion: string, motor: Motor): PatchStatus {
  const env = connectionEnv(conexion)
  const profile = PROFILES[motor]
  const entries: Array<[string, string]> = [
    [env.host, 'localhost'],
    [env.port, String(profile.defaultPort)],
    [env.username, profile.sampleUser],
    [env.password, 'changeme'],
    [env.name, 'MyDatabase']
  ]
  const content = read(file)
  const next = addEnvEntries(content, `Database connection '${conexion}' (${profile.label})`, entries)
  if (next === content) return 'unchanged'
  writeFileSync(file, next, 'utf8')
  return 'patched'
}

function patchAppModule(file: string, conexion: string, motor: Motor): PatchStatus {
  const names = connectionNames(conexion, motor)
  const importLine = `import { ${names.moduleClass} } from './shared/infrastructure/database-context/${names.moduleFile}'`
  return patchFile(file, (content) => {
    let next = addImport(content, importLine)

    // UtilsModule.register([...]) feeds the DatabaseCommonService of each connection (stored procedures).
    // The search ignores comments (same length, so the indexes still point into the real text): a comment
    // that mentions the call must never be mistaken for it.
    const masked = next.replace(/\/\/.*$/gm, (comment) => ' '.repeat(comment.length))
    const register = /UtilsModule\.register\(\s*\[([^\]]*)\]\s*\)/.exec(masked)
    if (!register) return undefined
    const registered = [...register[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    if (!registered.includes(conexion)) {
      const list = [...registered, conexion].map((n) => `'${n}'`).join(', ')
      next = next.slice(0, register.index) + `UtilsModule.register([${list}])` + next.slice(register.index + register[0].length)
    }

    return appendToArray(next, 'imports', names.moduleClass)
  })
}

function patchPackageJson(file: string, motor: Motor): PatchStatus {
  const driver = PROFILES[motor].driver
  return patchFile(file, (content) => {
    const pkg = JSON.parse(content)
    pkg.dependencies = pkg.dependencies ?? {}
    // A runtime dependency: the production image installs with --omit=dev.
    if (pkg.devDependencies?.[driver.name]) delete pkg.devDependencies[driver.name]
    if (pkg.dependencies[driver.name]) return content
    pkg.dependencies[driver.name] = driver.version
    pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)))
    return `${JSON.stringify(pkg, null, 2)}\n`
  })
}

// --- public API --------------------------------------------------------------------------------

export type EnsureResult = {
  status: 'created' | 'exists' | 'engine-mismatch'
  motor: Motor
  existingMotor?: Motor
  written: string[]
  patched: string[]
  warnings: string[]
}

/**
 * Makes sure `conexion` exists in the project with the given engine. Creates every piece when it does not;
 * does nothing when it already exists with that engine; refuses (changing nothing) when it exists with
 * another engine, because switching the engine of a live connection is not something to do silently.
 */
export function ensureConnection(opts: { projectRoot: string; conexion: string; motor: Motor }): EnsureResult {
  const { projectRoot, conexion, motor } = opts
  if (!isValidConnectionName(conexion)) {
    throw new Error(`Invalid connection name "${conexion}": use PascalCase letters and digits, e.g. "Catalog".`)
  }

  const existing = listConnections(projectRoot).find((c) => c.name === conexion)
  if (existing) {
    const mismatch = existing.motor !== undefined && existing.motor !== motor
    return {
      status: mismatch ? 'engine-mismatch' : 'exists',
      motor,
      existingMotor: existing.motor,
      written: [],
      patched: [],
      warnings: []
    }
  }

  const folder = join(projectRoot, ...DATABASE_CONTEXT)
  const files = materializeTree({
    subdir: 'database',
    destRoot: folder,
    map: connectionPlaceholders(conexion, motor),
    overwrite: false
  })

  const warnings: string[] = []
  const patched: string[] = []
  const steps: Array<[string, PatchStatus, string]> = [
    ['src/shared/infrastructure/config/ConfigurationVariables.ts', patchConfigurationVariables(join(projectRoot, 'src/shared/infrastructure/config/ConfigurationVariables.ts'), conexion), 'declare the database block of the connection'],
    ['src/shared/infrastructure/config/joiSchema.ts', patchJoiSchema(join(projectRoot, 'src/shared/infrastructure/config/joiSchema.ts'), conexion, motor), 'validate its DB_* variables'],
    ['.env.example', patchEnvExample(join(projectRoot, '.env.example'), conexion, motor), 'add its DB_* variables'],
    ['src/app.module.ts', patchAppModule(join(projectRoot, 'src/app.module.ts'), conexion, motor), 'import its module and add it to UtilsModule.register'],
    ['package.json', patchPackageJson(join(projectRoot, 'package.json'), motor), `add the ${PROFILES[motor].driver.name} driver to dependencies`]
  ]
  for (const [path, status, what] of steps) {
    if (status === 'patched') patched.push(path)
    else if (status === 'anchor-missing' || status === 'file-missing') warnings.push(`${path}: could not patch (${status}). Do it by hand: ${what}.`)
  }

  return {
    status: 'created',
    motor,
    written: files.written.map((f) => `src/shared/infrastructure/database-context/${f}`),
    patched,
    warnings
  }
}

// --- connection names ------------------------------------------------------------------------------
//
// The user is never asked how to call a connection: the name follows from the engine (Mssql, Postgres,
// Mysql). An additional connection of an engine that already has one gets a number (Mssql2, Mssql3):
// a hyphen suffix would not be valid in a class name or an environment variable.

/** Name of the first connection of an engine: the engine itself in PascalCase. */
export const defaultConnectionName = (motor: Motor): string => motor.charAt(0).toUpperCase() + motor.slice(1)

/** First free name for a connection of this engine: Mssql, then Mssql2, Mssql3... */
export function nextConnectionName(motor: Motor, taken: string[]): string {
  const base = defaultConnectionName(motor)
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}${n}`)) return `${base}${n}`
}

export type ConnectionChoice = { name: string; exists: boolean } | { error: string }

/**
 * Which connection a use case works with.
 * - A name given explicitly is respected as is (the project may already use its own).
 * - Without a name: the single connection of the engine is reused; none yet means a new one named after the
 *   engine; several of that engine is ambiguous and the caller must say which one.
 * Read only: it never creates anything, so a dry run and a re-run give the same answer.
 */
export function chooseConnection(opts: { projectRoot: string; conexion?: string; motor?: Motor }): ConnectionChoice {
  const connections = listConnections(opts.projectRoot)
  if (opts.conexion) return { name: opts.conexion, exists: connections.some((c) => c.name === opts.conexion) }
  const list = (items: ConnectionInfo[]) => items.map((c) => `${c.name}${c.motor ? ` (${c.motor})` : ''}`).join(', ')
  if (!opts.motor) {
    if (connections.length === 1) return { name: connections[0].name, exists: true }
    return {
      error:
        connections.length === 0
          ? 'falta el motor de base de datos (mssql | postgres | mysql) para nombrar la conexion. Preguntaselo al usuario; no se asume.'
          : `hay varias conexiones (${list(connections)}): indica cual con "conexion", o el motor.`
    }
  }
  const sameEngine = connections.filter((c) => c.motor === opts.motor)
  if (sameEngine.length === 1) return { name: sameEngine[0].name, exists: true }
  if (sameEngine.length > 1) {
    return {
      error: `hay ${sameEngine.length} conexiones ${opts.motor} (${list(sameEngine)}): indica cual usar con "conexion".`
    }
  }
  return { name: nextConnectionName(opts.motor, connections.map((c) => c.name)), exists: false }
}

/**
 * REFACTOR: the project already has its connection, so it is found and reused, never asked and never created
 * on its own. (A connection is created in a refactor only when the user explicitly asks: `crear` in
 * chooseProjectConnection.)
 * - `default` style (a plain TypeOrmModule.forRoot): the adapters inject no connection name.
 * - `named` style: the project's own named connection (read from its code). Several of them is ambiguous.
 */
export function detectProjectConnection(opts: { projectRoot: string; style: 'named' | 'default' }): ConnectionChoice {
  if (opts.style === 'default') return { name: 'Default', exists: true }
  const found = inspectProject(opts.projectRoot).connection.namedConnections
  if (found.length === 1) return { name: found[0], exists: true }
  if (found.length === 0) {
    return {
      error:
        'el proyecto no tiene una conexion TypeORM y en un refactor el MCP NO crea una por su cuenta. Si el usuario pide expresamente que se cree una, pregunta el motor (mssql | postgres | mysql) y vuelve a llamar con crearConexion=true y motor. Si el proyecto usa la conexion por defecto de forRoot, pasa connectionStyle="default".'
    }
  }
  return { error: `el proyecto tiene varias conexiones nombradas (${found.join(', ')}): indica cual usa este caso con "conexion".` }
}

/**
 * The connection a use case works with, by mode.
 * - refactor: the one the project already has (detectProjectConnection).
 * - greenfield: named after its engine (chooseConnection).
 * A name passed by the caller only matters to tell several candidates apart (an additional connection such as
 * Mssql2, or one of several the project has); nobody has to give the name of the only connection there is.
 */
export function chooseProjectConnection(opts: {
  projectRoot: string
  mode: 'greenfield' | 'refactor'
  style: 'named' | 'default'
  conexion?: string
  motor?: Motor
  /** Refactor only: the user EXPLICITLY asked for a connection to be created. Without it a refactor never creates one. */
  crear?: boolean
}): ConnectionChoice {
  if (opts.style === 'default') return { name: opts.conexion ?? 'Default', exists: true }
  if (opts.mode === 'refactor') {
    if (opts.crear) {
      if (!opts.motor) {
        return { error: 'pediste crear una conexion en un refactor y falta el motor (mssql | postgres | mysql). Preguntaselo al usuario; no se asume.' }
      }
      // Same naming and reuse rules as a new service: the connection is named after its engine.
      return chooseConnection({ projectRoot: opts.projectRoot, conexion: opts.conexion, motor: opts.motor })
    }
    const found = inspectProject(opts.projectRoot).connection.namedConnections
    if (opts.conexion && (found.includes(opts.conexion) || found.length === 0)) {
      // The caller names it when there are several candidates, or when the project defines its connection in a
      // way the inspection cannot read (it is the project's own either way: it is never created).
      return { name: opts.conexion, exists: true }
    }
    return detectProjectConnection({ projectRoot: opts.projectRoot, style: opts.style })
  }
  return chooseConnection({ projectRoot: opts.projectRoot, conexion: opts.conexion, motor: opts.motor })
}

/**
 * Fills `connection.name` of a spec that does not name its connection. Returns an error message, or
 * undefined when the name is set.
 */
export function fillSpecConnection(
  spec: { connection: { name: string; style: 'named' | 'default'; engine?: Motor | 'none'; create?: boolean } },
  projectRoot: string,
  mode: 'greenfield' | 'refactor'
): string | undefined {
  if (spec.connection.name) return undefined
  const choice = chooseProjectConnection({
    projectRoot,
    mode,
    style: spec.connection.style,
    motor: spec.connection.engine === 'none' ? undefined : spec.connection.engine,
    crear: spec.connection.create
  })
  if ('error' in choice) return choice.error
  spec.connection.name = choice.name
  return undefined
}

/**
 * Same as fillSpecConnection when the mode is not known (record_architecture runs after the generation): a
 * connection the MCP created is found by the engine of the spec, otherwise it is the project's own (a refactor).
 */
export function fillSpecConnectionAnyMode(
  spec: { connection: { name: string; style: 'named' | 'default'; engine?: Motor | 'none'; create?: boolean } },
  projectRoot: string
): string | undefined {
  const engine = spec.connection.engine === 'none' ? undefined : spec.connection.engine
  const created = engine ? listConnections(projectRoot).some((c) => c.motor === engine) : false
  return fillSpecConnection(spec, projectRoot, created ? 'greenfield' : 'refactor')
}
