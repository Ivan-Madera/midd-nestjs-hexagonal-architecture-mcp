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

const scaffoldOnce = (client, projectRoot) =>
  client.callTool({ name: 'scaffold_service', arguments: { projectRoot, motor: 'none', prefijoApi: 'midd-demo', prefijoError: 'DEMO' } })

// On a repo without the kit the first call is the gate (it installs the kit and generates nothing): run it again.
const scaffold = async (client, projectRoot) => {
  const first = await scaffoldOnce(client, projectRoot)
  return text(first).includes('TODAVIA NO GENERE NADA') ? scaffoldOnce(client, projectRoot) : first
}

const tmp = () => mkdtempSync(join(tmpdir(), 'midd-autokit-'))
const stamp = (root) => AGENTS.map((a) => statSync(agentPath(root, a)).mtimeMs)

test('first contact: the kit is installed, NOTHING is generated, and the user is told to pick the agent', async () => {
  const client = await session()
  const root = tmp()
  try {
    const result = await scaffoldOnce(client, root)
    assert.notEqual(result.isError, true, text(result))
    assert.equal(result.content.length, 1)
    const notice = result.content[0].text
    assert.match(notice, /KIT DEL MCP INSTALADO automaticamente/)
    assert.match(notice, /TODAVIA NO GENERE NADA/)
    assert.match(notice, /PARA EL USUARIO/)
    assert.match(notice, /selector de agentes/)
    assert.match(notice, /middleware-generator/)
    assert.match(notice, /PARA EL AGENTE: no llames otra vez esta herramienta/)
    assert.doesNotMatch(notice, /continua solo si el te lo confirma/, 'the gate and the generic reminder do not contradict each other')
    assert.equal(existsSync(join(root, 'src')), false, 'the service was not generated')
    assert.equal(existsSync(join(root, 'package.json')), false)
    for (const name of AGENTS) {
      const file = readFileSync(agentPath(root, name), 'utf8')
      assert.match(file, new RegExp('managed by midd-nestjs-hexagonal-architecture-mcp v' + mcpVersion().replace(/\./g, '\\.')))
      assert.doesNotMatch(file, /__MODEL_|__MCP_VERSION__/, 'placeholders are resolved')
    }
    assert.ok(existsSync(join(root, 'agentic/templates/middleware.spec.template.yaml')))
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    assert.match(agents, /BEGIN midd-nestjs-hexagonal/)
    assert.match(agents, /AUTHORIZATION: undefined/, 'the answers block is there from the start, all undefined')

    // once the kit exists the same call runs (the user switched agent, or knows what he does)
    const again = await scaffoldOnce(client, root)
    assert.match(again.content[0].text, /Base del servicio generada/)
    assert.ok(existsSync(join(root, 'src')))
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('every tool that generates is gated on first contact; a plan and a read are not', async () => {
  const client = await session()
  try {
    const calls = {
      add_use_case: (root) => ({ projectRoot: root, dominio: 'rates', caso: 'RetrieveRate', entidad: 'Rate', metodo: 'retrieveRate', param: 'currency', accion: 'retrieveRate', prefijoError: 'DEMO', adapterType: 'http', apiExterna: 'ExchangeRates', rutaApi: '/rates', mode: 'greenfield', connectionStyle: 'named', infraStyle: 'dataset' }),
      add_authorization: (root) => ({ projectRoot: root, authorizationApiUrl: 'https://auth.example.com' }),
      generate_from_spec: (root) => ({ projectRoot: root, specPath: join(root, 'missing.yaml'), mode: 'greenfield', dryRun: false })
    }
    for (const [name, args] of Object.entries(calls)) {
      const root = tmp()
      try {
        const result = await client.callTool({ name, arguments: args(root) })
        assert.match(text(result), /TODAVIA NO GENERE NADA/, name)
        assert.equal(existsSync(join(root, 'src')), false, name + ' wrote nothing')
        assert.ok(existsSync(agentPath(root, 'middleware-generator')), name + ' installed the kit')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
    // reading is not gated
    const root = tmp()
    try {
      const inspect = await client.callTool({ name: 'inspect_project', arguments: { projectRoot: root } })
      assert.doesNotMatch(text(inspect), /TODAVIA NO GENERE NADA/)
      assert.match(text(inspect), /KIT DEL MCP INSTALADO/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  } finally {
    await client.close()
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

test('a dry run only plans: it installs nothing; the real run does', async () => {
  const client = await session()
  const root = tmp()
  try {
    mkdirSync(join(root, 'agentic/specs/rates/input/specs'), { recursive: true })
    const spec = join(root, 'agentic/specs/rates/input/specs/middleware.spec.yaml')
    writeFileSync(
      spec,
      [
        'module: rates', 'entity: Rate', 'description: x', 'stack: nestjs', 'error_prefix: RATES',
        'use_cases:', '  - name: RetrieveRate', '    action: retrieveRate', '    resource_type: rate', '    adapter: http', '    api: ExchangeRates',
        '    methods:', '      - { name: retrieveRate, request: RetrieveRateRequest, response: Rate, http: { method: GET, path: /rates } }',
        'dtos:', '  input: { currency: string }', '  output: { value: number }',
        'business_rules: { none: true, rules: [] }', 'complexity: { level: 0, signals: [] }', ''
      ].join('\n')
    )
    const plan = await client.callTool({ name: 'generate_from_spec', arguments: { projectRoot: root, specPath: spec, mode: 'greenfield', dryRun: true } })
    assert.notEqual(plan.isError, true, text(plan))
    assert.equal(plan.content.length, 1, 'no kit notice on a plan')
    assert.equal(existsSync(join(root, '.kiro')), false, 'a dry run wrote nothing')
    assert.equal(existsSync(join(root, 'AGENTS.md')), false)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('inspect_project says in its description that it installs the kit, so nobody is told it never writes', async () => {
  const client = await session()
  try {
    const tools = (await client.listTools()).tools
    const description = tools.find((x) => x.name === 'inspect_project').description
    assert.doesNotMatch(description, /No escribe\.|SOLO LECTURA/)
    assert.match(description, /instalacion automatica del kit de agentes/)
    assert.match(description, /MIDD_NESTJS_AUTO_KIT=off/)
  } finally {
    await client.close()
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

test('scaffold_service called with only the folder (what a default agent does): first the kit and the agent notice, then a message that says what to ask', async () => {
  const client = await session()
  const root = tmp()
  try {
    // 1) no kit yet: it installs and tells the user to pick the agent; it does not fail with a schema error
    const first = await client.callTool({ name: 'scaffold_service', arguments: { projectRoot: root } })
    assert.notEqual(first.isError, true, text(first))
    assert.match(text(first), /TODAVIA NO GENERE NADA/)
    assert.ok(existsSync(agentPath(root, 'middleware-generator')))

    // 2) kit there: a clear message with the three questions, in one block, and nothing written
    const second = await client.callTool({ name: 'scaffold_service', arguments: { projectRoot: root } })
    assert.equal(second.isError, true)
    const message = text(second)
    assert.match(message, /faltan datos para crear la API \(prefijoApi, prefijoError, motor\)/)
    assert.match(message, /No los inventes ni uses un valor por defecto: preguntaselos al usuario, todos en un solo mensaje/)
    assert.match(message, /1\. prefijoApi: prefijo de la API en kebab-case\. Por ejemplo, midd-catalog\./)
    assert.match(message, /2\. prefijoError: prefijo de errores de la API en MAYUSCULAS\. Por ejemplo, CATALOG\./)
    assert.match(message, /3\. motor: base de datos de la API: mssql, postgres, mysql o none/)
    assert.match(message, /middleware-generator hace estas preguntas por ti/)
    assert.equal(existsSync(join(root, 'src')), false)
    assert.equal(existsSync(join(root, 'package.json')), false)
    assert.doesNotMatch(message, /-32602|Invalid arguments|Required at/, 'no schema error text')

    // 3) only what is missing is asked
    const partial = await client.callTool({ name: 'scaffold_service', arguments: { projectRoot: root, prefijoApi: 'midd-demo', motor: 'none' } })
    assert.equal(partial.isError, true)
    assert.match(text(partial), /faltan datos para crear la API \(prefijoError\)/)
    assert.doesNotMatch(text(partial), /prefijoApi: prefijo|motor: base de datos/)
    assert.equal(existsSync(join(root, 'src')), false)

    // 4) with the three answers it generates
    const full = await client.callTool({ name: 'scaffold_service', arguments: { projectRoot: root, prefijoApi: 'midd-demo', prefijoError: 'DEMO', motor: 'none' } })
    assert.notEqual(full.isError, true, text(full))
    assert.match(text(full), /Base del servicio generada/)
  } finally {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  }
})
