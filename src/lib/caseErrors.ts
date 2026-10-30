import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatErrorNumber, nextErrorNumbers } from './errorCodes.js'

/**
 * Error catalog entries of a use case.
 *
 * The FIRST case of a domain gets its entries from the domain slice (the catalog files are created with it). A later
 * case of the same domain finds those files already there, so its entries are added here. Without them the case
 * would point to a key its catalog does not have and the service would not compile. Each entry takes the next free
 * number of the prefix.
 */
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type CaseErrorsResult = { patched: string[]; warnings: string[] }

function addEntry(file: string, key: string, entry: string[]): 'added' | 'present' | 'no-file' {
  const content = read(file)
  if (!content) return 'no-file'
  if (new RegExp(`['"]${key}['"]\\s*:`).test(content.replace(/^[ \t]*\/\/.*$/gm, ''))) return 'present'
  const marker = /^[ \t]*default\s*:\s*\{/m
  const text = entry.join('\n') + '\n'
  if (!marker.test(content)) return 'no-file'
  writeFileSync(file, content.replace(marker, (m) => `${text}${m}`), 'utf8')
  return 'added'
}

export function ensureCaseErrors(opts: {
  projectRoot: string
  dominio: string
  prefix: string
  errorKey: string
  slug: string
}): CaseErrorsResult {
  const { projectRoot, dominio, prefix, errorKey, slug } = opts
  const domLower = dominio.toLowerCase()
  const patched: string[] = []
  const warnings: string[] = []
  const targets: Array<{ rel: string; build: (code: string) => string[] }> = [
    {
      rel: `src/${domLower}/core/application/errors/${domLower}.application.error.ts`,
      build: (code) => [
        `  '${errorKey}': {`,
        `    code: '${code}',`,
        "    title: 'Título legible del error de aplicación.',",
        '    status: 400,',
        "    suggestedActions: 'Acción sugerida para el consumidor del API.'",
        '  },'
      ]
    },
    {
      rel: `src/${domLower}/core/domain/errors/${domLower}.domain.error.ts`,
      build: (code) => [
        `  '${errorKey}': {`,
        "    message: 'Mensaje técnico con {placeholders} si aplica.',",
        `    code: '${code}',`,
        "    title: 'Título legible del error.',",
        '    status: 404,',
        "    suggestedActions: 'Acción sugerida para el consumidor del API.'",
        '  },'
      ]
    }
  ]
  for (const t of targets) {
    const file = join(projectRoot, t.rel)
    const content = read(file)
    if (!content) {
      warnings.push(`No encontre el catalogo de errores ${t.rel}: agrega la entrada ${errorKey} a mano.`)
      continue
    }
    // Look first (no number is taken for an entry that already exists).
    if (new RegExp(`['"]${errorKey}['"]\\s*:`).test(content.replace(/^[ \t]*\/\/.*$/gm, ''))) continue
    const [number] = nextErrorNumbers(projectRoot, prefix, 1)
    const code = `${prefix}-${slug}-${formatErrorNumber(number)}`
    const result = addEntry(file, errorKey, t.build(code))
    if (result === 'added') patched.push(t.rel)
    else if (result === 'no-file') warnings.push(`No pude agregar ${errorKey} a ${t.rel}: agregala a mano.`)
  }
  return { patched, warnings }
}
