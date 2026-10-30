import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readTemplate } from './dataset.js'
import { mcpVersion } from './inventory.js'

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

export type AgentRole = 'orchestrator' | 'worker' | 'auditor'
export type ModelOverrides = Partial<Record<AgentRole, string>>

/**
 * Default models and fallback chains, kept identical to the ones the sibling
 * lib-midd-mcp-architecture kit uses so both kits behave the same way:
 * orchestrator = balanced, worker = cheap (mechanical work), auditor = most capable.
 * `Auto` is always the last resort so a renamed model never breaks the flow.
 */
export const DEFAULT_MODELS: Record<AgentRole, { model: string; fallbacks: string[] }> = {
  orchestrator: { model: 'claude-sonnet-4.5', fallbacks: [] },
  worker: { model: 'claude-haiku-4.5', fallbacks: ['qwen3-coder-next', 'minimax-m2.5'] },
  auditor: { model: 'claude-opus-4.5', fallbacks: ['claude-sonnet-4.5'] }
}

// The value lands inside the YAML frontmatter of an agent file: it must be a plain model id.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export function resolveModels(overrides: ModelOverrides = {}): Record<AgentRole, { model: string; chain: string }> {
  const resolved = {} as Record<AgentRole, { model: string; chain: string }>
  for (const role of Object.keys(DEFAULT_MODELS) as AgentRole[]) {
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

const applyModels = (text: string, models: ReturnType<typeof resolveModels>): string =>
  text
    .replaceAll('__MODEL_ORCHESTRATOR__', models.orchestrator.model)
    .replaceAll('__MODEL_WORKER__', models.worker.model)
    .replaceAll('__MODEL_AUDITOR__', models.auditor.model)
    .replaceAll('__CHAIN_ORCHESTRATOR__', models.orchestrator.chain)
    .replaceAll('__CHAIN_WORKER__', models.worker.chain)
    .replaceAll('__CHAIN_AUDITOR__', models.auditor.chain)

export const AGENT_FILES = [
  { template: 'agentic/middleware-generator.md', target: '.kiro/agents/middleware-generator.md' },
  { template: 'agentic/middleware-gen-worker.md', target: '.kiro/agents/middleware-gen-worker.md' },
  { template: 'agentic/middleware-auditor.md', target: '.kiro/agents/middleware-auditor.md' }
] as const

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
        content: applyModels(withVersion(readTemplate(file.template), version), models),
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
    upsertAgentsSection(opts.projectRoot, withVersion(readTemplate('agentic/AGENTS.section.md'), version))
  ]
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

const ROLE_OF_TARGET: Record<string, AgentRole> = {
  '.kiro/agents/middleware-generator.md': 'orchestrator',
  '.kiro/agents/middleware-gen-worker.md': 'worker',
  '.kiro/agents/middleware-auditor.md': 'auditor'
}

/** Is the automatic installation on? `MIDD_NESTJS_AUTO_KIT=off` (or 0 / false / no) turns it off. */
export function autoKitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|0|false|no)$/i.test((env.MIDD_NESTJS_AUTO_KIT ?? '').trim())
}

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

    // The three agents work as a set: a file from another kit with the same name is never mixed with ours.
    const foreign = existing.filter((e) => e.kind === 'foreign')
    if (foreign.length > 0) {
      return { state: 'foreign', files: foreign.map((f) => ({ path: f.target, status: 'skipped-not-managed' as const })) }
    }

    const missing = existing.filter((e) => e.kind === 'missing')
    const outdated = existing.filter((e) => e.kind === 'managed' && e.version !== version)
    const agentsSection = join(projectRoot, 'AGENTS.md')
    const hasSection = existsSync(agentsSection) && readFileSync(agentsSection, 'utf8').includes(AGENTS_BEGIN)
    if (missing.length === 0 && outdated.length === 0 && hasSection) return { state: 'present', files: [] }

    // Keep the models the team chose (the version marker is what says a file is out of date, not its content).
    const models: ModelOverrides = {}
    for (const e of existing) {
      if (e.kind === 'managed' && e.model && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(e.model)) {
        models[ROLE_OF_TARGET[e.target]] = e.model
      }
    }
    const files = installAgenticKit({ projectRoot, overwrite: false, models })
    const wroteAny = files.some((f) => f.status === 'created' || f.status === 'updated')
    if (!wroteAny) return { state: 'present', files }
    return { state: missing.length === AGENT_FILES.length ? 'installed' : 'updated', files }
  } catch (err: any) {
    return { state: 'failed', files: [], detail: String(err?.message ?? err) }
  }
}
