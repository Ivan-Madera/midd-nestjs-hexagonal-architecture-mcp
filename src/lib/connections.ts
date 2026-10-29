import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { materializeTree } from './dataset.js'
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
  const missing = entries.filter(([key]) => !new RegExp(`^${key}=`, 'm').test(content))
  if (missing.length === 0) return 'unchanged'
  const separator = content === '' || content.endsWith('\n') ? '' : '\n'
  const block = [`# --- Database connection '${conexion}' (${profile.label}) ---`, ...missing.map(([k, v]) => `${k}=${v}`)]
  writeFileSync(file, `${content}${separator}${block.join('\n')}\n`, 'utf8')
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
