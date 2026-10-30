import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Error codes of an API: `<PREFIX>-<SLUG>-<NNN>`, e.g. CATALOG-PRODUCTNOTFOUND-001.
 *
 * The number runs from 001 to 999 and is a sequence PER PREFIX: every error the MCP creates for an API takes the
 * next free number, so two errors never share one. The numbers already in the code are the source of truth (the
 * MCP keeps no counter), which also holds when somebody adds an error by hand.
 */
export const ERROR_CODE_MAX = 999
export const ERROR_NUMBER_DIGITS = 3

/** 7 -> "007". */
export const formatErrorNumber = (n: number): string => String(n).padStart(ERROR_NUMBER_DIGITS, '0')

export class ErrorCodesExhausted extends Error {
  constructor(prefix: string, needed: number, last: number) {
    super(
      `Se agotaron los codigos de error del prefijo ${prefix}: el ultimo usado es ${formatErrorNumber(last)} y se necesitan ${needed} mas, pero el maximo es ${ERROR_CODE_MAX}. Usa otro prefijo.`
    )
    this.name = 'ErrorCodesExhausted'
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * Numbers already used by a prefix anywhere under src/ (comments count: a guard that is commented today is
 * uncommented tomorrow). Codes written with 4 digits by an older MCP count by their value.
 */
export function usedErrorNumbers(projectRoot: string, prefix: string): number[] {
  const used = new Set<number>()
  const pattern = new RegExp(`['"\`]${prefix}-[A-Z0-9_]+-(\\d{3,4})['"\`]`, 'g')
  for (const file of sourceFiles(join(projectRoot, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
      const n = Number(m[1])
      if (n > 0) used.add(n) // 000 is the generic fallback entry of a catalog, not a number of the sequence
    }
  }
  return [...used].sort((a, b) => a - b)
}

/** The next `count` free numbers of a prefix, in order. Throws ErrorCodesExhausted when they do not fit in 001-999. */
export function nextErrorNumbers(projectRoot: string, prefix: string, count: number): number[] {
  const last = Math.max(0, ...usedErrorNumbers(projectRoot, prefix))
  if (last + count > ERROR_CODE_MAX) throw new ErrorCodesExhausted(prefix, count, last)
  return Array.from({ length: count }, (_, i) => last + i + 1)
}
