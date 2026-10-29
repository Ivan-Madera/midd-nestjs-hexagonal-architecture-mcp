/**
 * `.env.example` generation derived from the dataset joiSchema.
 *
 * The joiSchema is the source of truth of the service environment variables.
 * Here we extract its keys (and `.default(...)` values) and produce a synced
 * `.env.example`, which is what `verify_standards` expects (WARN when a schema
 * key is missing).
 */

/** Extracts the `KEY: Joi.` keys from a joiSchema text. */
export function extractJoiKeys(joiSchemaText: string): string[] {
  const keys = [...joiSchemaText.matchAll(/([A-Z0-9_]+)\s*:\s*Joi\./g)].map((m) => m[1])
  // Dedupe preserving order of appearance.
  return [...new Set(keys)]
}

/**
 * Extracts `.default(value)` per key. Only simple literals (number / quoted
 * string) are supported, which is all the canonical schema uses.
 */
export function extractJoiDefaults(joiSchemaText: string): Record<string, string> {
  const defaults: Record<string, string> = {}
  const pattern = /([A-Z0-9_]+)\s*:\s*Joi\.[^\n]*?\.default\(\s*(?:'([^']*)'|"([^"]*)"|([\w.-]+))\s*\)/g
  for (const m of joiSchemaText.matchAll(pattern)) {
    defaults[m[1]] = m[2] ?? m[3] ?? m[4]
  }
  return defaults
}

/** Sample value for a key, by key name. */
function sampleValue(key: string): string {
  if (key === 'PORT') return '3000'
  if (key === 'API_CONTEXT') return 'my-service'
  if (/HOST|SERVER/.test(key)) return 'localhost'
  if (/PASSWORD/.test(key)) return 'changeme'
  if (/USERNAME|USER/.test(key)) return 'sa'
  if (/DATABASE_NAME|DB_NAME/.test(key)) return 'MyDatabase'
  if (/_SP$/.test(key)) return 'sp_Procedure_Name'
  return ''
}

/**
 * Builds the `.env.example` content from the joiSchema and, optionally, from
 * extra keys (e.g. SPs registered later). A `.default(...)` in the schema wins
 * over the name-based sample value.
 */
export function buildEnvExample(
  joiSchemaText: string,
  extraKeys: string[] = [],
  overrides: Record<string, string> = {}
): string {
  const keys = [...extractJoiKeys(joiSchemaText)]
  for (const k of extraKeys) if (!keys.includes(k)) keys.push(k)
  const defaults = extractJoiDefaults(joiSchemaText)
  const lines = [
    '# .env.example — generated from joiSchema (source of truth of the variables).',
    '# Copy to .env and fill in the real values. Keep in sync with joiSchema.ts.',
    '# Never commit real secrets: only placeholders belong in this file.',
    '',
    ...keys.map((k) => `${k}=${overrides[k] ?? defaults[k] ?? sampleValue(k)}`)
  ]
  return lines.join('\n') + '\n'
}
