import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { scaffoldService } from '../dist/tools/scaffold.js'
import { addUseCase } from '../dist/tools/addUseCase.js'
import { addAuthorization } from '../dist/tools/addAuthorization.js'

// Generates a real service with the MCP tools into a temp dir (no npm install).
async function generateService() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-e2e-'))
  await scaffoldService({
    projectRoot,
    conexion: 'Catalog', motor: 'mssql',
    prefijoServicio: 'midd-catalog',
    prefijoError: 'CATALOG',
    overwrite: true
  })
  await addUseCase({
    projectRoot,
    dominio: 'catalog',
    caso: 'RetrieveProduct',
    entidad: 'Product',
    metodo: 'retrieveBySku',
    param: 'sku',
    accion: 'retrieveProduct',
    prefijoError: 'CATALOG',
    conexion: 'Catalog', motor: 'mssql',
    adapterType: 'typeorm',
    mode: 'greenfield',
    connectionStyle: 'named',
    infraStyle: 'dataset',
    overwrite: true
  })
  return projectRoot
}

const verify = (projectRoot) => {
  const run = spawnSync('node', [join(projectRoot, 'scripts', 'verify-standards.mjs'), '--json'], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  const report = JSON.parse(run.stdout)
  return {
    status: run.status,
    rules: report.errors.map((e) => e.rule),
    warnRules: report.warnings.map((w) => w.rule),
    report
  }
}

const edit = (projectRoot, relPath, transform) => {
  const file = join(projectRoot, relPath)
  writeFileSync(file, transform(readFileSync(file, 'utf8')), 'utf8')
}

test('a freshly generated service passes verify-standards with no errors', async () => {
  const root = await generateService()
  try {
    const { status, report } = verify(root)
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
    assert.equal(status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('verify-standards report is ASCII only (Windows consoles garble UTF-8 symbols)', async () => {
  const root = await generateService()
  try {
    edit(root, 'src/main.ts', (t) => t.replace("origin: allowAnyOrigin ? '*' : security.corsAllowedOrigins", "origin: '*'"))
    const run = spawnSync('node', [join(root, 'scripts', 'verify-standards.mjs')], { cwd: root })
    const nonAscii = [...run.stdout].filter((byte) => byte > 127).length
    assert.equal(nonAscii, 0, 'the passing report must not contain non-ASCII bytes')

    edit(root, 'src/main.ts', (t) => t.replace('helmet(', 'noHelmet('))
    const failing = spawnSync('node', [join(root, 'scripts', 'verify-standards.mjs')], { cwd: root })
    assert.equal(failing.status, 1)
    assert.equal([...failing.stdout].filter((byte) => byte > 127).length, 0, 'the failing report must not contain non-ASCII bytes')
    assert.match(failing.stdout.toString(), /\[ERROR\]/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generated service ships the mandatory security and observability files', async () => {
  const root = await generateService()
  try {
    for (const file of [
      'src/shared/infrastructure/security/rateLimit.guard.ts',
      'src/shared/infrastructure/security/payloadSize.middleware.ts',
      'src/shared/infrastructure/security/cacheControl.middleware.ts',
      'src/shared/infrastructure/security/ipResolver.ts',
      'src/shared/infrastructure/security/security.module.ts',
      'src/shared/infrastructure/observability/correlation.middleware.ts'
    ]) {
      assert.ok(existsSync(join(root, file)), `missing ${file}`)
    }
    const env = readFileSync(join(root, '.env.example'), 'utf8')
    assert.match(env, /^API_CONTEXT=midd-catalog$/m)
    assert.match(env, /^RL_MAX_REQUESTS_PER_WINDOW=150$/m)
    assert.match(env, /^RL_TRUSTED_PROXIES=10\.0\.0\.0\/8,172\.16\.0\.0\/12,192\.168\.0\.0\/16$/m)
    const controller = readFileSync(
      join(root, 'src/catalog/infrastructure/http-server/controllers/retrieveProduct.controller.ts'),
      'utf8'
    )
    assert.match(controller, /@Controller\(\{ path: 'catalog', version: '1' \}\)/)
    assert.doesNotMatch(controller, /@Version\(/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Each mutation must be caught by the verifier (the agent's safety net).
const MUTATIONS = [
  {
    name: 'axios declared in package.json',
    rule: 'FORBIDDEN_DEPENDENCY',
    file: 'package.json',
    change: (t) => t.replace('"dependencies": {', '"dependencies": {\n    "axios": "^1",')
  },
  {
    name: 'uuid declared in package.json',
    rule: 'FORBIDDEN_DEPENDENCY',
    file: 'package.json',
    change: (t) => t.replace('"dependencies": {', '"dependencies": {\n    "uuid": "^9",')
  },
  {
    name: 'axios imported',
    rule: 'FORBIDDEN_DEPENDENCY',
    file: 'src/shared/utils/services/consumoHttp.ts',
    change: (t) => "import axios from 'axios'\n" + t
  },
  {
    name: 'fetch called from core',
    rule: 'HTTP_IN_CORE',
    file: 'src/catalog/core/domain/services/retrieveProduct.domain.service.ts',
    change: (t) => t + "\nconst r = fetch('https://example.com')\n"
  },
  {
    name: 'missing helmet',
    rule: 'MISSING_HTTP_SECURITY',
    file: 'src/main.ts',
    change: (t) => t.replace(/helmet\s*\(/g, 'noHelmet(')
  },
  {
    name: 'cache-control not first',
    rule: 'MISSING_CACHE_CONTROL',
    file: 'src/main.ts',
    change: (t) =>
      t.replace('app.use(cacheControlNoStore)', '').replace('app.use(correlationMiddleware)', 'app.use(correlationMiddleware)\n  app.use(cacheControlNoStore)')
  },
  {
    name: 'correlation id not registered',
    rule: 'MISSING_CORRELATION_ID',
    file: 'src/main.ts',
    change: (t) => t.replace('app.use(correlationMiddleware)', '')
  },
  {
    name: 'payload size control removed',
    rule: 'INCOMPLETE_RATE_LIMITING',
    file: 'src/main.ts',
    change: (t) => t.replace(/maxJsonPayloadBytes|createPayloadSizeMiddleware/g, 'removed')
  },
  {
    name: 'SecurityModule not imported',
    rule: 'INCOMPLETE_RATE_LIMITING',
    file: 'src/app.module.ts',
    change: (t) => t.replace(/SecurityModule/g, 'Removed')
  },
  {
    name: 'version baked into the global prefix',
    rule: 'MISSING_API_BASE_PATH',
    file: 'src/main.ts',
    change: (t) => t.replace('app.setGlobalPrefix(server.ApiContext)', "app.setGlobalPrefix('svc/api/v1')")
  },
  {
    name: 'REST verb in a controller',
    rule: 'NON_POST_ENDPOINT',
    file: 'src/catalog/infrastructure/http-server/controllers/retrieveProduct.controller.ts',
    change: (t) => t.replace("@Post('retrieveProduct')", "@Get('retrieveProduct')")
  },
  {
    name: 'controller without version',
    rule: 'MISSING_API_BASE_PATH',
    file: 'src/catalog/infrastructure/http-server/controllers/retrieveProduct.controller.ts',
    change: (t) => t.replace(", version: '1'", '')
  },
  {
    name: 'API_CONTEXT not validated',
    rule: 'MISSING_ENV_VALIDATION',
    file: 'src/shared/infrastructure/config/joiSchema.ts',
    change: (t) => t.replace(/API_CONTEXT: Joi\.string\(\)\.required\(\),/, '')
  },
  {
    name: 'console.log in the domain',
    rule: 'CONSOLE_LOG',
    file: 'src/catalog/core/domain/services/retrieveProduct.domain.service.ts',
    change: (t) => t + "\nconsole.log('debug')\n"
  },
  {
    name: 'direct process.env read',
    rule: 'ENV_DIRECT',
    file: 'src/catalog/core/domain/services/retrieveProduct.domain.service.ts',
    change: (t) => t + '\nconst x = process.env.SECRET\n'
  },
  {
    name: 'typeorm imported from core',
    rule: 'SOURCE_IMPORT_OUTSIDE_INFRA',
    file: 'src/catalog/core/domain/services/retrieveProduct.domain.service.ts',
    change: (t) => "import { Repository } from 'typeorm'\n" + t
  },
  {
    name: 'ESM-only uuid package',
    rule: 'ESM_ONLY_IMPORT',
    file: 'src/shared/utils/services/GeneratorUuidService.ts',
    change: (t) => "import { v4 } from 'uuid'\n" + t
  }
]

// --- generate_from_spec: every stored procedure of a use case must be wired ---
test('generate_from_spec wires the SP of EVERY method (config + Joi + .env.example), not just the first', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-spec-'))
  try {
    await scaffoldService({ projectRoot, conexion: 'Catalog', motor: 'mssql', prefijoServicio: 'midd-catalog', prefijoError: 'CATALOG', overwrite: true })
    const specPath = join(projectRoot, 'middleware.spec.yaml')
    writeFileSync(
      specPath,
      [
        'module: catalog',
        'entity: Product',
        'stack: nestjs',
        'error_prefix: CATALOG',
        'connection: { name: Catalog, style: named, engine: mssql }',
        'use_cases:',
        '  - name: RetrieveProduct',
        '    action: retrieveProduct',
        '    resource_type: product',
        '    adapter: sp',
        '    methods:',
        '      - { name: retrieveBySku, request: RetrieveProductRequest, response: Product, sp: GetProductBySku }',
        '      - { name: retrieveByBarcode, request: RetrieveProductByBarcodeRequest, response: Product, sp: GetProductByBarcode }',
        '      - { name: retrieveByName, request: RetrieveProductByNameRequest, response: Product, sp: SearchProductsSp }',
        'business_rules: { none: true, rules: [] }'
      ].join('\n'),
      'utf8'
    )
    const { generateFromSpec } = await import('../dist/tools/generateFromSpec.js')
    const result = await generateFromSpec({ projectRoot, specPath, mode: 'greenfield', dryRun: false, overwrite: false })
    assert.notEqual(result.isError, true, result.content[0].text)

    const config = readFileSync(join(projectRoot, 'src/shared/infrastructure/config/ConfigurationVariables.ts'), 'utf8')
    const joi = readFileSync(join(projectRoot, 'src/shared/infrastructure/config/joiSchema.ts'), 'utf8')
    const env = readFileSync(join(projectRoot, '.env.example'), 'utf8')
    const expected = [
      ['GetProductBySku', 'GET_PRODUCT_BY_SKU_SP'],
      ['GetProductByBarcode', 'GET_PRODUCT_BY_BARCODE_SP'],
      ['SearchProductsSp', 'SEARCH_PRODUCTS_SP'] // already ends in "Sp": the suffix must not be doubled
    ]
    for (const [sp, envVar] of expected) {
      assert.match(config, new RegExp(`${sp}: process\\.env\\.${envVar}\\b`), `config is missing ${sp}`)
      assert.match(joi, new RegExp(`${envVar}: Joi\\.string\\(\\)\\.required\\(\\)`), `Joi is missing ${envVar}`)
      assert.match(env, new RegExp(`^${envVar}=`, 'm'), `.env.example is missing ${envVar}`)
    }
    assert.doesNotMatch(env, /SEARCH_PRODUCTS_SP_SP/)

    // Invariant: every SP the adapter uses is declared. This is what failed to compile before.
    const adapter = readFileSync(join(projectRoot, 'src/catalog/infrastructure/adapters/retrieveProduct.sp.adapter.ts'), 'utf8')
    const used = [...adapter.matchAll(/storedProcedures\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual([...new Set(used)].sort(), ['GetProductByBarcode', 'GetProductBySku', 'SearchProductsSp'])
    for (const sp of used) assert.match(config, new RegExp(`${sp}: process\\.env\\.`))

    const { rules } = verify(projectRoot)
    assert.ok(!rules.includes('SP_NOT_DECLARED'), `verify still reports SP_NOT_DECLARED: [${rules.join(', ')}]`)

    // Re-running must not duplicate anything.
    await generateFromSpec({ projectRoot, specPath, mode: 'greenfield', dryRun: false, overwrite: true })
    const joiAgain = readFileSync(join(projectRoot, 'src/shared/infrastructure/config/joiSchema.ts'), 'utf8')
    assert.equal(joiAgain.match(/GET_PRODUCT_BY_BARCODE_SP:/g).length, 1)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

test('generated application test uses a fixture built from dtos.input (not the placeholder the rules reject)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'midd-fixture-'))
  try {
    await scaffoldService({ projectRoot, conexion: 'Catalog', motor: 'mssql', prefijoServicio: 'svc', prefijoError: 'CATALOG', overwrite: true })
    const specPath = join(projectRoot, 'middleware.spec.yaml')
    writeFileSync(
      specPath,
      [
        'module: catalog', 'entity: Product', 'stack: nestjs', 'error_prefix: CATALOG',
        'connection: { name: Catalog, style: named, engine: mssql }',
        'use_cases:',
        '  - name: RetrieveProduct',
        '    action: retrieveProduct',
        '    resource_type: product',
        '    adapter: typeorm',
        '    methods:',
        '      - { name: retrieveBySku, request: RetrieveProductRequest, response: Product }',
        'dtos:',
        '  input: { sku: string, quantity: number, active: boolean }',
        '  output: { id: number }',
        'business_rules:',
        '  none: false',
        '  rules: ["sku es obligatorio"]'
      ].join('\n'),
      'utf8'
    )
    const { generateFromSpec } = await import('../dist/tools/generateFromSpec.js')
    await generateFromSpec({ projectRoot, specPath, mode: 'greenfield', dryRun: false, overwrite: false })

    const spec = readFileSync(join(projectRoot, 'src/catalog/core/application/services/retrieveProduct.application.spec.ts'), 'utf8')
    assert.match(spec, /\{ sku: 'test-sku', quantity: 1, active: true \}/)
    assert.doesNotMatch(spec, /'valor'/)
    // the rule generated from the same spec is satisfied by that fixture
    const service = readFileSync(join(projectRoot, 'src/catalog/core/application/services/retrieveProduct.application.ts'), 'utf8')
    assert.match(service, /\.sku === undefined/)
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

// --- Authorization (opt-in) --------------------------------------------------
async function generateWithAuthorization() {
  const root = await generateService()
  await addAuthorization({
    projectRoot: root,
    authorizationApiUrl: 'https://authorization.example.com/authorization/v1',
    overwrite: false
  })
  return root
}

test('a service WITHOUT authorization is valid (it is the user\'s choice)', async () => {
  const root = await generateService()
  try {
    assert.equal(existsSync(join(root, 'src/shared/authorization')), false)
    assert.doesNotMatch(readFileSync(join(root, '.env.example'), 'utf8'), /AUTHORIZATION_API_URL/)
    assert.deepEqual(verify(root).rules, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('add_authorization wires the guard AFTER the rate limit and passes verify-standards', async () => {
  const root = await generateWithAuthorization()
  try {
    const appModule = readFileSync(join(root, 'src/app.module.ts'), 'utf8')
    assert.match(appModule, /import \{ AuthorizationModule \}/)
    assert.ok(appModule.lastIndexOf('AuthorizationModule') > appModule.lastIndexOf('SecurityModule'))
    assert.match(readFileSync(join(root, 'src/shared/infrastructure/config/joiSchema.ts'), 'utf8'), /AUTHORIZATION_API_URL: Joi\.string\(\)\.uri\(\)\.required\(\)/)
    assert.match(readFileSync(join(root, 'src/shared/infrastructure/config/ConfigurationVariables.ts'), 'utf8'), /apiUrl: process\.env\.AUTHORIZATION_API_URL/)
    assert.match(readFileSync(join(root, '.env.example'), 'utf8'), /^AUTHORIZATION_API_URL=https:\/\/authorization\.example\.com\/authorization\/v1$/m)
    const { report, status } = verify(root)
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
    assert.equal(status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('add_authorization is idempotent', async () => {
  const root = await generateWithAuthorization()
  try {
    const snapshot = () =>
      ['src/app.module.ts', 'src/shared/infrastructure/config/joiSchema.ts', 'src/shared/infrastructure/config/ConfigurationVariables.ts', '.env.example']
        .map((f) => readFileSync(join(root, f), 'utf8'))
    const before = snapshot()
    await addAuthorization({ projectRoot: root, authorizationApiUrl: 'https://x.example.com', overwrite: false })
    assert.deepEqual(snapshot(), before)
    const appModule = before[0]
    assert.equal(appModule.match(/AuthorizationModule/g).length, 2) // import + imports array
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const AUTHORIZATION_MUTATIONS = [
  {
    name: 'AuthorizationModule not registered',
    rule: 'AUTHORIZATION_NOT_REGISTERED',
    file: 'src/app.module.ts',
    change: (t) => t.replace(/AuthorizationModule/g, 'Removed')
  },
  {
    name: 'AuthorizationModule before SecurityModule',
    rule: 'AUTHORIZATION_ORDER',
    file: 'src/app.module.ts',
    change: (t) => t.replace(/,\n    AuthorizationModule\n/, '\n').replace('imports: [', 'imports: [\n    AuthorizationModule,')
  },
  {
    name: 'AuthorizationModule only mentioned in a comment',
    rule: 'AUTHORIZATION_NOT_REGISTERED',
    file: 'src/app.module.ts',
    change: (t) => t.replace(/,\n    AuthorizationModule\n/, '\n    // AuthorizationModule\n')
  },
  {
    name: 'SecurityModule only mentioned in a comment',
    rule: 'INCOMPLETE_RATE_LIMITING',
    file: 'src/app.module.ts',
    change: (t) => t.replace(/\n    SecurityModule,/, '\n    // SecurityModule,')
  },
  {
    name: 'AUTHORIZATION_API_URL not validated',
    rule: 'MISSING_ENV_VALIDATION',
    file: 'src/shared/infrastructure/config/joiSchema.ts',
    change: (t) => t.replace(/AUTHORIZATION_API_URL: Joi\.string\(\)\.uri\(\)\.required\(\),/, '')
  },
  {
    name: 'verifier fails open',
    rule: 'AUTHORIZATION_FAIL_OPEN',
    file: 'src/shared/authorization/infrastructure/MacropayApiAuthorizationVerifier.ts',
    change: (t) => t + "\nfunction broken() { try { return 1 } catch { return { allowed: true } } }\n"
  },
  {
    name: 'guard never rejects',
    rule: 'AUTHORIZATION_FAIL_OPEN',
    file: 'src/shared/authorization/authorization.guard.ts',
    change: (t) => t.replace(/throw /g, 'return ')
  }
]

for (const m of AUTHORIZATION_MUTATIONS) {
  test(`verify-standards detects: ${m.name} (${m.rule})`, async () => {
    const root = await generateWithAuthorization()
    try {
      edit(root, m.file, m.change)
      const { status, rules } = verify(root)
      assert.ok(rules.includes(m.rule), `expected ${m.rule}, got [${rules.join(', ')}]`)
      assert.equal(status, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

// A '*' HARDCODED in code (instead of read from the env var) only warns: it never blocks.
test("a hardcoded CORS '*' only warns", async () => {
  const root = await generateService()
  try {
    edit(root, 'src/main.ts', (t) =>
      t.replace("origin: allowAnyOrigin ? '*' : security.corsAllowedOrigins", "origin: '*'")
    )
    const { status, rules, warnRules } = verify(root)
    assert.deepEqual(rules, [])
    assert.equal(status, 0)
    assert.ok(warnRules.includes('CORS_WILDCARD'), `warnings: [${warnRules.join(', ')}]`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("CORS_ALLOWED_ORIGINS defaults to '*' in Joi and .env.example, with no warning and no boot log", async () => {
  const root = await generateService()
  try {
    assert.match(readFileSync(join(root, '.env.example'), 'utf8'), /^CORS_ALLOWED_ORIGINS=\*$/m)
    assert.match(
      readFileSync(join(root, 'src/shared/infrastructure/config/joiSchema.ts'), 'utf8'),
      /CORS_ALLOWED_ORIGINS: Joi\.string\(\)\.default\('\*'\)/
    )
    assert.doesNotMatch(readFileSync(join(root, 'src/main.ts'), 'utf8'), /Logger/)
    const { status, rules, warnRules } = verify(root)
    assert.deepEqual(rules, [])
    assert.deepEqual(warnRules, [])
    assert.equal(status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const m of MUTATIONS) {
  test(`verify-standards detects: ${m.name} (${m.rule})`, async () => {
    const root = await generateService()
    try {
      edit(root, m.file, m.change)
      const { status, rules } = verify(root)
      assert.ok(rules.includes(m.rule), `expected ${m.rule}, got [${rules.join(', ')}]`)
      assert.equal(status, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

// --- Health probe -------------------------------------------------------------
const HEALTH = 'src/shared/infrastructure/http-server/controllers/health.controller.ts'

test('a new service ships a health probe that follows the area policy and passes the verifier clean', async () => {
  const root = await generateService()
  try {
    const controller = readFileSync(join(root, HEALTH), 'utf8')
    assert.match(controller, /@Controller\(\{ path: 'health', version: '1' \}\)/)
    assert.match(controller, /@Post\(\)/)
    assert.doesNotMatch(controller, /@(Get|Put|Patch|Delete)\s*\(/)
    assert.match(controller, /status: 'UP'/)
    // a liveness probe checks nothing else and leaks nothing
    assert.doesNotMatch(controller, /process\.env|hostname|DataSource|Repository|from 'os'|from 'node:os'/)

    const appModule = readFileSync(join(root, 'src/app.module.ts'), 'utf8')
    assert.match(appModule, /import \{ HealthModule \}/)
    assert.ok(existsSync(join(root, 'src/shared/infrastructure/http-server/health.module.ts')))

    const { report, status } = verify(root)
    assert.deepEqual(report.errors, [], JSON.stringify(report.errors, null, 2))
    assert.deepEqual(report.warnings, [])
    assert.equal(status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('add_authorization keeps the health probe public, and does it only once', async () => {
  const root = await generateWithAuthorization()
  try {
    const controller = readFileSync(join(root, HEALTH), 'utf8')
    assert.match(controller, /import \{ SkipAuthorization \} from '\.\.\/\.\.\/\.\.\/authorization\/skip-authorization\.decorator'/)
    assert.equal(controller.match(/@SkipAuthorization\(\)/g).length, 1)
    assert.ok(controller.indexOf('@SkipAuthorization()') < controller.indexOf('@Post()'), 'the decorator sits on the handler')
    assert.equal(verify(root).report.errors.length, 0)

    const again = await addAuthorization({ projectRoot: root, authorizationApiUrl: 'https://x.example.com', overwrite: false })
    assert.notEqual(again.isError, true)
    assert.equal(readFileSync(join(root, HEALTH), 'utf8'), controller, 'a second run changes nothing')
    assert.match(again.content[0].text, /health probe: unchanged/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the verifier rejects a health probe that authorization would block (HEALTH_NOT_PUBLIC)', async () => {
  const root = await generateWithAuthorization()
  try {
    edit(root, HEALTH, (t) => t.replace(/[ \t]*@SkipAuthorization\(\)\r?\n/, ''))
    const { status, rules } = verify(root)
    assert.ok(rules.includes('HEALTH_NOT_PUBLIC'), `got [${rules.join(', ')}]`)
    assert.equal(status, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the probe needs no mark when the service has no authorization', async () => {
  const root = await generateService()
  try {
    assert.doesNotMatch(readFileSync(join(root, HEALTH), 'utf8'), /SkipAuthorization/)
    assert.ok(!verify(root).rules.includes('HEALTH_NOT_PUBLIC'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('add_authorization on a service without the probe (e.g. a refactor) does not fail or invent one', async () => {
  const root = await generateService()
  try {
    rmSync(join(root, HEALTH))
    rmSync(join(root, 'src/shared/infrastructure/http-server/health.module.ts'))
    edit(root, 'src/app.module.ts', (t) => t.replace(/^import \{ HealthModule \}.*\r?\n/m, '').replace(/\s*\/\/ Liveness probe.*\r?\n\s*HealthModule,/, ''))

    const result = await addAuthorization({ projectRoot: root, authorizationApiUrl: 'https://x.example.com', overwrite: false })
    assert.notEqual(result.isError, true, result.content[0].text)
    assert.match(result.content[0].text, /health probe: not-found/)
    assert.equal(existsSync(join(root, HEALTH)), false, 'it must not create a probe the project did not ask for')
    assert.deepEqual(verify(root).report.errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a health controller with an unexpected shape is reported as a manual step, never half-edited', async () => {
  const root = await generateService()
  try {
    const weird = "import { Controller } from '@nestjs/common'\n@Controller('health')\nexport class HealthController {}\n"
    writeFileSync(join(root, HEALTH), weird, 'utf8')
    const result = await addAuthorization({ projectRoot: root, authorizationApiUrl: 'https://x.example.com', overwrite: false })
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /unexpected shape/)
    assert.equal(readFileSync(join(root, HEALTH), 'utf8'), weird, 'the file stays untouched')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
