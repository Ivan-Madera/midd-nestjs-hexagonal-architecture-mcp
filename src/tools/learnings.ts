import { z } from 'zod'
import { DECISIONS, learnDecision, loadLearnings, renderLearnings, type DecisionKey } from '../lib/learnings.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// get_learnings: what the MCP remembers about THIS repo (read-only, advisory).
// ---------------------------------------------------------------------------
export const getLearningsSchema = {
  projectRoot: s.projectRoot
}

export async function getLearnings(args: { projectRoot: string }) {
  return { content: [{ type: 'text' as const, text: renderLearnings(loadLearnings(args.projectRoot)) }] }
}

// ---------------------------------------------------------------------------
// record_decision: a decision the USER took once for the whole repo, from a closed list.
// ---------------------------------------------------------------------------
export const recordDecisionSchema = {
  projectRoot: s.projectRoot,
  decision: z
    .enum(Object.keys(DECISIONS) as [DecisionKey, ...DecisionKey[]])
    .describe('Decision del usuario para todo el repo. Lista cerrada: authorization.'),
  value: z.string().describe('authorization: "enabled" o "disabled" (solo si el usuario lo dijo de forma explicita).')
}

export async function recordDecision(args: { projectRoot: string; decision: DecisionKey; value: string }) {
  const allowed = DECISIONS[args.decision] as readonly string[]
  if (!allowed.includes(args.value)) {
    return {
      content: [{ type: 'text' as const, text: `ERROR: "${args.value}" no es un valor valido para ${args.decision}. Validos: ${allowed.join(', ')}.` }],
      isError: true
    }
  }
  const changed = learnDecision(args.projectRoot, args.decision, args.value)
  return {
    content: [
      {
        type: 'text' as const,
        text: changed
          ? `Decision registrada: ${args.decision} = ${args.value} (docs/mcp-learnings.json).`
          : `Sin cambios: ${args.decision} ya era ${args.value}, o docs/mcp-learnings.json no se pudo actualizar.`
      }
    ]
  }
}
