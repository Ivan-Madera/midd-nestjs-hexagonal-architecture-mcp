import type { AdapterType, HttpVerb } from './adapters.js'
import { httpCallExpression } from './adapters.js'
import { domainFolder, toKebab } from './names.js'
/**
 * Enriquecimiento de puertos inbound/outbound a N MÉTODOS.
 *
 * El slice base (dataset) siembra un caso con UN método principal. El modelo
 * canónico, sin embargo, expone VARIOS métodos por puerto, cada uno con su
 * entidad request y response tipadas. Este módulo parchea, de forma idempotente
 * y conservadora (anclado a marcas estables), los 4 archivos que deben conocer
 * cada método adicional:
 *   - core/domain/ports/inbound/<caso>.inbound.port.ts
 *   - core/domain/ports/outbound/<caso>.outbound.port.ts
 *   - core/domain/services/<caso>.domain.service.ts
 *   - infrastructure/adapters/<caso>.(sp|typeorm|http).adapter.ts   (<caso> in kebab-case)
 * y crea las entidades de dominio request/response que falten.
 *
 * Firmas (fieles al canon):
 *   - SP:      <metodo>(storedProcedure: string, data: <Request>): Promise<<Response>>
 *   - TypeORM: <metodo>(data: <Request>): Promise<<Response>>
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type PortMethod = {
  name: string // camelCase
  request: string // PascalCase, entidad de dominio de entrada
  response: string // PascalCase, entidad de dominio de salida
  sp?: string // nombre del SP (si adapter=sp)
  http?: { method: HttpVerb; path: string } // llamada a la API externa (si adapter=http)
}

export type EnrichResult = { patched: string[]; created: string[]; warnings: string[] }

/** Inserta una línea de import tras el último import del archivo (idempotente). */
function addImport(content: string, importLine: string): string {
  if (content.includes(importLine.trim())) return content
  const importRe = /^import .*$/gm
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = importRe.exec(content)) !== null) last = m
  if (!last) return `${importLine}\n${content}`
  const idx = last.index + last[0].length
  return content.slice(0, idx) + `\n${importLine}` + content.slice(idx)
}

/** Importa una entidad de dominio por su ruta relativa, si el símbolo no está ya. */
function addEntityImport(content: string, entity: string, relPath: string): string {
  if (new RegExp(`\\bimport\\b[^\\n]*\\b${entity}\\b`).test(content)) return content
  return addImport(content, `import { ${entity} } from '${relPath}'`)
}

/** Inserta una línea justo antes del último `}` del archivo (cierre de interface/clase). */
function insertBeforeLastBrace(content: string, snippet: string): string {
  const idx = content.lastIndexOf('}')
  if (idx === -1) return content + '\n' + snippet + '\n'
  return content.slice(0, idx) + snippet + '\n' + content.slice(idx)
}

// Hexagonal puro: el método del puerto recibe la entidad request tipada. El
// nombre del SP es infraestructura: NO viaja por el puerto, lo resuelve el
// adapter por ConfigurationVariables. Firma uniforme entre SP y TypeORM.
function firmaArgs(method: PortMethod): string {
  return `data: ${method.request}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- Puerto inbound: <caso>.inbound.port.ts --------------------------------------
function patchInboundPort(file: string, methods: PortMethod[]): boolean {
  let content = read(file)
  if (!content) return false
  const before = content
  for (const m of methods) {
    content = addEntityImport(content, m.request, `../../entities/${toKebab(m.request)}.entity`)
    content = addEntityImport(content, m.response, `../../entities/${toKebab(m.response)}.entity`)
    const sig = `  ${m.name}(${firmaArgs(m)}): Promise<${m.response}>`
    if (!new RegExp(`\\b${m.name}\\s*\\(`).test(content)) {
      content = insertBeforeLastBrace(content, sig)
    }
  }
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

// --- Puerto outbound: <caso>.outbound.port.ts ----------------------------------
function patchOutboundPort(file: string, methods: PortMethod[]): boolean {
  // Misma forma que el inbound (el domain service delega 1:1 en el repositorio).
  return patchInboundPort(file, methods)
}

// --- Domain service: <caso>.domain.service.ts -------------------------------
function patchDomainService(file: string, caso: string, methods: PortMethod[]): boolean {
  let content = read(file)
  if (!content) return false
  const before = content
  const repoProp = `${lcFirst(caso)}Repository`
  for (const m of methods) {
    content = addEntityImport(content, m.request, `../entities/${toKebab(m.request)}.entity`)
    content = addEntityImport(content, m.response, `../entities/${toKebab(m.response)}.entity`)
    if (new RegExp(`\\basync\\s+${m.name}\\s*\\(`).test(content)) continue
    const impl =
      `\n  async ${m.name}(data: ${m.request}): Promise<${m.response}> {\n` +
      `    return this.${repoProp}.${m.name}(data)\n` +
      `  }\n`
    content = insertBeforeLastBrace(content, impl)
  }
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

// --- Adapter: <caso>.(sp|typeorm).adapter.ts --------------------------------
function patchAdapter(file: string, methods: PortMethod[], adapterType: AdapterType): boolean {
  let content = read(file)
  if (!content) return false
  const before = content
  const entitiesRel = '../../core/domain/entities'
  for (const m of methods) {
    content = addEntityImport(content, m.request, `${entitiesRel}/${toKebab(m.request)}.entity`)
    content = addEntityImport(content, m.response, `${entitiesRel}/${toKebab(m.response)}.entity`)
    if (new RegExp(`\\basync\\s+${m.name}\\s*\\(`).test(content)) continue
    if (adapterType === 'http') {
      // External API: same helpers as the principal method (url() joins the base URL, result() translates the answer).
      const call = m.http ?? { method: 'GET' as HttpVerb, path: `/${m.name}` }
      const impl =
        `\n  async ${m.name}(data: ${m.request}): Promise<${m.response}> {\n` +
        `    const response = await this.http.${httpCallExpression(call.method, call.path)}\n` +
        `    return this.result(response, ${m.response})\n` +
        `  }\n`
      content = insertBeforeLastBrace(content, impl)
      continue
    }
    if (adapterType === 'sp') {
      // Hexagonal puro: el adapter resuelve el nombre del SP por
      // ConfigurationVariables; el método del puerto recibe solo `data`.
      const spKey = m.sp ?? capitalize(m.name)
      const impl =
        `\n  async ${m.name}(data: ${m.request}): Promise<${m.response}> {\n` +
        `    return Mapper(\n` +
        `      ${m.response},\n` +
        `      await this.dbProcessCommon.executeStoredProcedure<${m.response}>(\n` +
        `        this.config.storedProcedures.${spKey},\n` +
        `        data,\n` +
        `        true\n` +
        `      )\n` +
        `    )\n` +
        `  }\n`
      content = insertBeforeLastBrace(content, impl)
    } else {
      const impl =
        `\n  async ${m.name}(data: ${m.request}): Promise<${m.response}> {\n` +
        `    // TODO: implementa la consulta TypeORM para ${m.name} y mapea a ${m.response}.\n` +
        `    const row = await this.repository.findOne({ where: { ...data } as any })\n` +
        `    return row ? Mapper(${m.response}, row) : null\n` +
        `  }\n`
      content = insertBeforeLastBrace(content, impl)
    }
  }
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

/** Crea una entidad de dominio pura mínima si no existe. */
function ensureEntity(opts: {
  projectRoot: string
  dominioLower: string
  entity: string
  created: string[]
}): void {
  const { projectRoot, dominioLower, entity, created } = opts
  const rel = `src/${dominioLower}/core/domain/entities/${toKebab(entity)}.entity.ts`
  const full = join(projectRoot, rel)
  if (existsSync(full)) return
  const body =
    `// Entidad de dominio pura (sin decoradores de framework). Declara los campos\n` +
    `// como opcionales; se poblan por mapeo parcial desde el adapter.\n` +
    `export class ${entity} {\n` +
    `  // define aquí las propiedades de ${entity}\n` +
    `}\n`
  writeFileSync(full, body, 'utf8')
  created.push(rel)
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * Enriquece el slice de un caso con los métodos ADICIONALES (los que no son el
 * método principal ya sembrado). Crea entidades faltantes y parchea puertos,
 * domain service y adapter. Idempotente.
 */
export function enrichPortMethods(opts: {
  projectRoot: string
  dominio: string
  caso: string
  adapterType: AdapterType
  methods: PortMethod[] // métodos a asegurar (adicionales; el principal ya está)
}): EnrichResult {
  const { projectRoot, dominio, caso, adapterType, methods } = opts
  const domLower = domainFolder(dominio)
  const casoKebab = toKebab(caso)
  const patched: string[] = []
  const created: string[] = []
  const warnings: string[] = []

  if (methods.length === 0) return { patched, created, warnings }

  // 1) Entidades request/response de cada método.
  const entities = new Set<string>()
  for (const m of methods) {
    entities.add(m.request)
    entities.add(m.response)
  }
  for (const e of entities) {
    try {
      ensureEntity({ projectRoot, dominioLower: domLower, entity: e, created })
    } catch (err: any) {
      warnings.push(`No se pudo crear la entidad ${e}: ${err?.message}`)
    }
  }

  // 2) Archivos del slice a parchear.
  const base = join(projectRoot, 'src', domLower)
  const inbound = join(base, `core/domain/ports/inbound/${casoKebab}.inbound.port.ts`)
  const outbound = join(base, `core/domain/ports/outbound/${casoKebab}.outbound.port.ts`)
  const domainSvc = join(base, `core/domain/services/${casoKebab}.domain.service.ts`)
  const adapterFile = join(
    base,
    `infrastructure/adapters/${casoKebab}.${adapterType}.adapter.ts`
  )

  const steps: Array<[string, () => boolean]> = [
    [inbound, () => patchInboundPort(inbound, methods)],
    [outbound, () => patchOutboundPort(outbound, methods)],
    [domainSvc, () => patchDomainService(domainSvc, caso, methods)],
    [adapterFile, () => patchAdapter(adapterFile, methods, adapterType)]
  ]

  for (const [file, fn] of steps) {
    if (!existsSync(file)) {
      warnings.push(`No se encontró para enriquecer: ${file}`)
      continue
    }
    try {
      if (fn()) patched.push(file)
    } catch (err: any) {
      warnings.push(`Fallo enriqueciendo ${file}: ${err?.message}`)
    }
  }

  return { patched, created, warnings }
}
