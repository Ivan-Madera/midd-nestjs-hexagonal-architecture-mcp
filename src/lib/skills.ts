import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATES_ROOT } from './dataset.js'

/**
 * Skills that travel inside the MCP (templates/skills/<name>/SKILL.md plus any sibling file).
 * The agent reads them with get_skill instead of carrying a copy, so every user gets the same version.
 * They are a snapshot of the team's skills: to change one, edit the file here and release a new MCP version.
 */
export const SKILLS_ROOT = join(TEMPLATES_ROOT, 'skills')

/** The order in which the orchestrator offers them. The vulnerability fix always goes last. */
const ORDER = [
  'midd-audit-unused-dependencies',
  'midd-feature-atlas-flow',
  'midd-generate-readme-ts'
]
const LAST = 'midd-fix-snyk-vulnerabilities'

/** One or two short lines the agent shows before asking whether to run each skill. */
const SUMMARIES: Record<string, string> = {
  'midd-audit-unused-dependencies':
    'Revisa el package.json contra el codigo real: dependencias sin uso, faltantes o mal ubicadas. Propone y espera tu OK antes de tocar nada.',
  'midd-feature-atlas-flow':
    'Crea o actualiza un mapa persistente del repo (atlas) para no releer todo el workspace en las siguientes features.',
  'midd-generate-readme-ts':
    'Genera un README profesional del backend TypeScript, con diagramas y tablas, a partir del codigo real.',
  [LAST]: 'Escanea con Snyk y corrige las vulnerabilidades de dependencias en 4 fases, de menos a mas riesgo.'
}

const MAX_FILE_BYTES = 512 * 1024

export interface SkillInfo {
  name: string
  summary: string
  /** Files next to SKILL.md (posix paths), readable with get_skill file=... */
  files: string[]
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else if (entry.isFile() && statSync(full).size <= MAX_FILE_BYTES) {
      out.push(full.slice(base.length + 1).split('\\').join('/'))
    }
  }
  return out.sort()
}

function summaryFromDescription(skillFile: string): string {
  const text = readFileSync(skillFile, 'utf8')
  const m = text.match(/^description:\s*(.+)$/m)
  const raw = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  const first = raw.split(/(?<=\.)\s/)[0] ?? raw
  return first.length > 140 ? first.slice(0, 137) + '...' : first
}

function skillDirs(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => d.name)
}

/** Skills in offering order: the known ones, then any added later, and the vulnerability fix last. */
export function listSkills(root: string = SKILLS_ROOT): SkillInfo[] {
  const present = skillDirs(root)
  const names = [
    ...ORDER.filter((n) => present.includes(n)),
    ...present.filter((n) => !ORDER.includes(n) && n !== LAST).sort(),
    ...(present.includes(LAST) ? [LAST] : [])
  ]
  return names.map((name) => ({
    name,
    summary: SUMMARIES[name] ?? summaryFromDescription(join(root, name, 'SKILL.md')),
    files: walk(join(root, name)).filter((f) => f !== 'SKILL.md')
  }))
}

function normalize(name: string): string {
  const n = name.trim().toLowerCase()
  return n.startsWith('midd-') ? n : `midd-${n}`
}

export type SkillRead =
  | { ok: true; skill: SkillInfo; file: string; content: string }
  | { ok: false; error: string }

/** Reads SKILL.md (or a sibling file) of a bundled skill. Only listed files can be read. */
export function readSkill(name: string, file?: string, root: string = SKILLS_ROOT): SkillRead {
  const skills = listSkills(root)
  const skill = skills.find((s) => s.name === normalize(name))
  if (!skill) {
    return { ok: false, error: `Unknown skill "${name}". Available: ${skills.map((s) => s.name).join(', ') || '(none)'}.` }
  }
  const rel = file ?? 'SKILL.md'
  if (rel !== 'SKILL.md' && !skill.files.includes(rel)) {
    return { ok: false, error: `Skill ${skill.name} has no file "${rel}". Files: ${skill.files.join(', ') || '(only SKILL.md)'}.` }
  }
  return { ok: true, skill, file: rel, content: readFileSync(join(root, skill.name, rel), 'utf8') }
}
