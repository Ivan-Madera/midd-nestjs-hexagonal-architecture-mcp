/**
 * Materialización de reglas de negocio en el application service.
 *
 * Canon (midd-pf-enrollment): una regla de negocio es una GUARDA `if` que, al no
 * cumplirse, lanza GenericException con un error del catálogo (code/title/status/
 * suggestedActions). El MCP NUNCA inventa reglas: las toma del spec y trata de
 * materializar la CONDICIÓN real cuando el texto de la regla sigue un patrón
 * reconocible (obligatorio, unicidad, enum/valores, igualdad/branching, rango).
 *
 * SIEMPRE estampa una NOTA (para agentes y usuarios) advirtiendo que la condición
 * generada es una APROXIMACIÓN derivada del texto y debe revisarse/completarse
 * contra el requerimiento real. Cuando no puede inferir la condición, genera el
 * andamiaje de la guarda igualmente, con la NOTA.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatErrorNumber, nextErrorNumbers } from './errorCodes.js'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type RulesResult = { patched: string[]; warnings: string[]; generated: number; inferred: number }

export type GeneratedGuard = {
  rule: string
  code: string // slug del código de error sugerido (no el code completo)
  inferred: boolean // true si se dedujo una condición concreta
  snippet: string // el bloque de guarda a insertar (indentado)
}

const NOTA_AGENTE =
  '// NOTA (agente/usuario): condición de regla de negocio GENERADA como aproximación\n' +
  '  // a partir del texto del spec. REVÍSALA y ajústala al requerimiento real antes de\n' +
  '  // dar el caso por terminado. El MCP no inventa reglas: solo materializa andamiaje.'

/** Normaliza para detección de patrones (minúsculas, sin acentos). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Deriva un SLUG de código de error en MAYÚSCULAS desde el texto de la regla. */
function slugFromRule(rule: string, i: number): string {
  const words = norm(rule)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join('')
    .toUpperCase()
  const base = words || 'BUSINESSRULE'
  return `${base}_${String(i + 1).padStart(3, '0')}`
}

/** Intenta extraer el nombre de un campo mencionado en la regla (heurístico). */
function fieldFromRule(rule: string): string | null {
  // Palabra que precede a verbos típicos: "<campo> debe/must/es/is ..."
  const m =
    rule.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:debe|debera|tiene que|must|should|is|es|sea)\b/i) ||
    rule.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:unico|unica|unique|requerid|oblig)/i)
  return m ? m[1] : null
}

/** Extrae los valores de un enum/lista: "uno de: a | b | c" o "a, b, c". */
function enumValues(rule: string): string[] {
  const after = rule.split(/:|->|=>/).slice(1).join(':')
  const src = after || rule
  const parts = src
    .split(/\||,|\bo\b|\bor\b/i)
    .map((p) => p.trim().replace(/^["'`]|["'`]$/g, ''))
    .filter((p) => p && /^[a-zA-Z0-9_\- ]+$/.test(p) && p.length <= 40)
  return parts.length >= 2 ? parts : []
}

/** Genera una guarda a partir del texto de una regla. */
export function buildGuard(rule: string, index: number, errorPrefix: string, number: number = index + 1): GeneratedGuard {
  const n = norm(rule)
  const slug = slugFromRule(rule, index)
  const code = `${errorPrefix}-${slug.replace(/_\d+$/, '')}-${formatErrorNumber(number)}`
  const field = fieldFromRule(rule)
  const errObj = (status: number, title: string) =>
    `{ code: '${code}', title: '${title}', status: ${status}, suggestedActions: 'Revisa el valor enviado.' }`

  // Patrón: ENUM / valores permitidos
  const vals = /uno de|one of|valores|debe ser (?:uno|alguno)|in \[|pertenece/.test(n)
    ? enumValues(rule)
    : []
  if (field && vals.length >= 2) {
    const arr = vals.map((v) => `'${v}'`).join(', ')
    // Acceso vía (attributes as any): el campo puede no estar declarado en el
    // request si no venía en dtos.input. La NOTA pide revisarlo.
    return {
      rule,
      code: slug,
      inferred: true,
      snippet:
        `const ${field}Permitidos = [${arr}]\n` +
        `    if (!${field}Permitidos.includes((attributes as any).${field})) {\n` +
        `      throw new GenericException(\n` +
        `        \`Valor de ${field} no permitido: \${(attributes as any).${field}}.\`,\n` +
        `        ${errObj(400, `Valor de ${field} no permitido.`)}\n` +
        `      )\n` +
        `    }`
    }
  }

  // Patrón: UNICIDAD. Requiere una consulta previa (método del puerto) que puede
  // no existir aún; se genera COMENTADA para que el dev enlace el método real.
  if (/unic|unique|ya (?:existe|registrad)|duplicad|409/.test(n)) {
    const f = field ?? 'valor'
    return {
      rule,
      code: slug,
      inferred: true,
      snippet:
        `// Unicidad de ${f}: añade un método al puerto que consulte por ${f} y descomenta.\n` +
        `    // const ${f}Existente = await this.servicio.buscarPor${cap(f)}(attributes.${f} as any)\n` +
        `    // if (${f}Existente) {\n` +
        `    //   throw new GenericException(\n` +
        `    //     \`${cap(f)} ya registrado: \${attributes.${f}}.\`,\n` +
        `    //     ${errObj(409, `${cap(f)} ya registrado.`)}\n` +
        `    //   )\n` +
        `    // }`
    }
  }

  // Patrón: OBLIGATORIO / requerido / not null
  if (/requerid|oblig|not null|no (?:puede|debe) (?:ser|estar) (?:null|vacio|vacia)|is required/.test(n)) {
    const f = field ?? 'valor'
    return {
      rule,
      code: slug,
      inferred: true,
      snippet:
        `if ((attributes as any).${f} === undefined || (attributes as any).${f} === null || (attributes as any).${f} === '') {\n` +
        `      throw new GenericException(\n` +
        `        \`El campo ${f} es requerido.\`,\n` +
        `        ${errObj(400, `El campo ${f} es requerido.`)}\n` +
        `      )\n` +
        `    }`
    }
  }

  // Patrón: EXISTENCIA / 404 (no se encuentra). Esta guarda debe ejecutarse
  // DESPUÉS de obtener el resultado de la consulta, no al inicio del método; por
  // eso se genera COMENTADA (para moverla tras `const result = ...`).
  if (/(?:no )?(?:existe|encuentr|found)|404/.test(n)) {
    const f = field ?? 'recurso'
    return {
      rule,
      code: slug,
      inferred: true,
      snippet:
        `// Existencia de ${f}: MUEVE esta guarda tras obtener el resultado de la consulta.\n` +
        `    // if (!result) {\n` +
        `    //   throw new GenericException(\n` +
        `    //     \`No se encontró ${f} para los parámetros enviados.\`,\n` +
        `    //     ${errObj(404, `${cap(f)} no encontrado.`)}\n` +
        `    //   )\n` +
        `    // }`
    }
  }

  // Patrón: IGUALDAD / branching ("si X == Y ...")
  if (/\bsi\b|\bif\b|==|igual a|cuando/.test(n) && field) {
    return {
      rule,
      code: slug,
      inferred: true,
      snippet:
        `// Branching por ${field}: bifurca el comportamiento según su valor.\n` +
        `    if (attributes.${field} === /* TODO: valor esperado */ undefined) {\n` +
        `      // TODO: comportamiento de esta variante\n` +
        `    }`
    }
  }

  // Sin patrón reconocible: andamiaje genérico (no inferido).
  return {
    rule,
    code: slug,
    inferred: false,
    snippet:
      `// TODO: implementa la condición de esta regla.\n` +
      `    // if (/* condición de: ${rule} */ false) {\n` +
      `    //   throw new GenericException(\n` +
      `    //     '${escapeStr(rule)}',\n` +
      `    //     ${errObj(400, 'Regla de negocio no cumplida.')}\n` +
      `    //   )\n` +
      `    // }`
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function escapeStr(s: string): string {
  return s.replace(/'/g, "\\'")
}

/**
 * Inserta el bloque de guardas de reglas de negocio en el método del caso de uso
 * del application service, justo al inicio del cuerpo (tras la línea Logger.*).
 * Idempotente: si ya existe el marcador de reglas, no reescribe.
 */
export function applyBusinessRules(opts: {
  projectRoot: string
  dominio: string
  caso: string
  errorPrefix: string
  rules: string[]
}): RulesResult {
  const { projectRoot, dominio, caso, errorPrefix, rules } = opts
  const patched: string[] = []
  const warnings: string[] = []
  let inferred = 0

  if (rules.length === 0) return { patched, warnings, generated: 0, inferred: 0 }

  const casoCamel = caso.charAt(0).toLowerCase() + caso.slice(1)
  const file = join(
    projectRoot,
    'src',
    dominio.toLowerCase(),
    'core/application/services',
    `${casoCamel}.application.ts`
  )
  let content = read(file)
  if (!content) {
    warnings.push(`No se encontró el application service para aplicar reglas: ${file}`)
    return { patched, warnings, generated: 0, inferred: 0 }
  }

  const MARKER = '// ── Reglas de negocio (generadas desde el spec) ──'
  if (content.includes(MARKER)) {
    return { patched, warnings, generated: 0, inferred: 0 } // ya aplicadas
  }

  // Each guard takes the next free number of the prefix, so it never repeats a code of another case.
  const numbers = nextErrorNumbers(projectRoot, errorPrefix, rules.length)
  const guards = rules.map((r, i) => buildGuard(r, i, errorPrefix, numbers[i]))
  inferred = guards.filter((g) => g.inferred).length

  const block =
    `\n    ${MARKER}\n` +
    `    ${NOTA_AGENTE}\n` +
    guards
      .map(
        (g) =>
          `    // Regla: ${g.rule}\n` +
          `    // (condición ${g.inferred ? 'inferida' : 'NO inferida — completa manualmente'})\n` +
          `    ${g.snippet}\n`
      )
      .join('\n')

  // Inserta tras la primera línea `Logger.*(...)` del cuerpo del método; si no
  // la hay, tras la primera `{` del método async del caso.
  const loggerRe = /Logger\.[a-zA-Z]+\([^\n]*\)\n/
  const lm = content.match(loggerRe)
  if (lm && lm.index !== undefined) {
    const idx = lm.index + lm[0].length
    content = content.slice(0, idx) + block + content.slice(idx)
  } else {
    const methodRe = new RegExp(`async\\s+${casoCamel}\\s*\\([^)]*\\)\\s*:[^{]*\\{`)
    const mm = content.match(methodRe)
    if (!mm || mm.index === undefined) {
      warnings.push('No se encontró el punto de inserción de reglas en el application service.')
      return { patched, warnings, generated: 0, inferred: 0 }
    }
    const idx = mm.index + mm[0].length
    content = content.slice(0, idx) + block + content.slice(idx)
  }

  writeFileSync(file, content, 'utf8')
  patched.push(file)
  return { patched, warnings, generated: guards.length, inferred }
}
