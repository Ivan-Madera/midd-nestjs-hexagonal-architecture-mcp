import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readTemplate } from './dataset.js'
import { mcpVersion } from './inventory.js'
import { ensurePreferencesBlock } from './preferences.js'

/**
 * Agentic kit: the minimal files the consuming repo needs so any agent enters the
 * MCP the same way. The MCP writes them directly (it already writes to disk), and
 * every file carries the MCP version so a stale install is visible and re-installable.
 *
 * Ownership rules (never destroy what the team wrote):
 *  - A file is "managed" only if it carries MANAGED_MARKER. Managed files are
 *    replaced on reinstall. A same-named file WITHOUT the marker is never touched
 *    unless overwrite=true.
 *  - AGENTS.md is shared: only the block between BEGIN/END is ours. Everything
 *    else in the file is preserved byte for byte.
 */

export const MANAGED_MARKER = 'managed by midd-nestjs-hexagonal-architecture-mcp'
export const AGENTS_BEGIN = '<!-- BEGIN midd-nestjs-hexagonal (managed by midd-nestjs-hexagonal-architecture-mcp) -->'
export const AGENTS_END = '<!-- END midd-nestjs-hexagonal -->'

export type KitStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'removed'
  | 'skipped-not-managed'
  | 'skipped-broken-markers'

export type KitFileResult = { path: string; status: KitStatus }

const withVersion = (text: string, version: string): string => text.replaceAll('__MCP_VERSION__', version)

const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n')

function writeIfChanged(fullPath: string, content: string): 'created' | 'updated' | 'unchanged' {
  if (!existsSync(fullPath)) {
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf8')
    return 'created'
  }
  if (normalizeEol(readFileSync(fullPath, 'utf8')) === normalizeEol(content)) return 'unchanged'
  writeFileSync(fullPath, content, 'utf8')
  return 'updated'
}

/** Writes a whole file owned by the MCP. Respects files the team wrote themselves. */
export function installManagedFile(opts: {
  projectRoot: string
  relativePath: string
  content: string
  overwrite: boolean
}): KitFileResult {
  const fullPath = join(opts.projectRoot, opts.relativePath)
  if (existsSync(fullPath) && !opts.overwrite) {
    const current = readFileSync(fullPath, 'utf8')
    if (!current.includes(MANAGED_MARKER)) {
      return { path: opts.relativePath, status: 'skipped-not-managed' }
    }
  }
  return { path: opts.relativePath, status: writeIfChanged(fullPath, opts.content) }
}

/**
 * Inserts or replaces the MCP block of AGENTS.md. Content outside the markers is
 * preserved exactly. Creates the file when missing; appends when it has no block yet.
 */
export function upsertAgentsSection(projectRoot: string, section: string): KitFileResult {
  const relativePath = 'AGENTS.md'
  const fullPath = join(projectRoot, relativePath)
  const block = `${AGENTS_BEGIN}\n${section.trim()}\n${AGENTS_END}\n`

  if (!existsSync(fullPath)) {
    return { path: relativePath, status: writeIfChanged(fullPath, block) }
  }

  const current = readFileSync(fullPath, 'utf8')
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  const begin = current.indexOf(AGENTS_BEGIN)
  const end = current.indexOf(AGENTS_END)

  // One marker without the other (someone deleted half of the block): appending would
  // duplicate the section, replacing would eat unrelated text. Leave it and report.
  if ((begin !== -1) !== (end !== -1) || (begin !== -1 && end < begin)) {
    return { path: relativePath, status: 'skipped-broken-markers' }
  }

  let next: string
  if (begin !== -1 && end > begin) {
    const afterEnd = end + AGENTS_END.length
    const trailing = current.slice(afterEnd).replace(/^\r?\n/, '')
    next = current.slice(0, begin) + block.replace(/\n/g, eol).trimEnd() + (trailing ? eol + trailing : eol)
  } else {
    const separator = current.endsWith('\n') ? eol : eol + eol
    next = current + separator + block.replace(/\n/g, eol)
  }

  if (normalizeEol(next) === normalizeEol(current)) return { path: relativePath, status: 'unchanged' }
  writeFileSync(fullPath, next, 'utf8')
  return { path: relativePath, status: 'updated' }
}

/**
 * The team. `middleware-generator` is the only agent the user selects; the rest are sub-agents it delegates to.
 * One registry drives the file names, the emoji (so the user can tell who is working), the models and the table
 * that the orchestrator prints, so the four never drift apart.
 */
export const AGENT_REGISTRY = {
  orchestrator: {
    name: 'middleware-generator', emoji: '🧱', template: 'agentic/middleware-generator.md',
    model: 'claude-sonnet-4.5', fallbacks: [] as string[],
    when: 'Unico que se selecciona: pregunta, arma el spec, genera, reparte el trabajo y cierra'
  },
  worker: {
    name: 'middleware-gen-worker', emoji: '⚙️', template: 'agentic/middleware-gen-worker.md',
    model: 'claude-haiku-4.5', fallbacks: ['qwen3-coder-next', 'minimax-m2.5'],
    when: 'Completa el andamiaje desde el spec y corrige bugs acotados con el diff minimo (trabajo mecanico)'
  },
  auditor: {
    name: 'middleware-auditor', emoji: '🔎', template: 'agentic/middleware-auditor.md',
    model: 'claude-opus-4.5', fallbacks: ['claude-sonnet-4.5'],
    when: 'Valida estandares, build y tests; deja auditoria e inventario; revisa diffs y PRs (modo diff, solo lectura)'
  },
  appsec: {
    name: 'middleware-appsec', emoji: '🛡️', template: 'agentic/middleware-appsec.md',
    model: 'claude-opus-4.5', fallbacks: ['claude-sonnet-4.5'],
    when: 'Revision de seguridad del codigo y de secretos (solo lectura)'
  },
  tester: {
    name: 'middleware-tester', emoji: '🧪', template: 'agentic/middleware-tester.md',
    model: 'claude-sonnet-4.5', fallbacks: ['claude-haiku-4.5'],
    when: 'Pruebas unitarias jest deterministas, solo si el usuario las pide o las acepta (solo toca archivos .spec.ts)'
  }
} as const

export type AgentRole = keyof typeof AGENT_REGISTRY
export const AGENT_ROLES = Object.keys(AGENT_REGISTRY) as AgentRole[]
export type ModelOverrides = Partial<Record<AgentRole, string>>

/**
 * Default models and fallback chains. The first three are identical to the ones the sibling
 * lib-midd-mcp-architecture kit uses: orchestrator = balanced, worker = cheap (mechanical work),
 * auditor = most capable. appsec follows the same idea (most capable where a mistake is expensive) and the
 * tester is balanced.
 * `Auto` is always the last resort so a renamed model never breaks the flow.
 */
export const DEFAULT_MODELS: Record<AgentRole, { model: string; fallbacks: string[] }> = Object.fromEntries(
  AGENT_ROLES.map((role) => [role, { model: AGENT_REGISTRY[role].model, fallbacks: [...AGENT_REGISTRY[role].fallbacks] }])
) as Record<AgentRole, { model: string; fallbacks: string[] }>

// The value lands inside the YAML frontmatter of an agent file: it must be a plain model id.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export function resolveModels(overrides: ModelOverrides = {}): Record<AgentRole, { model: string; chain: string }> {
  const resolved = {} as Record<AgentRole, { model: string; chain: string }>
  for (const role of AGENT_ROLES) {
    const override = overrides[role]?.trim()
    if (override !== undefined && override !== '' && !MODEL_ID.test(override)) {
      throw new Error(
        `Invalid model id for ${role}: "${overrides[role]}". Use a plain model name such as "claude-haiku-4.5".`
      )
    }
    const { model: defaultModel, fallbacks } = DEFAULT_MODELS[role]
    const model = override ? override : defaultModel
    // The requested model first, then the kit defaults, then Auto.
    const chain = [...new Set([model, defaultModel, ...fallbacks, 'Auto'])]
    resolved[role] = { model, chain: chain.map((m) => `\`${m}\``).join(' -> ') }
  }
  return resolved
}

const teamTable = (models: ReturnType<typeof resolveModels>): string =>
  [
    '| Agente | Cuando | Modelo (con respaldo) |',
    '|---|---|---|',
    ...AGENT_ROLES.filter((role) => role !== 'orchestrator').map(
      (role) => `| ${AGENT_REGISTRY[role].emoji} \`${AGENT_REGISTRY[role].name}\` | ${AGENT_REGISTRY[role].when} | ${models[role].chain} |`
    )
  ].join('\n')

/**
 * One closing protocol for the whole team, so no agent receives two different instructions. A sub-agent launched with
 * `subagent` reports with `summary`; the same agent running inside a workflow reports with `send_message`, which Kiro
 * wires into every workflow step.
 */
const closing = (role: AgentRole): string =>
  `**Cierre (igual para todo el equipo).** Entrega tu reporte como respuesta final, abriendo con \`${AGENT_REGISTRY[role].emoji} ${AGENT_REGISTRY[role].name}:\`. ` +
  'Si te lanzaron con `subagent`, llama `summary` con ese reporte. Si corres dentro de un workflow, cierra con `send_message`: ' +
  'severity `success` al terminar, `warning` si necesitas una decision del usuario y `error` si no pudiste completar la tarea.'

/** The agents the orchestrator may start: the team in the registry, and nobody else. One source for every list in its frontmatter. */
const SUBAGENT_NAMES = AGENT_ROLES.filter((role) => role !== 'orchestrator').map((role) => AGENT_REGISTRY[role].name)
const subagentList = SUBAGENT_NAMES.map((name) => `      - ${name}`).join('\n')
const subagentArray = `[${SUBAGENT_NAMES.map((name) => `"${name}"`).join(', ')}]`

const applyModels = (text: string, models: ReturnType<typeof resolveModels>, role: AgentRole): string => {
  let out = text
    .replaceAll('__SUBAGENT_LIST__', subagentList)
    .replaceAll('__SUBAGENT_ARRAY__', subagentArray)
    .replaceAll('__CLOSING__', closing(role))
    .replaceAll('__EMOJI__', AGENT_REGISTRY[role].emoji)
    .replaceAll('__TEAM_TABLE__', teamTable(models))
  for (const r of AGENT_ROLES) {
    out = out.replaceAll(`__MODEL_${r.toUpperCase()}__`, models[r].model).replaceAll(`__CHAIN_${r.toUpperCase()}__`, models[r].chain)
  }
  return out
}

export const AGENT_FILES = AGENT_ROLES.map((role) => ({
  role,
  template: AGENT_REGISTRY[role].template,
  target: `.kiro/agents/${AGENT_REGISTRY[role].name}.md`
}))

/**
 * Files an earlier version of the kit installed and this one no longer ships: seven agents folded into the four of
 * the team (their work moved to the worker, the auditor and appsec) and the parallel-review workflow that called them.
 * They are removed from a consuming repo only if they still carry MANAGED_MARKER; a file the team wrote or edited
 * to take ownership of (no marker) is never touched.
 */
export const OBSOLETE_KIT_FILES = [
  '.kiro/agents/middleware-onboarding.md',
  '.kiro/agents/middleware-architect.md',
  '.kiro/agents/middleware-backend.md',
  '.kiro/agents/middleware-fixer.md',
  '.kiro/agents/middleware-reviewer.md',
  '.kiro/agents/middleware-secrets.md',
  '.kiro/agents/middleware-dbre.md',
  '.kiro/workflows/middleware-parallel-review.workflow.yaml'
] as const

const isManagedFile = (fullPath: string): boolean => readFileSync(fullPath, 'utf8').includes(MANAGED_MARKER)

/** Obsolete kit files that are still in the repo and that this MCP installed (so it may remove them). */
const obsoleteManagedFiles = (projectRoot: string): string[] =>
  OBSOLETE_KIT_FILES.filter((relativePath) => {
    const full = join(projectRoot, relativePath)
    return existsSync(full) && isManagedFile(full)
  })

function removeObsoleteKitFiles(projectRoot: string): KitFileResult[] {
  return obsoleteManagedFiles(projectRoot).map((relativePath) => {
    unlinkSync(join(projectRoot, relativePath))
    return { path: relativePath, status: 'removed' as const }
  })
}

export function installAgenticKit(opts: {
  projectRoot: string
  overwrite: boolean
  models?: ModelOverrides
}): KitFileResult[] {
  const version = mcpVersion()
  const models = resolveModels(opts.models)
  const results: KitFileResult[] = [
    ...AGENT_FILES.map((file) =>
      installManagedFile({
        projectRoot: opts.projectRoot,
        relativePath: file.target,
        content: applyModels(withVersion(readTemplate(file.template), version), models, file.role),
        overwrite: opts.overwrite
      })
    ),
    installManagedFile({
      projectRoot: opts.projectRoot,
      relativePath: 'agentic/templates/middleware.spec.template.yaml',
      content: `# ${MANAGED_MARKER} v${version}: do not edit by hand, run install_agentic_kit to update\n${readTemplate(
        'middleware.spec.template.yaml'
      )}`,
      overwrite: opts.overwrite
    }),
    ...removeObsoleteKitFiles(opts.projectRoot),
    upsertAgentsSection(opts.projectRoot, withVersion(readTemplate('agentic/AGENTS.section.md'), version))
  ]
  // The block of answers has its own markers: it is created once and its values are never touched afterwards.
  const agents = results[results.length - 1]
  if (agents.status !== 'skipped-broken-markers' && ensurePreferencesBlock(opts.projectRoot) === 'created' && agents.status === 'unchanged') {
    agents.status = 'updated'
  }
  return results
}

// --- automatic installation -------------------------------------------------------------------------
//
// Any tool that works on a repo makes sure the kit is there first, so the user never has to ask for it. The check
// comes before the write: nothing is touched when the kit is already installed at this version, files the team
// wrote itself are never replaced, and the models a team chose for the agents survive an update.

export type KitEnsureState = 'installed' | 'updated' | 'present' | 'foreign' | 'failed'
export type KitEnsureResult = { state: KitEnsureState; files: KitFileResult[]; detail?: string }

const MANAGED_VERSION = /managed by midd-nestjs-hexagonal-architecture-mcp v(\S+)/
const MODEL_LINE = /^model:\s*(\S+)\s*$/m

const ROLE_OF_TARGET: Record<string, AgentRole> = Object.fromEntries(AGENT_FILES.map((f) => [f.target, f.role]))

export { autoKitEnabled } from './kitSwitch.js'

export function ensureAgenticKit(projectRoot: string): KitEnsureResult {
  const version = mcpVersion()
  try {
    const existing = AGENT_FILES.map((file) => {
      const full = join(projectRoot, file.target)
      if (!existsSync(full)) return { target: file.target, kind: 'missing' as const }
      const text = readFileSync(full, 'utf8')
      if (!text.includes(MANAGED_MARKER)) return { target: file.target, kind: 'foreign' as const }
      return {
        target: file.target,
        kind: 'managed' as const,
        version: MANAGED_VERSION.exec(text)?.[1],
        model: MODEL_LINE.exec(text)?.[1]
      }
    })

    // The agents of the team work as a set: a file from another kit with the same name is never mixed with ours.
    const foreign = existing.filter((e) => e.kind === 'foreign')
    if (foreign.length > 0) {
      return { state: 'foreign', files: foreign.map((f) => ({ path: f.target, status: 'skipped-not-managed' as const })) }
    }

    const missing = existing.filter((e) => e.kind === 'missing')
    const outdated = existing.filter((e) => e.kind === 'managed' && e.version !== version)
    const agentsSection = join(projectRoot, 'AGENTS.md')
    const agentsText = existsSync(agentsSection) ? readFileSync(agentsSection, 'utf8') : ''
    const hasSection = agentsText.includes(AGENTS_BEGIN) && agentsText.includes('<!-- BEGIN midd-nestjs-preferences')
    // Agents and the workflow that an older kit installed and this one dropped: their presence also means the kit is updated.
    const obsolete = obsoleteManagedFiles(projectRoot)
    if (missing.length === 0 && outdated.length === 0 && hasSection && obsolete.length === 0) return { state: 'present', files: [] }

    // Keep the models the team chose (the version marker is what says a file is out of date, not its content).
    const models: ModelOverrides = {}
    for (const e of existing) {
      if (e.kind === 'managed' && e.model && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(e.model)) {
        models[ROLE_OF_TARGET[e.target]] = e.model
      }
    }
    const files = installAgenticKit({ projectRoot, overwrite: false, models })
    const wroteAny = files.some((f) => f.status === 'created' || f.status === 'updated' || f.status === 'removed')
    if (!wroteAny) return { state: 'present', files }
    return { state: missing.length === AGENT_FILES.length ? 'installed' : 'updated', files }
  } catch (err: any) {
    return { state: 'failed', files: [], detail: String(err?.message ?? err) }
  }
}
