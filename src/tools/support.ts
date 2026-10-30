import { z } from 'zod'
import { join } from 'node:path'
import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { datasetPath, listTemplateFiles, readTemplate } from '../lib/dataset.js'
import { inspectProject } from '../lib/inspect.js'
import { listConnections, nextConnectionName } from '../lib/connections.js'
import { MOTORES } from '../lib/engines.js'
import { learnVerifyRun } from '../lib/learnings.js'
import * as s from '../lib/schemas.js'

// --- verify_standards: corre verify-standards.mjs contra el proyecto destino --
export const verifyStandardsSchema = {
  projectRoot: s.projectRoot,
  installScript: z
    .boolean()
    .default(true)
    .describe('Si true, copia verify-standards.mjs a scripts/ del proyecto antes de ejecutarlo.')
}

export async function verifyStandards(a: { projectRoot: string; installScript: boolean }) {
  const scriptDest = join(a.projectRoot, 'scripts', 'verify-standards.mjs')

  if (a.installScript || !existsSync(scriptDest)) {
    mkdirSync(join(a.projectRoot, 'scripts'), { recursive: true })
    copyFileSync(datasetPath('config/verify-standards.mjs'), scriptDest)
  }

  let output: string
  let failed = false
  try {
    output = execFileSync('node', [scriptDest], {
      cwd: a.projectRoot,
      encoding: 'utf8'
    })
  } catch (err: any) {
    // exit code 1 = hay errores bloqueantes; capturamos stdout igualmente.
    failed = true
    output = (err.stdout ?? '') + (err.stderr ?? '')
  }

  // Learn which rules fail. Only rule ids are kept (never messages or paths); a script without
  // --json support (older install) simply teaches nothing.
  try {
    let json = ''
    try {
      json = execFileSync('node', [scriptDest, '--json'], { cwd: a.projectRoot, encoding: 'utf8' })
    } catch (err: any) {
      json = err.stdout ?? ''
    }
    const report = JSON.parse(json)
    const ids = Array.isArray(report?.errors) ? report.errors.map((e: any) => String(e?.rule)) : []
    learnVerifyRun(a.projectRoot, ids)
  } catch {
    // learning is a side effect: it must never break the verification
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Verificación de estándares (${failed ? 'FALLÓ' : 'OK'}):\n\n${output}`
      }
    ],
    isError: failed
  }
}

// --- inspect_project: descubrimiento de solo lectura (Flujo 2 refactor) -------
export const inspectProjectSchema = {
  projectRoot: s.projectRoot
}

export async function inspectProjectTool(a: { projectRoot: string }) {
  const r = inspectProject(a.projectRoot)
  const lines: string[] = []
  lines.push(`Inspección de ${a.projectRoot}`)
  lines.push(`  NestJS: ${r.isNestProject ? 'sí' : 'no'} | ya hexagonal: ${r.looksHexagonal ? 'sí' : 'no'}`)
  lines.push(`  Convención de carpetas de dominio: ${r.folderCaseConvention}`)
  lines.push(
    `  Dominios detectados: ${
      r.domainFolders.filter((d) => d.hasModule).map((d) => d.name).join(', ') || '(ninguno)'
    }`
  )
  lines.push(
    `  Conexión TypeORM: ${r.connection.style}` +
      (r.connection.usesReplication ? ' (replication)' : '') +
      (r.connection.namedConnections.length ? ` | nombradas: ${r.connection.namedConnections.join(', ')}` : '')
  )
  const mcpConnections = listConnections(a.projectRoot)
  const takenNames = mcpConnections.map((c) => c.name)
  lines.push(
    `  Conexiones creadas por el MCP: ${mcpConnections.map((c) => `${c.name}${c.motor ? ` (${c.motor})` : ''}`).join(', ') || '(ninguna)'}`
  )
  lines.push(
    `    Nombre que tomaria una conexion NUEVA de cada motor: ${MOTORES.map((m) => `${m} -> ${nextConnectionName(m, takenNames)}`).join(' | ')}`
  )
  lines.push('  Infra transversal existente (REUSAR, no duplicar):')
  const jsonApiClasses = r.existingInfra.jsonApiResponseClasses?.length
    ? ` [${r.existingInfra.jsonApiResponseClasses.join(', ')}]`
    : ''
  const errorClasses = r.existingInfra.errorTypeClasses?.length
    ? ` [${r.existingInfra.errorTypeClasses.join(', ')}]`
    : ''
  lines.push(`    - JSON:API response: ${r.existingInfra.jsonApiResponse ?? '(no encontrado)'}${jsonApiClasses}`)
  lines.push(`    - Tipo de error: ${r.existingInfra.errorType ?? '(no encontrado)'}${errorClasses}`)
  lines.push(`    - Middleware JSON:API: ${r.existingInfra.jsonApiMiddleware ?? '(no encontrado)'}`)
  lines.push(`    - ConfigurationVariables: ${r.existingInfra.configVariables ?? '(no encontrado)'}`)
  lines.push(`    - Carpeta raíz de infra (infraRoot): ${r.existingInfra.infraRoot ?? '(no detectada)'}`)
  if (r.notes.length) {
    lines.push('  Reglas a respetar en el refactor:')
    for (const n of r.notes) lines.push(`    - ${n}`)
  }
  lines.push('')
  lines.push('JSON completo:')
  lines.push(JSON.stringify(r, null, 2))
  return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
}

// --- list_templates: lista las plantillas disponibles en el dataset -----------
export const listTemplatesSchema = {
  subdir: z
    .enum(['shared', 'config', '_domain-slice', 'authorization', 'all'])
    .default('all')
    .describe('Subconjunto del dataset a listar.')
}

export async function listTemplates(a: { subdir: 'shared' | 'config' | '_domain-slice' | 'authorization' | 'all' }) {
  const subdirs = a.subdir === 'all' ? ['shared', 'config', '_domain-slice', 'authorization'] : [a.subdir]
  const lines: string[] = []
  for (const sd of subdirs) {
    lines.push(`\n[${sd}]`)
    for (const f of listTemplateFiles(sd)) lines.push(`  ${f}`)
  }
  return {
    content: [{ type: 'text' as const, text: `Plantillas del dataset:${lines.join('\n')}` }]
  }
}

// --- get_template: devuelve el contenido crudo de una plantilla ---------------
export const getTemplateSchema = {
  relativePath: z
    .string()
    .describe('Ruta relativa de la plantilla dentro del dataset, p.ej. "shared/utils/services/http-client.service.ts".')
}

export async function getTemplate(a: { relativePath: string }) {
  try {
    const content = readTemplate(a.relativePath)
    return {
      content: [{ type: 'text' as const, text: content }]
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `ERROR: ${err.message}` }],
      isError: true
    }
  }
}

// --- get_rules: devuelve el cerebro de calidad (rules.yaml) del área ----------
// Fuente de verdad AGNÓSTICA DE DOMINIO de las convenciones hexagonales y de
// calidad. El agente DEBE leerlo antes de generar un servicio nuevo o
// refactorizar uno existente. Incluye snippets destilados del repo canónico.
export const getRulesSchema = {}

export async function getRules() {
  try {
    const content = readTemplate('rules.yaml')
    return {
      content: [
        {
          type: 'text' as const,
          text:
            'Reglas de arquitectura y calidad (midd-hexagonal-nestjs). LÉELAS antes de generar o refactorizar. ' +
            'Son agnósticas de dominio: module/entity/use cases los define el usuario.\n\n' +
            content
        }
      ]
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `ERROR: ${err.message}` }],
      isError: true
    }
  }
}
