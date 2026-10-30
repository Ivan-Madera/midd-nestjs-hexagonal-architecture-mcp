import { z } from 'zod'
import { recordInventory, writeAudit, type InventoryEntry } from '../lib/inventory.js'
import { loadAndValidateSpec, SpecValidationError } from '../lib/spec.js'
import { fillSpecConnectionAnyMode } from '../lib/connections.js'
import { usesDatabase } from '../lib/adapters.js'
import * as s from '../lib/schemas.js'
import { refreshApiDocs } from '../lib/apiDocs.js'

/**
 * record_architecture — registra un módulo en el inventario de arquitectura y
 * escribe su auditoría. Lee el middleware.spec.yaml del módulo para no duplicar
 * datos (module/entity/use_cases/complejidad), y acepta opcionalmente el reporte
 * de compliance, el estado de build y decisiones para la auditoría.
 *
 * Agnóstico de dominio: todo sale del spec del usuario.
 */
export const recordArchitectureSchema = {
  projectRoot: s.projectRoot,
  specPath: z
    .string()
    .describe('Ruta absoluta al middleware.spec.yaml del módulo a inventariar/auditar.'),
  compliance: z
    .string()
    .optional()
    .describe('Salida de verify_standards (u observaciones) para la sección de compliance de la auditoría.'),
  buildStatus: z
    .string()
    .optional()
    .describe('Resultado de build/tests para la auditoría (p.ej. "build OK, 12 tests en verde").'),
  decisions: z
    .array(z.string())
    .optional()
    .describe('Decisiones de diseño tomadas durante la generación/refactor, para la auditoría.'),
  writeAuditFile: z
    .boolean()
    .default(true)
    .describe('Si true (default), escribe también docs/audits/<module>-<fecha>.md además del inventario.')
}

function entryFromSpec(specPath: string, projectRoot: string): Omit<InventoryEntry, 'mcpVersion' | 'generatedAt'> {
  const spec = loadAndValidateSpec(specPath)
  const needsDb = spec.useCases.some((uc) => usesDatabase(uc.adapter))
  const problem = needsDb ? fillSpecConnectionAnyMode(spec, projectRoot) : undefined
  if (problem) throw new SpecValidationError([problem])
  return {
    module: spec.module,
    entity: spec.entity,
    description: spec.description || undefined,
    stack: spec.stack,
    connection: needsDb ? spec.connection : undefined,
    complexity: { level: spec.complexity.level, signals: spec.complexity.signals },
    useCases: spec.useCases.map((uc) => ({
      name: uc.name,
      adapter: uc.adapter,
      api: uc.api,
      methods: uc.methods.map((m) => ({
        name: m.name,
        request: m.request,
        response: m.response,
        sp: m.sp
      }))
    })),
    businessRules: spec.businessRules.none ? [] : spec.businessRules.rules
  }
}

export async function recordArchitecture(a: {
  projectRoot: string
  specPath: string
  compliance?: string
  buildStatus?: string
  decisions?: string[]
  writeAuditFile: boolean
}) {
  let entry: Omit<InventoryEntry, 'mcpVersion' | 'generatedAt'>
  try {
    entry = entryFromSpec(a.specPath, a.projectRoot)
  } catch (err: any) {
    const msg = err instanceof SpecValidationError ? err.message : `Error al leer el spec: ${err.message}`
    return { content: [{ type: 'text' as const, text: `ERROR: ${msg}` }], isError: true }
  }

  const out: string[] = []
  const inv = recordInventory({ projectRoot: a.projectRoot, entry })
  out.push(
    `Inventario ${inv.created ? 'creado' : inv.replaced ? 'actualizado (entrada reemplazada)' : 'actualizado (entrada agregada)'}: ${inv.file}`
  )

  if (a.writeAuditFile) {
    const audit = writeAudit({
      projectRoot: a.projectRoot,
      entry,
      compliance: a.compliance,
      buildStatus: a.buildStatus,
      decisions: a.decisions
    })
    out.push(`Auditoría escrita: ${audit.file}`)
  }

  // Keep the API documentation in step with the code every time a module is closed.
  const docs = refreshApiDocs(a.projectRoot, entry.module)
  if (docs && docs.written.length) out.push('Documentacion de la API actualizada: ' + docs.written.join(', '))
  out.push('')
  out.push(
    'NOTA (agente/usuario): el inventario NO toca entradas de otros módulos. Al abrir una sesión futura, ' +
      'lee docs/architecture-inventory.json ANTES de generar para no duplicar módulos ni releer todo el código.'
  )

  return { content: [{ type: 'text' as const, text: out.join('\n') }] }
}
