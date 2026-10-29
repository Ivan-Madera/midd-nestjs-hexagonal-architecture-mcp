import { readFileSync, existsSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { MOTORES, isMotor, type Motor } from './engines.js'

/**
 * Parser + validador del middleware.spec.yaml.
 *
 * El spec es la descripción declarativa, AGNÓSTICA DE DOMINIO, de un módulo a
 * generar: module/entity/use_cases los define el usuario. Este archivo solo
 * valida la FORMA (que el spec sea coherente) y lo normaliza a tipos; la calidad
 * de la arquitectura la impone la generación según rules.yaml.
 */

export type SpecMethod = {
  name: string // camelCase, método del puerto
  request: string // entidad de dominio de entrada
  response: string // entidad de dominio de salida
  sp?: string // nombre del SP si el caso usa adapter 'sp'
}

export type SpecUseCase = {
  name: string // PascalCase
  action: string // ruta del endpoint POST
  resourceType: string // 'type' JSON:API (kebab)
  adapter: 'typeorm' | 'sp'
  methods: SpecMethod[]
}

export type MiddlewareSpec = {
  module: string // kebab-case
  entity: string // PascalCase
  description: string
  stack: 'nestjs'
  errorPrefix: string // MAYUSCULAS
  connection: { name: string; style: 'named' | 'default'; engine: Motor }
  useCases: SpecUseCase[]
  dtos: { input: Record<string, unknown>; output: Record<string, unknown> }
  businessRules: { none: boolean; rules: string[] }
  complexity: { level: number; signals: Array<{ level: number; why: string }> }
  notes: string[]
}

export class SpecValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`El middleware.spec no es válido:\n- ${problems.join('\n- ')}`)
    this.name = 'SpecValidationError'
  }
}

const isPascalCase = (s: string) => /^[A-Z][A-Za-z0-9]*$/.test(s)
const isCamelCase = (s: string) => /^[a-z][A-Za-z0-9]*$/.test(s)
const isKebabCase = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)
const isUpperId = (s: string) => /^[A-Z][A-Z0-9_]*$/.test(s)

/** Lee y parsea el YAML del spec desde disco. */
export function loadSpecFile(specPath: string): unknown {
  if (!existsSync(specPath)) {
    throw new SpecValidationError([`No se encontró el archivo de spec en: ${specPath}`])
  }
  let raw: string
  try {
    raw = readFileSync(specPath, 'utf8')
  } catch (err: any) {
    throw new SpecValidationError([`No se pudo leer el spec: ${err.message}`])
  }
  try {
    return parseYaml(raw)
  } catch (err: any) {
    throw new SpecValidationError([`YAML inválido: ${err.message}`])
  }
}

/**
 * Valida y normaliza un objeto plano (ya parseado) a MiddlewareSpec.
 * Lanza SpecValidationError con TODOS los problemas encontrados (no solo el 1º).
 */
export function validateSpec(input: unknown): MiddlewareSpec {
  const problems: string[] = []
  const obj = (input ?? {}) as Record<string, any>

  const module = String(obj.module ?? '').trim()
  const entity = String(obj.entity ?? '').trim()
  const description = String(obj.description ?? '').trim()
  const stack = String(obj.stack ?? 'nestjs').trim()
  const errorPrefix = String(obj.error_prefix ?? obj.errorPrefix ?? '').trim()

  if (!module) problems.push('module es obligatorio (kebab-case, p.ej. "catalog").')
  else if (!isKebabCase(module)) problems.push(`module debe ser kebab-case: "${module}".`)

  if (!entity) problems.push('entity es obligatorio (PascalCase, p.ej. "Product").')
  else if (!isPascalCase(entity)) problems.push(`entity debe ser PascalCase: "${entity}".`)

  if (stack !== 'nestjs')
    problems.push(`stack solo soporta "nestjs" en este MCP (recibido: "${stack}").`)

  if (!errorPrefix) problems.push('error_prefix es obligatorio (MAYUSCULAS, p.ej. "CATALOG").')
  else if (!isUpperId(errorPrefix))
    problems.push(`error_prefix debe ser MAYUSCULAS: "${errorPrefix}".`)

  // Conexión
  const connIn = (obj.connection ?? {}) as Record<string, any>
  const connName = String(connIn.name ?? '').trim()
  const connStyle = String(connIn.style ?? 'named').trim()
  if (!connName) problems.push('connection.name es obligatorio (PascalCase, p.ej. "Catalog").')
  else if (!isPascalCase(connName))
    problems.push(`connection.name debe ser PascalCase: "${connName}".`)
  if (connStyle !== 'named' && connStyle !== 'default')
    problems.push(`connection.style debe ser "named" o "default" (recibido: "${connStyle}").`)
  const connEngine = String(connIn.engine ?? '').trim()
  if (!isMotor(connEngine))
    problems.push(
      `connection.engine es obligatorio: ${MOTORES.join(' | ')} (recibido: "${connEngine}"). Se le pregunta al usuario; no hay default.`
    )

  // Casos de uso
  const rawUseCases = Array.isArray(obj.use_cases ?? obj.useCases) ? (obj.use_cases ?? obj.useCases) : []
  if (rawUseCases.length === 0) problems.push('use_cases debe tener al menos un caso de uso.')

  const useCases: SpecUseCase[] = []
  rawUseCases.forEach((ucRaw: any, i: number) => {
    const where = `use_cases[${i}]`
    const name = String(ucRaw?.name ?? '').trim()
    const action = String(ucRaw?.action ?? '').trim()
    const resourceType = String(ucRaw?.resource_type ?? ucRaw?.resourceType ?? '').trim()
    const adapter = String(ucRaw?.adapter ?? 'typeorm').trim()

    if (!name) problems.push(`${where}.name es obligatorio (PascalCase).`)
    else if (!isPascalCase(name)) problems.push(`${where}.name debe ser PascalCase: "${name}".`)
    if (!action) problems.push(`${where}.action es obligatorio (ruta del endpoint POST).`)
    if (!resourceType) problems.push(`${where}.resource_type es obligatorio (type JSON:API, kebab-case).`)
    if (adapter !== 'typeorm' && adapter !== 'sp')
      problems.push(`${where}.adapter debe ser "typeorm" o "sp" (recibido: "${adapter}").`)

    const rawMethods = Array.isArray(ucRaw?.methods) ? ucRaw.methods : []
    if (rawMethods.length === 0)
      problems.push(`${where}.methods debe tener al menos un método (modelo multi-método).`)

    const methods: SpecMethod[] = []
    rawMethods.forEach((mRaw: any, j: number) => {
      const mwhere = `${where}.methods[${j}]`
      const mName = String(mRaw?.name ?? '').trim()
      const request = String(mRaw?.request ?? '').trim()
      const response = String(mRaw?.response ?? '').trim()
      const sp = mRaw?.sp != null ? String(mRaw.sp).trim() : undefined

      if (!mName) problems.push(`${mwhere}.name es obligatorio (camelCase).`)
      else if (!isCamelCase(mName)) problems.push(`${mwhere}.name debe ser camelCase: "${mName}".`)
      if (!request) problems.push(`${mwhere}.request es obligatorio (entidad de dominio de entrada).`)
      else if (!isPascalCase(request))
        problems.push(`${mwhere}.request debe ser PascalCase: "${request}".`)
      if (!response) problems.push(`${mwhere}.response es obligatorio (entidad de dominio de salida).`)
      else if (!isPascalCase(response))
        problems.push(`${mwhere}.response debe ser PascalCase: "${response}".`)
      if (adapter === 'sp' && !sp)
        problems.push(`${mwhere}.sp es obligatorio cuando adapter="sp" (nombre del stored procedure).`)

      methods.push({ name: mName, request, response, sp })
    })

    useCases.push({
      name,
      action,
      resourceType,
      adapter: adapter === 'sp' ? 'sp' : 'typeorm',
      methods
    })
  })

  // Secciones opcionales con defaults seguros
  const dtosIn = (obj.dtos ?? {}) as Record<string, any>
  const dtos = {
    input: (dtosIn.input ?? {}) as Record<string, unknown>,
    output: (dtosIn.output ?? {}) as Record<string, unknown>
  }

  const brIn = (obj.business_rules ?? obj.businessRules ?? {}) as Record<string, any>
  const businessRules = {
    none: Boolean(brIn.none ?? false),
    rules: Array.isArray(brIn.rules) ? brIn.rules.map((r: any) => String(r)) : []
  }
  if (!businessRules.none && businessRules.rules.length === 0) {
    problems.push(
      'business_rules: declara reglas en "rules" o marca "none: true" explícitamente (el MCP no inventa reglas).'
    )
  }

  const cxIn = (obj.complexity ?? {}) as Record<string, any>
  const level = Number(cxIn.level ?? 0)
  if (!Number.isInteger(level) || level < 0 || level > 5)
    problems.push(`complexity.level debe ser un entero 0-5 (recibido: "${cxIn.level}").`)
  const complexity = {
    level: Number.isInteger(level) && level >= 0 && level <= 5 ? level : 0,
    signals: Array.isArray(cxIn.signals)
      ? cxIn.signals.map((s: any) => ({ level: Number(s?.level ?? 0), why: String(s?.why ?? '') }))
      : []
  }

  const notes = Array.isArray(obj.notes) ? obj.notes.map((n: any) => String(n)) : []

  if (problems.length) throw new SpecValidationError(problems)

  return {
    module,
    entity,
    description,
    stack: 'nestjs',
    errorPrefix,
    connection: { name: connName, style: connStyle === 'default' ? 'default' : 'named', engine: connEngine as Motor },
    useCases,
    dtos,
    businessRules,
    complexity,
    notes
  }
}

/** Atajo: carga desde disco + valida. */
export function loadAndValidateSpec(specPath: string): MiddlewareSpec {
  return validateSpec(loadSpecFile(specPath))
}
