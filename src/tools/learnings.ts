import { z } from 'zod'
import { DECISIONS, learnDecision, loadLearnings, renderLearnings, type DecisionKey } from '../lib/learnings.js'
import { readPreferences } from '../lib/preferences.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// get_learnings: what the MCP remembers about THIS repo (read-only, advisory).
// ---------------------------------------------------------------------------
export const getLearningsSchema = {
  projectRoot: s.projectRoot
}

export async function getLearnings(args: { projectRoot: string }) {
  // What the user wrote in AGENTS.md wins over what was saved in the learnings file: it is the one he can edit.
  return { content: [{ type: 'text' as const, text: renderLearnings(loadLearnings(args.projectRoot), readPreferences(args.projectRoot)) }] }
}

// ---------------------------------------------------------------------------
// record_decision: a decision the USER took once for the whole repo, from a closed list.
// ---------------------------------------------------------------------------
export const recordDecisionSchema = {
  projectRoot: s.projectRoot,
  decision: z
    .enum(Object.keys(DECISIONS) as [DecisionKey, ...DecisionKey[]])
    .describe('Decision del usuario para todo el repo. Lista cerrada: authorization y postman (coleccion de Postman).'),
  value: z.string().describe('"enabled" o "disabled" (solo si el usuario lo dijo de forma explicita). Se guarda en AGENTS.md, a la vista, para no volver a preguntarlo.')
}

export async function recordDecision(args: { projectRoot: string; decision: DecisionKey; value: string }) {
  const allowed = DECISIONS[args.decision] as readonly string[]
  if (!allowed.includes(args.value)) {
    return {
      content: [{ type: 'text' as const, text: `ERROR: "${args.value}" no es un valor valido para ${args.decision}. Validos: ${allowed.join(', ')}.` }],
      isError: true
    }
  }
  // Saved in the learnings file and shown in AGENTS.md (learnDecision does both).
  const changed = learnDecision(args.projectRoot, args.decision, args.value)
  return {
    content: [
      {
        type: 'text' as const,
        text: changed
          ? `Decision registrada: ${args.decision} = ${args.value} (docs/mcp-learnings.json y AGENTS.md).`
          : `Sin cambios: ${args.decision} ya era ${args.value}, o docs/mcp-learnings.json no se pudo actualizar.`
      }
    ]
  }
}
