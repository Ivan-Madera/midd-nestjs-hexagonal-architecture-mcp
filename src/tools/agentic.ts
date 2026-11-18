import { z } from 'zod'
import { AGENT_REGISTRY, AGENT_ROLES, installAgenticKit, resolveModels, type KitStatus, type ModelOverrides } from '../lib/agenticKit.js'
import { mcpVersion } from '../lib/inventory.js'
import { START_GUIDE, GREENFIELD_GUIDE, REFACTOR_GUIDE } from '../prompts.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// install_agentic_kit: installs/updates the entry point in the consuming repo
// (spec-builder agent + spec template + AGENTS.md section). Idempotent.
// ---------------------------------------------------------------------------
const modelId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, 'Use un nombre de modelo simple, p.ej. "claude-haiku-4.5".')
  .optional()

export const installAgenticKitSchema = {
  projectRoot: s.projectRoot,
  models: z
    .object(
      Object.fromEntries(
        AGENT_ROLES.map((role) => [
          role,
          modelId.describe(
            `Modelo de ${AGENT_REGISTRY[role].name}. Default: ${AGENT_REGISTRY[role].model}.`
          )
        ])
      ) as Record<(typeof AGENT_ROLES)[number], typeof modelId>
    )
    .optional()
    .describe(
      'Sobrescribe el modelo de cada agente del equipo (claves: ' +
        AGENT_ROLES.join(', ') +
        '). Los defaults de orchestrator, worker y auditor son los del kit de lib-midd-mcp-architecture. Como volver a instalar reemplaza los archivos, usa este parametro para cambiar un modelo en vez de editar el .md a mano.'
    ),  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Si false (default), un archivo con el mismo nombre que NO fue instalado por este MCP se respeta y se reporta. Si true, lo reemplaza.'
    )
}

const STATUS_LABEL: Record<KitStatus, string> = {
  created: 'created',
  updated: 'updated',
  unchanged: 'unchanged',
  removed: 'removed (obsolete file from an earlier version of the kit)',
  'skipped-not-managed': 'SKIPPED (exists and was not installed by this MCP; use overwrite=true to replace it)',
  'skipped-broken-markers':
    'SKIPPED (the BEGIN/END markers of the MCP block are unbalanced: fix them by hand or delete the leftover marker)'
}

export async function installAgenticKitTool(args: {
  projectRoot: string
  overwrite: boolean
  models?: ModelOverrides
}) {
  let results
  try {
    results = installAgenticKit(args)
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: `ERROR: ${err.message}` }], isError: true }
  }
  const skipped = results.filter((r) => r.status.startsWith('skipped'))
  const models = resolveModels(args.models)

  const text = [
    `Agentic kit (MCP v${mcpVersion()}) in ${args.projectRoot}:`,
    '',
    ...results.map((r) => `  ${r.path}: ${STATUS_LABEL[r.status]}`),
    '',
    `Models: ${AGENT_ROLES.map((role) => `${AGENT_REGISTRY[role].name}=${models[role].model}`).join(' | ')}`,
    '',
    skipped.length
      ? 'Some files were NOT installed. Review the SKIPPED entries above. The agents of the team work as a set: ' +
        'if one of them belongs to another kit (for example lib-midd-mcp-architecture), the pipeline would mix ' +
        'instructions from two different MCPs. Install with overwrite=true to replace them as a set, or remove ' +
        'the other kit first.'
      : 'Done. Select middleware-generator in the agent selector of the chat input bar (Kiro IDE) or with /agent middleware-generator (Kiro CLI). ' +
        'The rest of the team (' + AGENT_ROLES.filter((r) => r !== 'orchestrator').map((r) => `${AGENT_REGISTRY[r].emoji} ${AGENT_REGISTRY[r].name}`).join(', ') + ') run behind the scenes; do not select them.',
    'Re-run this tool after upgrading the MCP to refresh the installed files (it is idempotent).'
  ].join('\n')

  return { content: [{ type: 'text' as const, text }], isError: skipped.length > 0 }
}

// ---------------------------------------------------------------------------
// get_flow: serves the step-by-step procedure. Single source of truth shared with
// the MCP prompts, so the installed agent never carries its own copy.
// ---------------------------------------------------------------------------
export const getFlowSchema = {
  flow: z
    .enum(['start', 'greenfield', 'refactor'])
    .describe(
      'start = decide greenfield vs refactor from the workspace state. greenfield = new service. refactor = convert an existing NestJS service.'
    )
}

const FLOWS = { start: START_GUIDE, greenfield: GREENFIELD_GUIDE, refactor: REFACTOR_GUIDE }

export async function getFlow(args: { flow: 'start' | 'greenfield' | 'refactor' }) {
  return { content: [{ type: 'text' as const, text: FLOWS[args.flow] }] }
}
