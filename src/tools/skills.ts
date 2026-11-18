import { z } from 'zod'
import { listSkills, readSkill } from '../lib/skills.js'

// ---------------------------------------------------------------------------
// get_skill: serves the skills bundled with the MCP. Without a name it lists them
// in the order the orchestrator offers them, each with a one-line summary.
// ---------------------------------------------------------------------------
export const getSkillSchema = {
  name: z
    .string()
    .optional()
    .describe('Nombre de la skill (p.ej. "midd-generate-readme-ts" o "generate-readme-ts"). Sin nombre devuelve la lista ordenada con su resumen.'),
  file: z
    .string()
    .optional()
    .describe('Archivo adicional de la skill (p.ej. "standards.md"). Sin valor se devuelve SKILL.md.')
}

export async function getSkill(args: { name?: string; file?: string }) {
  if (!args.name) {
    const skills = listSkills()
    const text = skills.length
      ? [
          'Skills del MCP, en el orden en que se ofrecen (de una en una, la ultima siempre al final):',
          '',
          ...skills.map((s, i) => `${i + 1}. ${s.name}: ${s.summary}${s.files.length ? ` [archivos: ${s.files.join(', ')}]` : ''}`)
        ].join('\n')
      : 'No hay skills empaquetadas en este MCP.'
    return { content: [{ type: 'text' as const, text }] }
  }
  const read = readSkill(args.name, args.file)
  if (!read.ok) return { content: [{ type: 'text' as const, text: `ERROR: ${read.error}` }], isError: true }
  const extra =
    read.file === 'SKILL.md' && read.skill.files.length
      ? `\n\n---\nArchivos adicionales de esta skill (pidelos con get_skill file=...): ${read.skill.files.join(', ')}`
      : ''
  return { content: [{ type: 'text' as const, text: read.content + extra }] }
}
