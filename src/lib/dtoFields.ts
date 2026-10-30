/**
 * Poblado de DTOs input/output y entidades request/response desde el spec.
 *
 * El spec declara dtos.input (lo que el llamador envía, SIN id/created_at) y
 * dtos.output (la proyección segura devuelta). Este módulo materializa esos
 * campos en:
 *   - el DTO de attributes (infrastructure/.../dto/<caso>.dto.ts) con validadores
 *     class-validator (input),
 *   - la entidad request de dominio (<Request>.entity.ts) (input),
 *   - la entidad response de dominio (<Entidad>.entity.ts) (output).
 *
 * Es andamiaje: los tipos se derivan del spec (string/number/boolean). SIEMPRE
 * estampa una NOTA de que los campos y validadores deben revisarse contra el
 * esquema real (el MCP no inventa columnas).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { domainFolder, toKebab, toPropertyName } from './names.js'
import type { AdapterType } from './adapters.js'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type DtoResult = { patched: string[]; warnings: string[] }

type FieldMap = Record<string, unknown>

const NOTA =
  '// NOTA (agente/usuario): campos derivados del spec (dtos). Revisa tipos,\n' +
  '  // obligatoriedad y validadores contra el esquema real antes de cerrar el caso.'

/** Mapea un tipo del spec a un tipo TS. */
function tsType(t: unknown): string {
  const s = String(t).toLowerCase()
  if (s.includes('number') || s.includes('int') || s.includes('float')) return 'number'
  if (s.includes('bool')) return 'boolean'
  return 'string'
}

/** Decoradores class-validator según el tipo. */
function validators(t: string): { decorators: string[]; imports: string[] } {
  if (t === 'number') return { decorators: ['@IsNumber()', '@IsNotEmpty()'], imports: ['IsNumber', 'IsNotEmpty'] }
  if (t === 'boolean') return { decorators: ['@IsBoolean()'], imports: ['IsBoolean'] }
  return { decorators: ['@IsString()', '@IsNotEmpty()'], imports: ['IsString', 'IsNotEmpty'] }
}

/** Valid sample value for a field, by type (used to build the happy-path test fixture). */
function sampleLiteral(field: string, t: unknown): string {
  const type = tsType(t)
  if (type === 'number') return '1'
  if (type === 'boolean') return 'true'
  return `'test-${field}'`
}

/**
 * The generated application spec ships a placeholder fixture ({ <caso>: 'valor' }) that knows nothing
 * about the spec. Once dtos.input exists (and business rules are generated from it), that fixture is
 * rejected by the very rules the generator wrote, so the generated test fails on a fresh service and the
 * error test passes for the wrong reason. Build the fixture from the declared input instead.
 */
function patchApplicationSpecFixture(file: string, casoCamel: string, input: FieldMap): boolean {
  const content = read(file)
  if (!content) return false
  const placeholder = `{ ${casoCamel}: 'valor' }`
  if (!content.includes(placeholder)) return false
  const fixture = `{ ${Object.keys(input)
    .map((k) => `${k}: ${sampleLiteral(k, input[k])}`)
    .join(', ')} }`
  writeFileSync(file, content.split(placeholder).join(fixture), 'utf8')
  return true
}

/** Reemplaza el cuerpo de una clase `export class <Name> { ... }` por nuevas líneas. */
function replaceClassBody(content: string, className: string, bodyLines: string[]): string | null {
  const re = new RegExp(`(export class ${className}[^{]*\\{)([\\s\\S]*?)(\\n\\})`)
  const m = content.match(re)
  if (!m) return null
  const body = '\n  ' + NOTA + '\n' + bodyLines.map((l) => '  ' + l).join('\n') + '\n'
  return content.replace(re, `$1${body}$3`)
}

/** Pobla el DTO de attributes (input) con validadores. */
function patchAttributesDto(file: string, className: string, input: FieldMap): boolean {
  let content = read(file)
  if (!content) return false
  const keys = Object.keys(input)
  if (keys.length === 0) return false

  const neededImports = new Set<string>()
  const lines: string[] = []
  for (const k of keys) {
    const t = tsType(input[k])
    const v = validators(t)
    v.imports.forEach((i) => neededImports.add(i))
    for (const d of v.decorators) lines.push(d)
    lines.push(`${k}: ${t}`)
    lines.push('')
  }
  if (lines[lines.length - 1] === '') lines.pop()

  const replaced = replaceClassBody(content, className, lines)
  if (!replaced) return false
  content = replaced

  // Asegura el import de class-validator con los decoradores usados.
  const importList = [...neededImports].join(', ')
  if (/from 'class-validator'/.test(content)) {
    content = content.replace(
      /import \{([^}]*)\} from 'class-validator'/,
      (full, inside) => {
        const have = new Set(inside.split(',').map((s: string) => s.trim()).filter(Boolean))
        neededImports.forEach((i) => have.add(i))
        return `import { ${[...have].join(', ')} } from 'class-validator'`
      }
    )
  } else {
    content = `import { ${importList} } from 'class-validator'\n` + content
  }

  writeFileSync(file, content, 'utf8')
  return true
}

/** Pobla una entidad de dominio pura con campos (sin validadores). */
function patchEntity(file: string, className: string, fields: FieldMap, optional: boolean): boolean {
  let content = read(file)
  if (!content) return false
  const keys = Object.keys(fields)
  if (keys.length === 0) return false
  const lines = keys.map((k) => `${k}${optional ? '?' : ''}: ${tsType(fields[k])}`)
  const replaced = replaceClassBody(content, className, lines)
  if (!replaced) return false
  writeFileSync(file, replaced, 'utf8')
  return true
}

/**
 * Response entity of the domain: a class whose fields are @Expose'd, because the adapter builds it with Mapper
 * (plainToInstance + excludeExtraneousValues): a field without @Expose is dropped.
 *   - property name: camelCase of the name as it comes from the source ("tipo_bloqueo" -> tipoBloqueo)
 *   - stored procedure / external API: @Expose({ name: '<name as the source sends it>' })
 *   - TypeORM: the adapter maps from the TypeORM entity, whose property has the same camelCase name -> @Expose()
 */
function patchResponseEntity(file: string, className: string, fields: FieldMap, source: AdapterType): boolean {
  const content = read(file)
  if (!content) return false
  const keys = Object.keys(fields)
  if (keys.length === 0) return false
  const lines: string[] = []
  for (const key of keys) {
    const property = toPropertyName(key)
    lines.push(source === 'typeorm' || property === key ? '@Expose()' : `@Expose({ name: '${key}' })`)
    lines.push(`${property}?: ${tsType(fields[key])}`)
    lines.push('')
  }
  lines.pop()
  let replaced = replaceClassBody(content, className, lines)
  if (!replaced) return false
  if (!/^import .*from 'class-transformer'/m.test(replaced)) replaced = `import { Expose } from 'class-transformer'\n${replaced}`
  writeFileSync(file, replaced, 'utf8')
  return true
}

/** TypeORM entity of the table: one @Column per output field, named after the column as it comes. */
function patchOrmEntity(file: string, fields: FieldMap): boolean {
  const content = read(file)
  if (!content) return false
  const close = content.lastIndexOf('}')
  if (close === -1) return false
  const added: string[] = []
  for (const key of Object.keys(fields)) {
    const property = toPropertyName(key)
    if (new RegExp(`\\b${property}\\s*[?!]?\\s*:`).test(content)) continue
    added.push(`  @Column({ name: '${key}' })\n  ${property}: ${tsType(fields[key])}\n`)
  }
  if (added.length === 0) return false
  writeFileSync(file, `${content.slice(0, close)}\n${added.join('\n')}${content.slice(close)}`, 'utf8')
  return true
}

/**
 * Aplica dtos.input al DTO de attributes + entidad request, y dtos.output a la
 * entidad response. Idempotente en la práctica (reemplaza el cuerpo de la clase).
 */
export function applyDtoFields(opts: {
  projectRoot: string
  dominio: string
  caso: string
  attributesClass: string // p.ej. "RetrieveProductAttributes"
  requestEntity: string // p.ej. "RetrieveProductRequest"
  responseEntity: string // p.ej. "Product"
  input: FieldMap
  output: FieldMap
  adapterType?: AdapterType // where the response comes from (default: stored procedure)
}): DtoResult {
  const { projectRoot, dominio, caso, attributesClass, requestEntity, responseEntity, input, output } = opts
  const source = opts.adapterType ?? 'sp'
  const patched: string[] = []
  const warnings: string[] = []
  const domLower = domainFolder(dominio)
  const casoCamel = caso.charAt(0).toLowerCase() + caso.slice(1)
  const casoKebab = toKebab(caso)
  const base = join(projectRoot, 'src', domLower)

  const dtoFile = join(base, 'infrastructure/http-server/dto', `${casoKebab}.dto.ts`)
  const reqFile = join(base, 'core/domain/entities', `${toKebab(requestEntity)}.entity.ts`)
  const resFile = join(base, 'core/domain/entities', `${toKebab(responseEntity)}.entity.ts`)

  if (Object.keys(input).length > 0) {
    try {
      if (patchAttributesDto(dtoFile, attributesClass, input)) patched.push(dtoFile)
      else warnings.push(`No se pudo poblar el DTO de attributes (${attributesClass}) en ${dtoFile}.`)
    } catch (e: any) {
      warnings.push(`Fallo poblando DTO attributes: ${e?.message}`)
    }
    try {
      if (patchEntity(reqFile, requestEntity, input, false)) patched.push(reqFile)
    } catch (e: any) {
      warnings.push(`Fallo poblando entidad request: ${e?.message}`)
    }
    try {
      const specFile = join(base, 'core/application/services', `${casoKebab}.application.spec.ts`)
      if (patchApplicationSpecFixture(specFile, casoCamel, input)) patched.push(specFile)
    } catch (e: any) {
      warnings.push(`Fallo ajustando el fixture del test de application: ${e?.message}`)
    }
  }

  if (Object.keys(output).length > 0) {
    try {
      if (patchResponseEntity(resFile, responseEntity, output, source)) patched.push(resFile)
    } catch (e: any) {
      warnings.push(`Fallo poblando entidad response: ${e?.message}`)
    }
    if (source === 'typeorm') {
      const ormFile = join(base, 'infrastructure/sql-database/entities', `${toKebab(responseEntity)}.entity.ts`)
      try {
        if (patchOrmEntity(ormFile, output)) patched.push(ormFile)
      } catch (e: any) {
        warnings.push(`Fallo poblando la entidad TypeORM: ${e?.message}`)
      }
    }
  }

  return { patched, warnings }
}
