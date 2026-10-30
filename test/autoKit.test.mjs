import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ensureAgenticKit, autoKitEnabled } from '../dist/lib/agenticKit.js'
import { mcpVersion } from '../dist/lib/inventory.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const AGENTS = ['middleware-generator', 'middleware-gen-worker', 'middleware-auditor']
const agentPath = (root, name) => join(root, '.kiro', 'agents', `${name}.md`)
const text = (result) => result.content.map((c) => c.text).join('\n---\n')

async function session(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(HERE, '..', 'dist', 'index.js')],
    env: { ...process.env, ...env }
  })
  const client = new Client({ name: 'auto-kit-test', version: '0.0.0' })
  await client.connect(transport)
  return client
}

const scaffold = (client, projectRoot) =>
  client.callTool({ name: 'scaffold_service', arguments: { projectRoot, motor: 'none', prefijoApi: 'midd-demo', prefijoError: 'DEMO' } })

const tmp = () => mkdtempSync(join(tmpdir(), 'midd-autokit-'))
const stamp = (root) => AGENTS.map((a) => statSync(agentPath(root, a)).mtimeMs)

test('the first tool that works on a repo installs the kit and says how to select the agent', async () => {
  const client = await session()
  const root = tmp()
  try {
    const result = await scaffold(client, root)
    assert.notEqual(result.isError, true, text(result))
    // the tool answers what it always answered; the notice comes after
    assert.match(result.content[0].text, /Base del servicio generada/)
    const notice = result.content[result.content.length - 1].text
    assert.match(notice, /KIT DEL MCP INSTALADO automaticamente/)
    assert.match(notice, /PARA EL USUARIO/)
    assert.match(notice, /selector de agentes/)
    assert.match(notice, /middleware-generator/)
    assert.match(notice, /PARA EL AGENTE/)
    for (const name of AGENTS) {
      const file = readFileSync(agentPath(root, name), 'utf8')
      assert.match(file, new RegExp(`managed by midd-nestjs-hexagonal-architecture-mcp v${mcpVersion().replace(/\./g, '\\.')}`))
      assert.doesNotMatch(file, /__MODEL_|__MCP_VERSION__/, 'placeholders are resolved')
    }
    assert.ok(existsSync(join(root, 'agentic/templates/middleware.spec.template.yaml')))
    assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /BEGIN midd-nestjs-hexagonal/)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('with the kit already there nothing is written; only the tools that open a flow remind which agent to use', async () => {
  const client = await session()
  const root = tmp()
  try {
    await scaffold(client, root)
    const before = stamp(root)
    const inspect = await client.callTool({ name: 'inspect_project', arguments: { projectRoot: root } })
    assert.match(inspect.content[inspect.content.length - 1].text, /Kit del MCP ya instalado en este repo/)
    assert.match(inspect.content[inspect.content.length - 1].text, /middleware-generator/)

    const useCase = await client.callTool({
      name: 'add_use_case',
      arguments: {
        projectRoot: root, dominio: 'rates', caso: 'RetrieveRate', entidad: 'Rate', metodo: 'retrieveRate', param: 'currency', accion: 'retrieveRate',
        prefijoError: 'DEMO', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset'
      }
    })
    assert.notEqual(useCase.isError, true, text(useCase))
    assert.equal(useCase.content.length, 1, 'a tool in the middle of the flow adds no reminder')
    assert.deepEqual(stamp(root), before, 'no agent file was rewritten')
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an out-of-date kit is updated, and the models the team chose are kept', async () => {
  const client = await session()
  const root = tmp()
  try {
    await scaffold(client, root)
    // the team put a stronger model in the orchestrator, then the MCP was upgraded (older version marker in the files)
    for (const name of AGENTS) {
      const file = agentPath(root, name)
      let content = readFileSync(file, 'utf8').replace(`v${mcpVersion()} :`, 'v0.0.1 :')
      if (name === 'middleware-generator') content = content.replace(/^model:.*$/m, 'model: claude-opus-4.5')
      writeFileSync(file, content, 'utf8')
    }
    const useCase = await client.callTool({
      name: 'add_use_case',
      arguments: {
        projectRoot: root, dominio: 'rates', caso: 'RetrieveRate', entidad: 'Rate', metodo: 'retrieveRate', param: 'currency', accion: 'retrieveRate',
        prefijoError: 'DEMO', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset'
      }
    })
    assert.match(useCase.content[useCase.content.length - 1].text, /KIT DEL MCP ACTUALIZADO/)
    const generator = readFileSync(agentPath(root, 'middleware-generator'), 'utf8')
    assert.match(generator, new RegExp(`v${mcpVersion().replace(/\./g, '\\.')} :`), 'the version marker is current again')
    assert.match(generator, /^model: claude-opus-4\.5$/m, 'the model the team chose survives the update')
    assert.match(readFileSync(agentPath(root, 'middleware-gen-worker'), 'utf8'), /^model: claude-haiku-4\.5$/m)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an agent from another kit with the same name is never replaced or mixed with ours', async () => {
  const client = await session()
  const root = tmp()
  try {
    mkdirSync(join(root, '.kiro', 'agents'), { recursive: true })
    const theirs = '---\nname: middleware-generator\n---\nAgent of another kit\n'
    writeFileSync(agentPath(root, 'middleware-generator'), theirs, 'utf8')
    const result = await scaffold(client, root)
    assert.notEqual(result.isError, true, 'the tool itself still works')
    const notice = result.content[result.content.length - 1].text
    assert.match(notice, /KIT DEL MCP NO instalado/)
    assert.match(notice, /middleware-generator\.md/)
    assert.match(notice, /overwrite=true/)
    assert.equal(readFileSync(agentPath(root, 'middleware-generator'), 'utf8'), theirs)
    assert.equal(existsSync(agentPath(root, 'middleware-gen-worker')), false, 'no half kit')
    assert.equal(existsSync(join(root, 'AGENTS.md')), false)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('MIDD_NESTJS_AUTO_KIT=off turns the automatic installation off', async () => {
  const client = await session({ MIDD_NESTJS_AUTO_KIT: 'off' })
  const root = tmp()
  try {
    const result = await scaffold(client, root)
    assert.notEqual(result.isError, true, text(result))
    assert.equal(result.content.length, 1)
    assert.equal(existsSync(join(root, '.kiro')), false)
    assert.equal(existsSync(join(root, 'AGENTS.md')), false)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('only a tool that CREATES a service may create its folder; a typo in any other never leaves a stray one', async () => {
  const client = await session()
  const base = tmp()
  try {
    const missing = join(base, 'does-not-exist')
    const r = await client.callTool({ name: 'inspect_project', arguments: { projectRoot: missing } })
    assert.equal(existsSync(missing), false, 'inspect_project did not create the folder')
    assert.ok(r.content.length >= 1)

    const fresh = join(base, 'new-service')
    const made = await scaffold(client, fresh)
    assert.notEqual(made.isError, true, text(made))
    assert.ok(existsSync(agentPath(fresh, 'middleware-generator')), 'scaffold_service builds a new folder and the kit goes with it')
  } finally {
    await client.close()
    rmSync(base, { recursive: true, force: true })
  }
})

test('tools that only read or check never install anything', async () => {
  const client = await session()
  const root = tmp()
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    await client.callTool({ name: 'get_rules', arguments: {} })
    await client.callTool({ name: 'get_learnings', arguments: { projectRoot: root } })
    await client.callTool({ name: 'verify_standards', arguments: { projectRoot: root, installScript: false } })
    assert.equal(existsSync(join(root, '.kiro')), false)
    assert.equal(existsSync(join(root, 'AGENTS.md')), false)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('ensureAgenticKit: states, and the switch', () => {
  const root = tmp()
  try {
    assert.equal(ensureAgenticKit(root).state, 'installed')
    assert.equal(ensureAgenticKit(root).state, 'present')
    assert.deepEqual(ensureAgenticKit(root).files, [], 'present means nothing was touched')
    // one agent missing: the kit is completed, and the two that were there are not rewritten
    rmSync(agentPath(root, 'middleware-auditor'))
    assert.equal(ensureAgenticKit(root).state, 'updated')
    assert.ok(existsSync(agentPath(root, 'middleware-auditor')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  assert.equal(autoKitEnabled({}), true)
  for (const off of ['off', 'OFF', '0', 'false', 'no']) assert.equal(autoKitEnabled({ MIDD_NESTJS_AUTO_KIT: off }), false, off)
  assert.equal(autoKitEnabled({ MIDD_NESTJS_AUTO_KIT: 'on' }), true)
})
