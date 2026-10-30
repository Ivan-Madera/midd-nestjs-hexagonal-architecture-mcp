import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { installAgenticKit, AGENTS_BEGIN, AGENTS_END } from '../dist/lib/agenticKit.js'
import { installAgenticKitTool, getFlow } from '../dist/tools/agentic.js'
import { generateFromSpec } from '../dist/tools/generateFromSpec.js'
import { validateSpec } from '../dist/lib/spec.js'
import { mcpVersion } from '../dist/lib/inventory.js'
import { START_GUIDE, GREENFIELD_GUIDE, REFACTOR_GUIDE } from '../dist/prompts.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const AGENT = '.kiro/agents/middleware-generator.md'
const WORKER = '.kiro/agents/middleware-gen-worker.md'
const AUDITOR = '.kiro/agents/middleware-auditor.md'
const SPEC_TEMPLATE = 'agentic/templates/middleware.spec.template.yaml'
const ALL_FILES = [AGENT, WORKER, AUDITOR, SPEC_TEMPLATE, 'AGENTS.md']
const frontmatter = (text) => {
  assert.ok(text.startsWith('---\n'), 'frontmatter must be the first thing in the file')
  const end = text.indexOf('\n---\n', 4)
  assert.ok(end > 0, 'frontmatter must be closed')
  return { meta: parseYaml(text.slice(4, end)), body: text.slice(end) }
}

const newRepo = () => mkdtempSync(join(tmpdir(), 'midd-kit-'))
const read = (root, rel) => readFileSync(join(root, rel), 'utf8')
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text, 'utf8')
}
const statuses = (results) => Object.fromEntries(results.map((r) => [r.path, r.status]))
const cleanup = (root) => rmSync(root, { recursive: true, force: true })

test('install on an empty repo creates the five files, stamped with the MCP version', () => {
  const root = newRepo()
  try {
    const results = installAgenticKit({ projectRoot: root, overwrite: false })
    assert.deepEqual(Object.values(statuses(results)), ['created', 'created', 'created', 'created', 'created'])

    const version = mcpVersion()
    for (const rel of ALL_FILES) {
      const text = read(root, rel)
      assert.ok(text.includes(version), `${rel} must carry the MCP version`)
      assert.ok(!/__MCP_VERSION__|__MODEL_|__CHAIN_/.test(text), `${rel} has an unreplaced placeholder`)
    }
    assert.ok(read(root, 'AGENTS.md').startsWith(AGENTS_BEGIN))
    // the managed section is followed by the block of answers, which has its own markers and is never replaced
    assert.ok(read(root, 'AGENTS.md').includes(AGENTS_END))
    assert.ok(read(root, 'AGENTS.md').trimEnd().endsWith('<!-- END midd-nestjs-preferences -->'))
  } finally {
    cleanup(root)
  }
})

test('the three installed agents are valid Kiro agent files with the colleague kit models', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const expected = [
      [AGENT, 'middleware-generator', 'claude-sonnet-4.5'],
      [WORKER, 'middleware-gen-worker', 'claude-haiku-4.5'],
      [AUDITOR, 'middleware-auditor', 'claude-opus-4.5']
    ]
    for (const [rel, name, model] of expected) {
      const { meta, body } = frontmatter(read(root, rel))
      assert.equal(meta.name, name)
      assert.equal(rel.endsWith(`/${name}.md`), true, 'the file name must match the agent name')
      assert.equal(meta.model, model)
      assert.ok(meta.tools.includes('@mcp'))
      assert.ok(typeof meta.description === 'string' && meta.description.length > 20)
      assert.match(body, /managed by midd-nestjs-hexagonal-architecture-mcp/)
    }
  } finally {
    cleanup(root)
  }
})

test('the pipeline is consistent across the three files', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const orchestrator = frontmatter(read(root, AGENT)).meta
    const worker = frontmatter(read(root, WORKER)).meta
    const auditor = frontmatter(read(root, AUDITOR)).meta

    // The orchestrator can launch exactly the sub-agents that are installed, and trusts them.
    assert.ok(orchestrator.tools.includes('subagent') && orchestrator.tools.includes('shell'))
    const crew = orchestrator.toolsSettings.crew
    assert.deepEqual([...crew.availableAgents].sort(), [auditor.name, worker.name].sort())
    assert.deepEqual([...crew.trustedAgents].sort(), [...crew.availableAgents].sort())

    // Sub-agents report with summary. Only the auditor needs a shell to build; the worker must not have one.
    assert.ok(worker.tools.includes('summary') && auditor.tools.includes('summary'))
    assert.ok(auditor.tools.includes('shell'))
    assert.ok(!worker.tools.includes('shell'), 'the cheap worker must not run commands')
    assert.ok(!worker.tools.includes('subagent') && !auditor.tools.includes('subagent'), 'no nested pipelines')

    // The orchestrator addresses both stages by their real role names and handles every verdict.
    const body = frontmatter(read(root, AGENT)).body
    for (const term of ['middleware-gen-worker', 'middleware-auditor', 'depends_on', 'BUILD GATE']) {
      assert.ok(body.includes(term), `the orchestrator must mention "${term}"`)
    }
    for (const verdict of ['PASS', 'NEEDS-CONFIRMATION', 'PASS-PARCIAL', 'FAIL']) {
      assert.ok(body.includes(verdict), `the orchestrator must handle ${verdict}`)
      assert.ok(read(root, AUDITOR).includes(verdict), `the auditor must be able to return ${verdict}`)
    }
  } finally {
    cleanup(root)
  }
})

test('the default fallback chains are the ones of the colleague kit', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    assert.match(read(root, WORKER), /`claude-haiku-4\.5` -> `qwen3-coder-next` -> `minimax-m2\.5` -> `Auto`/)
    assert.match(read(root, AUDITOR), /`claude-opus-4\.5` -> `claude-sonnet-4\.5` -> `Auto`/)
    assert.match(read(root, AGENT), /`claude-sonnet-4\.5` -> `Auto`/)
  } finally {
    cleanup(root)
  }
})

test('models can be overridden without editing files by hand, and a reinstall keeps them', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false, models: { worker: 'claude-haiku-5.5' } })
    assert.equal(frontmatter(read(root, WORKER)).meta.model, 'claude-haiku-5.5')
    assert.equal(frontmatter(read(root, AUDITOR)).meta.model, 'claude-opus-4.5', 'the others keep their default')
    // the requested model goes first in its chain, then the kit defaults
    assert.match(read(root, WORKER), /`claude-haiku-5\.5` -> `claude-haiku-4\.5` -> `qwen3-coder-next`/)
    assert.match(read(root, AGENT), /`claude-haiku-5\.5` -> /, 'the orchestrator must route the worker stage to the override')

    // same override again: nothing changes
    assert.deepEqual(
      Object.values(statuses(installAgenticKit({ projectRoot: root, overwrite: false, models: { worker: 'claude-haiku-5.5' } }))),
      ['unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged']
    )
    // back to defaults: the agent files are refreshed
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))[WORKER], 'updated')
    assert.equal(frontmatter(read(root, WORKER)).meta.model, 'claude-haiku-4.5')
  } finally {
    cleanup(root)
  }
})

test('a model id that could break the YAML frontmatter is rejected before writing anything', async () => {
  const root = newRepo()
  try {
    for (const bad of ['claude-haiku\nname: evil', 'a b', 'x"y', '', '-bad', 'a'.repeat(80)]) {
      if (bad === '') continue // empty means "use the default"
      assert.throws(() => installAgenticKit({ projectRoot: root, overwrite: false, models: { worker: bad } }), /Invalid model id/)
    }
    const result = await installAgenticKitTool({ projectRoot: root, overwrite: false, models: { auditor: 'opus\nmodel: x' } })
    assert.equal(result.isError, true)
    assert.ok(!existsSync(join(root, '.kiro')), 'nothing may be written when a model id is invalid')
  } finally {
    cleanup(root)
  }
})

test('an agent of another kit with the same name is never mixed in silently', async () => {
  const root = newRepo()
  try {
    // lib-midd-mcp-architecture ships a middleware-auditor with the same file name.
    const theirs = '---\nname: middleware-auditor\nmodel: claude-opus-4.5\n---\nauditor de otro kit\n'
    write(root, AUDITOR, theirs)
    const result = await installAgenticKitTool({ projectRoot: root, overwrite: false })
    assert.equal(result.isError, true)
    assert.equal(read(root, AUDITOR), theirs, 'the other kit file must be untouched')
    assert.match(result.content[0].text, /work as a set/)
    assert.match(result.content[0].text, /overwrite=true/)

    // replacing as a set is explicit
    const replaced = await installAgenticKitTool({ projectRoot: root, overwrite: true })
    assert.notEqual(replaced.isError, true)
    assert.notEqual(read(root, AUDITOR), theirs)
  } finally {
    cleanup(root)
  }
})

test('the installed spec template keeps parsing as YAML despite the managed header', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const spec = parseYaml(read(root, SPEC_TEMPLATE))
    assert.equal(spec.stack, 'nestjs')
    assert.ok('use_cases' in spec && 'business_rules' in spec && 'connection' in spec)
  } finally {
    cleanup(root)
  }
})

test('install is idempotent: a second run changes nothing', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const before = ALL_FILES.map((f) => read(root, f))
    const second = installAgenticKit({ projectRoot: root, overwrite: false })
    assert.deepEqual(Object.values(statuses(second)), ['unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged'])
    assert.deepEqual(ALL_FILES.map((f) => read(root, f)), before)
  } finally {
    cleanup(root)
  }
})

test('AGENTS.md: the team text is preserved byte for byte, before and after the block', () => {
  const root = newRepo()
  try {
    const mine = '# Mi proyecto\n\nReglas del frontend: no tocar.\n'
    write(root, 'AGENTS.md', mine)
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))['AGENTS.md'], 'updated')
    const withBlock = read(root, 'AGENTS.md')
    assert.ok(withBlock.startsWith(mine), 'existing content must stay untouched at the top')
    assert.ok(withBlock.includes(AGENTS_BEGIN))

    // The team adds text AFTER the block; a reinstall must keep it and not duplicate the block.
    const after = '\n## Otra seccion del equipo\nTexto que no es del MCP.\n'
    write(root, 'AGENTS.md', withBlock + after)
    const second = installAgenticKit({ projectRoot: root, overwrite: false })
    assert.equal(statuses(second)['AGENTS.md'], 'unchanged')
    const final = read(root, 'AGENTS.md')
    assert.ok(final.startsWith(mine))
    assert.ok(final.endsWith(after))
    assert.equal(final.split(AGENTS_BEGIN).length - 1, 1, 'the block must appear exactly once')
  } finally {
    cleanup(root)
  }
})

test('AGENTS.md: a stale block (older MCP version) is replaced in place, nothing else moves', () => {
  const root = newRepo()
  try {
    const head = '# Proyecto\n\nantes\n\n'
    const tail = '\n\n## Despues\nintacto\n'
    write(root, 'AGENTS.md', `${head}${AGENTS_BEGIN}\nseccion vieja v0.0.1\n${AGENTS_END}${tail}`)
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))['AGENTS.md'], 'updated')
    const text = read(root, 'AGENTS.md')
    assert.ok(text.startsWith(head))
    assert.ok(text.includes(tail), 'the text after our section is untouched')
    assert.ok(text.indexOf(tail) < text.indexOf('<!-- BEGIN midd-nestjs-preferences'), 'the block of answers goes at the end, after what is theirs')
    assert.ok(!text.includes('seccion vieja'))
    assert.ok(text.includes(mcpVersion()))
  } finally {
    cleanup(root)
  }
})

test('AGENTS.md: CRLF files keep their line endings', () => {
  const root = newRepo()
  try {
    write(root, 'AGENTS.md', '# Proyecto\r\n\r\nlinea con CRLF\r\n')
    installAgenticKit({ projectRoot: root, overwrite: false })
    const text = read(root, 'AGENTS.md')
    assert.ok(!/(?<!\r)\n/.test(text), 'every line break must remain CRLF')
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))['AGENTS.md'], 'unchanged')
  } finally {
    cleanup(root)
  }
})

test('AGENTS.md: unbalanced markers are never touched (no duplicated or eaten text)', () => {
  const root = newRepo()
  try {
    const broken = `# Proyecto\n\n${AGENTS_BEGIN}\ntexto sin cierre\n\n## Del equipo\nimportante\n`
    write(root, 'AGENTS.md', broken)
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))['AGENTS.md'], 'skipped-broken-markers')
    assert.equal(read(root, 'AGENTS.md'), broken)
  } finally {
    cleanup(root)
  }
})

test('a same-named agent NOT installed by this MCP is respected unless overwrite=true', () => {
  const root = newRepo()
  try {
    const theirs = '---\nname: middleware-generator\ndescription: el del equipo\n---\nmi version propia\n'
    write(root, AGENT, theirs)

    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))[AGENT], 'skipped-not-managed')
    assert.equal(read(root, AGENT), theirs)

    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: true }))[AGENT], 'updated')
    assert.notEqual(read(root, AGENT), theirs)
  } finally {
    cleanup(root)
  }
})

test('the tool reports SKIPPED entries as an error so the agent cannot miss them', async () => {
  const root = newRepo()
  try {
    write(root, AGENT, '---\nname: x\n---\najeno\n')
    const result = await installAgenticKitTool({ projectRoot: root, overwrite: false })
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /SKIPPED/)
  } finally {
    cleanup(root)
  }
})

test('a managed file from an older MCP version is refreshed on reinstall', () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const current = read(root, AGENT)
    write(root, AGENT, current.replace(mcpVersion(), '0.0.1'))
    assert.equal(statuses(installAgenticKit({ projectRoot: root, overwrite: false }))[AGENT], 'updated')
    assert.equal(read(root, AGENT), current)
  } finally {
    cleanup(root)
  }
})

// ---------------------------------------------------------------------------
// Drift guards: the agent must teach exactly what the parser accepts.
// ---------------------------------------------------------------------------
test('the vocabulary the agent teaches is exactly what validateSpec accepts', async () => {
  const root = newRepo()
  try {
    installAgenticKit({ projectRoot: root, overwrite: false })
    const agent = read(root, AGENT)
    for (const term of [
      'error_prefix',
      'connection.name',
      'connection.style',
      'none: true',
      'dtos.input',
      'dtos.output',
      'resource_type',
      'agentic/specs/{module}/input/specs/middleware.spec.yaml'
    ]) {
      assert.ok(agent.includes(term), `the agent must mention "${term}"`)
    }

    // A spec built only with those fields must validate and produce a plan.
    const spec = {
      module: 'catalog',
      entity: 'Product',
      description: 'Consulta de productos',
      stack: 'nestjs',
      error_prefix: 'CATALOG',
      connection: { name: 'Catalog', style: 'named', engine: 'mssql' },
      use_cases: [
        {
          name: 'RetrieveProduct',
          action: 'retrieveProduct',
          resource_type: 'product',
          adapter: 'sp',
          methods: [{ name: 'retrieveBySku', request: 'RetrieveProductRequest', response: 'Product', sp: 'GetProductBySku' }]
        }
      ],
      dtos: { input: { sku: 'string' }, output: { id: 'number', sku: 'string' } },
      business_rules: { none: true, rules: [] },
      complexity: { level: 0, signals: [] },
      notes: []
    }
    assert.doesNotThrow(() => validateSpec(spec))

    const specPath = join(root, 'agentic/specs/catalog/input/specs/middleware.spec.yaml')
    mkdirSync(dirname(specPath), { recursive: true })
    writeFileSync(specPath, JSON.stringify(spec), 'utf8') // JSON is valid YAML
    const plan = await generateFromSpec({ projectRoot: root, specPath, mode: 'greenfield', dryRun: true, overwrite: false })
    assert.notEqual(plan.isError, true, plan.content[0].text)
    assert.match(plan.content[0].text, /PLAN de generaci/)
    assert.ok(!existsSync(join(root, 'src')), 'a dry run must not write the module')
  } finally {
    cleanup(root)
  }
})

test('get_flow serves the same text as the MCP prompts (single source of truth)', async () => {
  for (const [flow, guide] of [['start', START_GUIDE], ['greenfield', GREENFIELD_GUIDE], ['refactor', REFACTOR_GUIDE]]) {
    assert.equal((await getFlow({ flow })).content[0].text, guide)
  }
  assert.match(GREENFIELD_GUIDE, /generate_from_spec/, 'the greenfield flow must know the spec route')
  assert.match(GREENFIELD_GUIDE, /add_authorization/)
})

test('MCP protocol: every tool the agent and AGENTS.md name is really registered, and the kit is callable', async () => {
  const root = newRepo()
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(HERE, '..', 'dist', 'index.js')] })
  const client = new Client({ name: 'kit-test', version: '0.0.0' })
  try {
    await client.connect(transport)
    const registered = new Set((await client.listTools()).tools.map((t) => t.name))

    const expected = [
      'get_rules',
      'inspect_project',
      'generate_from_spec',
      'add_authorization',
      'verify_standards',
      'record_architecture',
      'get_flow',
      'install_agentic_kit'
    ]
    for (const name of expected) assert.ok(registered.has(name), `tool not registered: ${name}`)

    installAgenticKit({ projectRoot: root, overwrite: false })
    const mentioned = [AGENT, WORKER, AUDITOR, 'AGENTS.md'].map((f) => read(root, f)).join('\n')
    for (const name of expected.filter((n) => n !== 'install_agentic_kit')) {
      assert.ok(mentioned.includes(name), `the kit never mentions ${name}`)
    }

    // Every snake_case word the kit puts in backticks that LOOKS like a tool must be a real one.
    const specFields = new Set(['error_prefix', 'use_cases', 'resource_type', 'business_rules'])
    const toolLike = [...mentioned.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]).filter((n) => !specFields.has(n))
    for (const name of new Set(toolLike)) assert.ok(registered.has(name), `the kit names a tool that does not exist: ${name}`)

    const flow = await client.callTool({ name: 'get_flow', arguments: { flow: 'greenfield' } })
    assert.match(flow.content[0].text, /GREENFIELD/)

    const fresh = newRepo()
    try {
      const installed = await client.callTool({ name: 'install_agentic_kit', arguments: { projectRoot: fresh } })
      assert.notEqual(installed.isError, true)
      assert.ok(existsSync(join(fresh, AGENT)))
    } finally {
      cleanup(fresh)
    }
  } finally {
    await client.close()
    cleanup(root)
  }
})

test('MCP protocol: the models parameter is advertised, validated by the schema, and applied', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(HERE, '..', 'dist', 'index.js')] })
  const client = new Client({ name: 'models-test', version: '0.0.0' })
  const root = newRepo()
  try {
    await client.connect(transport)
    const tool = (await client.listTools()).tools.find((t) => t.name === 'install_agentic_kit')
    const models = tool.inputSchema.properties.models
    assert.ok(models, 'the tool must advertise a models parameter')
    assert.deepEqual(Object.keys(models.properties).sort(), ['auditor', 'orchestrator', 'worker'])
    assert.ok(!(tool.inputSchema.required ?? []).includes('models'), 'models must be optional')

    const bad = await client
      .callTool({ name: 'install_agentic_kit', arguments: { projectRoot: root, models: { worker: 'x\nmodel: evil' } } })
      .then((r) => r, (e) => e)
    const rejected = bad instanceof Error || bad.isError === true
    assert.ok(rejected, 'a malformed model id must be rejected over the wire')
    assert.ok(!existsSync(join(root, '.kiro')), 'nothing may be written for a rejected call')

    const ok = await client.callTool({
      name: 'install_agentic_kit',
      arguments: { projectRoot: root, models: { worker: 'claude-haiku-5.5' } }
    })
    assert.notEqual(ok.isError, true, ok.content[0].text)
    assert.match(ok.content[0].text, /middleware-gen-worker=claude-haiku-5\.5/)
    assert.equal(frontmatter(read(root, WORKER)).meta.model, 'claude-haiku-5.5')
  } finally {
    await client.close()
    cleanup(root)
  }
})