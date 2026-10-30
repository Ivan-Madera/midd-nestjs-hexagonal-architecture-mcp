import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { materializeTree } from '../lib/dataset.js'
import { addImport, appendToArray } from '../lib/moduleMerge.js'
import { learnDecision } from '../lib/learnings.js'
import { ENV_SECTIONS, addEnvEntries } from '../lib/envFile.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// add_authorization: OPT-IN edge authorization (agnostic verifier port + global guard).
// The agent ASKS the user whether to enable it. Created ONCE per service.
// ---------------------------------------------------------------------------
export const addAuthorizationSchema = {
  projectRoot: s.projectRoot,
  authorizationApiUrl: z
    .string()
    .default('https://authorization.example.com/authorization/v1')
    .describe(
      'Sample base URL of the authorization API for .env.example. Use a placeholder: the real value goes in the untracked .env.'
    ),
  overwrite: s.overwrite
}

/** Removes block and line comments, so a mention in documentation is never mistaken for code. */
const withoutComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const write = (path: string, content: string): void => writeFileSync(path, content, 'utf8')

const CONFIG_BLOCK = `    authorization: {
      // Base URL of the authorization API. No safe default: set it per environment.
      apiUrl: process.env.AUTHORIZATION_API_URL
    },
`
const JOI_LINE = `  // Authorization (opt-in). No safe default: set it per environment.
  AUTHORIZATION_API_URL: Joi.string().uri().required(),

`

function patchConfigurationVariables(file: string): 'patched' | 'unchanged' | 'anchor-missing' {
  const content = read(file)
  if (!content) return 'anchor-missing'
  if (/\bauthorization\s*:/.test(content)) return 'unchanged'
  if (!/^\s*storedProcedures\s*:/m.test(content)) return 'anchor-missing'
  write(file, content.replace(/^(\s*)storedProcedures\s*:/m, `${CONFIG_BLOCK}$1storedProcedures:`))
  return 'patched'
}

function patchJoiSchema(file: string): 'patched' | 'unchanged' | 'anchor-missing' {
  const content = read(file)
  if (!content) return 'anchor-missing'
  if (/AUTHORIZATION_API_URL\s*:/.test(content)) return 'unchanged'
  const anchor = /^\s*\/\/ Add here the rest of the service variables.*$/m
  if (anchor.test(content)) {
    write(file, content.replace(anchor, (m) => `${JOI_LINE}${m}`))
    return 'patched'
  }
  const closing = content.lastIndexOf('})')
  if (closing === -1) return 'anchor-missing'
  write(file, `${content.slice(0, closing)}\n${JOI_LINE}${content.slice(closing)}`)
  return 'patched'
}

function patchEnvExample(file: string, apiUrl: string): 'patched' | 'unchanged' {
  const content = read(file)
  if (/^AUTHORIZATION_API_URL=/m.test(content)) return 'unchanged'
  write(file, addEnvEntries(content, ENV_SECTIONS.authorization, [['AUTHORIZATION_API_URL', apiUrl]]))
  return 'patched'
}

const HEALTH_CONTROLLER = ['src', 'shared', 'infrastructure', 'http-server', 'controllers', 'health.controller.ts']

/**
 * The health probe must stay reachable without a token, or it stops proving that the service started.
 * A service without the probe (a refactor, or an older scaffold) is fine: there is nothing to protect.
 */
function patchHealthController(projectRoot: string): 'patched' | 'unchanged' | 'not-found' | 'anchor-missing' {
  const file = join(projectRoot, ...HEALTH_CONTROLLER)
  const content = read(file)
  if (!content) return 'not-found'
  const code = withoutComments(content)
  if (/@SkipAuthorization\s*\(/.test(code)) return 'unchanged'
  if (!/^[ \t]*@Post\(\)[ \t]*$/m.test(code)) return 'anchor-missing'
  const withImport = addImport(
    content,
    "import { SkipAuthorization } from '../../../authorization/skip-authorization.decorator'"
  )
  write(file, withImport.replace(/^([ \t]*)@Post\(\)[ \t]*$/m, '$1@SkipAuthorization()\n$1@Post()'))
  return 'patched'
}

function patchAppModule(file: string): 'patched' | 'unchanged' | 'no-security-module' | 'missing' {
  const content = read(file)
  if (!content) return 'missing'
  if (!/\bSecurityModule\b/.test(content)) return 'no-security-module'
  if (/\bAuthorizationModule\b/.test(content)) return 'unchanged'
  // Appended to `imports`, which always lands AFTER SecurityModule: the rate limit
  // guard is registered first, so floods are dropped before calling the authorizer.
  const withImport = addImport(
    content,
    "import { AuthorizationModule } from './shared/authorization/authorization.module'"
  )
  write(file, appendToArray(withImport, 'imports', 'AuthorizationModule'))
  return 'patched'
}

export async function addAuthorization(args: {
  projectRoot: string
  authorizationApiUrl: string
  overwrite: boolean
}) {
  const { projectRoot } = args
  const files = materializeTree({
    subdir: 'authorization',
    destRoot: join(projectRoot, 'src', 'shared', 'authorization'),
    map: {},
    overwrite: args.overwrite
  })

  const sharedConfig = join(projectRoot, 'src', 'shared', 'infrastructure', 'config')
  const results = {
    ConfigurationVariables: patchConfigurationVariables(join(sharedConfig, 'ConfigurationVariables.ts')),
    joiSchema: patchJoiSchema(join(sharedConfig, 'joiSchema.ts')),
    '.env.example': patchEnvExample(join(projectRoot, '.env.example'), args.authorizationApiUrl),
    'app.module': patchAppModule(join(projectRoot, 'src', 'app.module.ts')),
    'health probe': patchHealthController(projectRoot)
  }

  const manual: string[] = []
  if (results.ConfigurationVariables === 'anchor-missing')
    manual.push('Add to ConfigurationVariables: authorization: { apiUrl: process.env.AUTHORIZATION_API_URL }')
  if (results.joiSchema === 'anchor-missing')
    manual.push('Add to the Joi schema: AUTHORIZATION_API_URL: Joi.string().uri().required()')
  if (results['app.module'] !== 'patched' && results['app.module'] !== 'unchanged')
    manual.push(
      "Import AuthorizationModule in AppModule AFTER SecurityModule (the rate limit guard must run first). " +
        (results['app.module'] === 'no-security-module'
          ? 'SecurityModule was not found in app.module.ts: add it first, it is mandatory.'
          : 'src/app.module.ts was not found.')
    )

  if (results['health probe'] === 'anchor-missing')
    manual.push('The health controller has an unexpected shape: mark its handler with @SkipAuthorization() so the probe stays public.')

  const text = [
    `Authorization added in ${projectRoot} (src/shared/authorization).`,
    '',
    `Written (${files.written.length}):`,
    ...files.written.map((f) => `  + src/shared/authorization/${f}`),
    files.skipped.length ? `\nSkipped, already existed (${files.skipped.length}):` : '',
    ...files.skipped.map((f) => `  = src/shared/authorization/${f}`),
    '',
    'Patches:',
    ...Object.entries(results).map(([name, result]) => `  ${name}: ${result}`),
    manual.length ? '\nMANUAL STEPS REQUIRED:' : '',
    ...manual.map((m) => `  ! ${m}`),
    '',
    'Behavior: every endpoint is protected by default (Bearer token checked against the authorization API).',
    'Mark a genuinely public endpoint with @SkipAuthorization(). It is FAIL-CLOSED: denied or unreachable = 403.',
    'AGENT: ask the user for the real AUTHORIZATION_API_URL and write it yourself in the untracked .env.'
  ]
    .filter((line) => line !== '')
    .join('\n')

  // Only when it is really wired: with manual steps pending, authorization is not active yet.
  if (manual.length === 0) learnDecision(projectRoot, 'authorization', 'enabled')

  return { content: [{ type: 'text' as const, text }], isError: manual.length > 0 }
}
