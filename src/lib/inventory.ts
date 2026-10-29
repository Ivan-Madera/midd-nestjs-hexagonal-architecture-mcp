/**
 * Inventario y auditoría de arquitectura (memoria por repo del MCP).
 *
 * - docs/architecture-inventory.json: envelope con mcpVersion/generatedAt y una
 *   entrada POR MÓDULO. Agregar o reemplazar SOLO la entrada del módulo en curso;
 *   nunca tocar las de otros módulos. Permite que una sesión futura sepa qué
 *   módulos existen sin releer todo el código.
 * - docs/audits/<module>-<YYYY-MM-DD>.md: auditoría legible por humanos del
 *   módulo (compliance, build/tests, decisiones, complejidad), con el encabezado
 *   estampando la versión del MCP.
 *
 * Agnóstico de dominio: el nombre del módulo y su contenido vienen del spec/uso.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Versión del MCP leída de su package.json (dist/lib -> ../../package.json). */
export function mcpVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
    return String(pkg.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

export type UseCaseEntry = {
  name: string
  adapter: 'typeorm' | 'sp'
  methods: Array<{ name: string; request: string; response: string; sp?: string }>
}

export type InventoryEntry = {
  module: string
  entity: string
  description?: string
  stack: 'nestjs'
  connection?: { name: string; style: 'named' | 'default' }
  complexity?: { level: number; signals?: Array<{ level: number; why: string }> }
  useCases: UseCaseEntry[]
  businessRules?: string[]
  mcpVersion: string
  generatedAt: string
}

type InventoryEnvelope = {
  mcpVersion: string
  generatedAt: string
  modules: Record<string, InventoryEntry>
}

/**
 * Agrega o reemplaza la entrada de UN módulo en docs/architecture-inventory.json.
 * Crea el envelope si no existe. No toca entradas de otros módulos.
 */
export function recordInventory(opts: {
  projectRoot: string
  entry: Omit<InventoryEntry, 'mcpVersion' | 'generatedAt'>
}): { file: string; created: boolean; replaced: boolean } {
  const { projectRoot, entry } = opts
  const file = join(projectRoot, 'docs', 'architecture-inventory.json')
  const version = mcpVersion()
  const now = today()

  let envelope: InventoryEnvelope
  let createdFile = false
  if (existsSync(file)) {
    try {
      envelope = JSON.parse(readFileSync(file, 'utf8'))
      if (!envelope.modules || typeof envelope.modules !== 'object') envelope.modules = {}
    } catch {
      envelope = { mcpVersion: version, generatedAt: now, modules: {} }
    }
  } else {
    envelope = { mcpVersion: version, generatedAt: now, modules: {} }
    createdFile = true
  }

  const replaced = Boolean(envelope.modules[entry.module])
  envelope.modules[entry.module] = { ...entry, mcpVersion: version, generatedAt: now }
  // Actualiza el sello del envelope (refleja la última escritura).
  envelope.mcpVersion = version
  envelope.generatedAt = now

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n', 'utf8')
  return { file, created: createdFile, replaced }
}

/**
 * Escribe docs/audits/<module>-<YYYY-MM-DD>.md con el resumen del módulo.
 * Sobrescribe la auditoría del mismo módulo+fecha (idempotente por día).
 */
export function writeAudit(opts: {
  projectRoot: string
  entry: Omit<InventoryEntry, 'mcpVersion' | 'generatedAt'>
  compliance?: string // salida de verify_standards u observaciones
  buildStatus?: string // resultado de build/tests
  decisions?: string[] // decisiones tomadas
}): { file: string } {
  const { projectRoot, entry, compliance, buildStatus, decisions } = opts
  const version = mcpVersion()
  const date = today()
  const file = join(projectRoot, 'docs', 'audits', `${entry.module}-${date}.md`)

  const lines: string[] = []
  lines.push(`# Auditoría — módulo \`${entry.module}\``)
  lines.push('')
  lines.push(`- MCP: midd-nestjs-hexagonal-architecture-mcp v${version}`)
  lines.push(`- Fecha: ${date}`)
  lines.push(`- Entity: \`${entry.entity}\` · Stack: ${entry.stack}`)
  if (entry.connection)
    lines.push(`- Conexión: ${entry.connection.name} (${entry.connection.style})`)
  if (entry.complexity) {
    lines.push(`- Complejidad: nivel ${entry.complexity.level}`)
    for (const s of entry.complexity.signals ?? [])
      lines.push(`  - señal nivel ${s.level}: ${s.why}`)
  }
  lines.push('')
  lines.push('## Casos de uso')
  for (const uc of entry.useCases) {
    lines.push(`- **${uc.name}** (adapter: ${uc.adapter})`)
    for (const m of uc.methods)
      lines.push(`  - \`${m.name}(${m.request}): ${m.response}\`` + (m.sp ? ` · SP: ${m.sp}` : ''))
  }
  lines.push('')
  if (entry.businessRules && entry.businessRules.length) {
    lines.push('## Reglas de negocio')
    for (const r of entry.businessRules) lines.push(`- ${r}`)
    lines.push('')
    lines.push(
      '> NOTA: las condiciones materializadas por el MCP son aproximaciones del texto; ' +
        'verifica que reflejen el requerimiento real.'
    )
    lines.push('')
  }
  lines.push('## Build / tests')
  lines.push(buildStatus ? buildStatus : '- Pendiente: corre `npm run build` + `npm test` + `npm run verify`.')
  lines.push('')
  lines.push('## Compliance (verify_standards)')
  lines.push(compliance ? '```\n' + compliance.trim() + '\n```' : '- Pendiente: corre `verify_standards`.')
  lines.push('')
  lines.push('## Decisiones')
  if (decisions && decisions.length) for (const d of decisions) lines.push(`- ${d}`)
  else lines.push('- (sin decisiones registradas)')
  lines.push('')

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n'), 'utf8')
  return { file }
}
