/**
 * Wiring of the http adapter (external API consumed with the native fetch).
 *
 * Besides the adapter file, a use case with adapterType="http" needs the service to be coherent with no manual edit:
 *   1. The domain modules import the `.http.adapter`, not the TypeORM one, and drop the entity's forFeature.
 *   2. The base URL of the API is declared in ConfigurationVariables.externalApis, in the Joi schema (it fails fast
 *      at boot when missing) and in .env.example, in its own section.
 *   3. The domain error catalog has the entry the adapter throws when the API cannot be reached or answers an error.
 * It is idempotent: a second use case against the same API changes nothing in the configuration.
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { envVarApiBaseUrl } from './adapters.js'
import { formatErrorNumber, nextErrorNumbers } from './errorCodes.js'
import { ENV_SECTIONS, addEnvEntries } from './envFile.js'
import { patchDomainModules, patchJoiSchema } from './spWiring.js'

const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type HttpWiringResult = { patched: string[]; warnings: string[] }

/** Declares `<Api>: { baseUrl: process.env.<NAME>_BASE_URL }` in the externalApis group of ConfigurationVariables. */
function patchConfigurationVariables(projectRoot: string, api: string, envVar: string): 'patched' | 'unchanged' | 'no-file' | 'no-anchor' {
  const file = join(projectRoot, 'src/shared/infrastructure/config/ConfigurationVariables.ts')
  let content = read(file)
  if (!content) return 'no-file'
  // Code only: the example in a comment must not count as a declaration (it did, once).
  const code = content.replace(/^[ \t]*\/\/.*$/gm, '')
  if (new RegExp(`\\b${api}\\s*:\\s*\\{\\s*baseUrl`).test(code)) return 'unchanged'
  if (!/externalApis\s*:\s*\{/.test(content)) {
    // A service generated before this group existed: add the group next to the stored procedures.
    if (!/storedProcedures\s*:\s*\{/.test(content)) return 'no-anchor'
    content = content.replace(/^([ \t]*)storedProcedures\s*:\s*\{/m, (_m, indent: string) => `${indent}externalApis: {\n${indent}},\n${indent}storedProcedures: {`)
  }
  content = content.replace(/externalApis\s*:\s*\{/, (m) => `${m}\n      ${api}: { baseUrl: process.env.${envVar} },`)
  writeFileSync(file, content, 'utf8')
  return 'patched'
}

/** The entry the adapter throws when the external API cannot be reached or answers an error. */
function ensureExternalApiError(projectRoot: string, dominio: string, errorPrefix: string): 'patched' | 'unchanged' | 'no-file' {
  const domLower = dominio.toLowerCase()
  const file = join(projectRoot, 'src', domLower, 'core', 'domain', 'errors', `${domLower}.domain.error.ts`)
  const content = read(file)
  if (!content) return 'no-file'
  if (/\bEXTERNAL_API_ERROR\b/.test(content)) return 'unchanged'
  const [number] = nextErrorNumbers(projectRoot, errorPrefix, 1)
  const entry = [
    '  EXTERNAL_API_ERROR: {',
    "    message: 'The external API did not answer correctly.',",
    `    code: '${errorPrefix}-EXTERNALAPI-${formatErrorNumber(number)}',`,
    "    title: 'External API error',",
    '    status: 502,',
    "    suggestedActions: 'Try again later. If it persists, contact the team that owns the external API.'",
    '  },',
    ''
  ].join('\n')
  const marker = /^[ \t]*default\s*:\s*\{/m
  const next = marker.test(content)
    ? content.replace(marker, (m) => `${entry}${m}`)
    : content.replace(/\n\}\s*$/, `\n${entry.replace(/,\n$/, '\n')}}\n`)
  if (next === content) return 'no-file'
  writeFileSync(file, next, 'utf8')
  return 'patched'
}

export function wireExternalApi(opts: {
  projectRoot: string
  dominio: string
  casoCamel: string
  api: string
  errorPrefix: string
  entidad?: string
  /** Rewrite the domain modules to the http adapter. Only for the first case of a domain: a later one is merged. */
  patchModules: boolean
}): HttpWiringResult {
  const { projectRoot, dominio, casoCamel, api, errorPrefix, entidad } = opts
  const patched: string[] = []
  const warnings: string[] = []
  const envVar = envVarApiBaseUrl(api)

  if (opts.patchModules) patched.push(...patchDomainModules({ projectRoot, dominio, caso: casoCamel, entidad, adapter: 'http' }))

  const config = patchConfigurationVariables(projectRoot, api, envVar)
  if (config === 'patched') patched.push('src/shared/infrastructure/config/ConfigurationVariables.ts')
  else if (config !== 'unchanged') warnings.push(`No se pudo declarar ${envVar} en ConfigurationVariables.externalApis (${config}): declarala a mano (config + joiSchema + .env.example).`)

  if (patchJoiSchema({ projectRoot, envVarSp: envVar, rule: 'Joi.string().uri().required()' })) patched.push('src/shared/infrastructure/config/joiSchema.ts')

  const envFile = join(projectRoot, '.env.example')
  const envContent = read(envFile)
  if (envContent) {
    const next = addEnvEntries(envContent, ENV_SECTIONS.externalApis, [[envVar, 'https://api.example.com']])
    if (next !== envContent) {
      writeFileSync(envFile, next, 'utf8')
      patched.push('.env.example')
    }
  }

  const catalog = ensureExternalApiError(projectRoot, dominio, errorPrefix)
  if (catalog === 'patched') patched.push(`src/${dominio.toLowerCase()}/core/domain/errors/${dominio.toLowerCase()}.domain.error.ts`)
  else if (catalog === 'no-file') warnings.push(`No encontre el catalogo de errores del dominio ${dominio}: agrega la entrada EXTERNAL_API_ERROR a mano.`)
  return { patched, warnings }
}
