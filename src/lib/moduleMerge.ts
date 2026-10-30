import type { AdapterType } from './adapters.js'
/**
 * Merge inteligente de los módulos de un dominio cuando se añade un caso de uso
 * adicional a un dominio YA existente.
 *
 * El `_domain-slice` modela los módulos como single-caso. Al agregar el 2º, 3º…
 * caso, en vez de regenerar u omitir esos módulos, los PARCHEAMOS para registrar
 * el nuevo caso: controller, adapter, providers, tokens y el mapeo en register().
 *
 * Todas las operaciones son idempotentes: si el caso ya está registrado, no se
 * duplica. El parcheo es textual pero conservador (inserciones ancladas a marcas
 * estables del dataset), suficiente para los módulos que este MCP genera.
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type CaseNames = {
  caso: string // PascalCase, p.ej. "RetrieveCategory"
  casoCamel: string // camelCase, p.ej. "retrieveCategory"
  casoUpper: string // UPPER_SNAKE, p.ej. "RETRIEVE_CATEGORY"
  entidad: string // PascalCase, p.ej. "Category"
  adapterClass: string // p.ej. "RetrieveCategoryAdapter"
  adapterImportPath: string // p.ej. "./adapters/retrieveCategory.typeorm.adapter"
  adapterImportPathFromRoot: string // p.ej. "./infrastructure/adapters/retrieveCategory.typeorm.adapter"
  controllerClass: string // p.ej. "RetrieveCategoryController"
  conexion: string // p.ej. "Catalog"
  adapterType: AdapterType
  connectionStyle: 'named' | 'default' // forma de la conexión TypeORM del proyecto
}

export type MergeResult = { patched: string[]; warnings: string[] }

/** Inserta una línea de import tras el último import del archivo. */
export function addImport(content: string, importLine: string): string {
  if (content.includes(importLine.trim())) return content
  const importRe = /^import .*$/gm
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = importRe.exec(content)) !== null) last = m
  if (!last) return `${importLine}\n${content}`
  const idx = last.index + last[0].length
  return content.slice(0, idx) + `\n${importLine}` + content.slice(idx)
}

/**
 * Añade un elemento a un array literal nombrado (`name: [ ... ]`). Localiza el
 * `[` que abre el array y encuentra su `]` de cierre BALANCEANDO corchetes, para
 * no confundirse con `[...]` anidados (p.ej. una llamada register(['x']) dentro
 * del array `imports`). Idempotente.
 */
export function appendToArray(content: string, arrayName: string, element: string): string {
  const open = new RegExp(`${arrayName}\\s*:\\s*\\[`)
  const mo = content.match(open)
  if (!mo || mo.index === undefined) return content
  const startBracket = mo.index + mo[0].length - 1 // posición del '['
  // Encuentra el ']' que cierra, balanceando.
  let depth = 0
  let end = -1
  for (let i = startBracket; i < content.length; i++) {
    const ch = content[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return content
  const inner = content.slice(startBracket + 1, end)
  if (new RegExp(`\\b${element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(inner)) {
    return content // ya está
  }

  // Recorre el inner por líneas y encuentra el offset (dentro de content) del
  // final del último token de CÓDIGO real (ignorando líneas de comentario y
  // vacías). El nuevo elemento se inserta justo ahí, antes de cualquier
  // comentario colgante, con la coma separadora correcta.
  const lines = inner.split('\n')
  let offset = startBracket + 1 // posición absoluta del inicio del inner
  let lastCodeEnd = -1 // offset absoluto tras el último token de código
  let lastCodeChar = '['
  for (const line of lines) {
    const codePart = line.replace(/\/\/.*$/, '') // sin comentario de línea
    const trimmedCode = codePart.replace(/\s+$/, '')
    if (trimmedCode.trim().length > 0) {
      lastCodeEnd = offset + trimmedCode.length
      lastCodeChar = trimmedCode.trim().slice(-1)
    }
    offset += line.length + 1 // +1 por el '\n'
  }

  const sep = lastCodeChar === ',' || lastCodeEnd === -1 ? '' : ','
  const insertAt = lastCodeEnd === -1 ? startBracket + 1 : lastCodeEnd
  const insertion = `${sep}\n    ${element}`
  return content.slice(0, insertAt) + insertion + content.slice(insertAt)
}

// --- http-server.module.ts --------------------------------------------------
function patchHttpServerModule(file: string, n: CaseNames): boolean {
  let content = read(file)
  if (!content) return false
  const before = content
  content = addImport(
    content,
    `import { ${n.controllerClass} } from './controllers/${n.casoCamel}.controller'`
  )
  content = appendToArray(content, 'controllers', n.controllerClass)
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

// --- infrastructure.<dom>.module.ts -----------------------------------------
function patchInfrastructureModule(file: string, n: CaseNames): boolean {
  let content = read(file)
  if (!content) return false
  const before = content

  content = addImport(
    content,
    `import { ${n.adapterClass} } from '${n.adapterImportPath}'`
  )
  if (n.adapterType === 'typeorm') {
    // The first case of the domain may not have used TypeORM (stored procedure or external API): its wiring
    // removed this import, and the forFeature below needs it.
    content = addImport(content, "import { TypeOrmModule } from '@nestjs/typeorm'")
    content = addImport(
      content,
      `import { ${n.entidad}EntityConfiguration } from './sql-database/entities/${n.entidad}.entity'`
    )
    // Añade la entidad a un forFeature existente, o crea uno nuevo en imports.
    // El argumento de conexión depende de connectionStyle: 'named' añade
    // "'<Conexion>Connection'"; 'default' lo omite (conexión por defecto del
    // forRoot). El regex matchea forFeature CON o SIN conexión nombrada, para
    // reusar el forFeature que generó el primer caso sea cual sea su estilo.
    const connArg = n.connectionStyle === 'default' ? '' : `, '${n.conexion}Connection'`
    const ffRe = /TypeOrmModule\.forFeature\(\[([^\]]*)\](\s*,\s*'[^']*Connection')?\)/
    const ff = content.match(ffRe)
    if (ff) {
      if (!new RegExp(`\\b${n.entidad}EntityConfiguration\\b`).test(ff[1])) {
        const list = ff[1].trim().replace(/\s+$/, '')
        // Preserva el argumento de conexión que ya tenía el forFeature existente
        // (ff[2]); así no mezcla estilos dentro del mismo forFeature.
        const existingConn = ff[2] ?? ''
        content = content.replace(
          ffRe,
          `TypeOrmModule.forFeature([${list}, ${n.entidad}EntityConfiguration]${existingConn})`
        )
      }
    } else {
      content = appendToArray(
        content,
        'imports',
        `TypeOrmModule.forFeature([${n.entidad}EntityConfiguration]${connArg})`
      )
    }
  }
  content = appendToArray(content, 'providers', n.adapterClass)
  content = appendToArray(content, 'exports', n.adapterClass)
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

// --- <dom>.module.ts --------------------------------------------------------
function patchRootModule(file: string, n: CaseNames): boolean {
  let content = read(file)
  if (!content) return false
  const before = content
  content = addImport(
    content,
    `import { ${n.adapterClass} } from '${n.adapterImportPathFromRoot}'`
  )
  // Añade `<caso>OutBound: <Caso>Adapter` al objeto adapters: { ... }.
  const re = /(adapters:\s*\{)([\s\S]*?)(\})/
  const m = content.match(re)
  if (m && !new RegExp(`\\b${n.casoCamel}OutBound\\b`).test(m[2])) {
    const inner = m[2].replace(/\s+$/, '')
    const sep = inner.trim().endsWith(',') || !inner.trim().length ? '' : ','
    const newInner = `${inner}${sep}\n        ${n.casoCamel}OutBound: ${n.adapterClass}\n      `
    content = content.replace(re, `$1${newInner}$3`)
  }
  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

// --- core.<dom>.module.ts ---------------------------------------------------
function patchCoreModule(file: string, n: CaseNames): boolean {
  let content = read(file)
  if (!content) return false
  const before = content

  // 1) imports de los símbolos del caso.
  content = addImport(content, `import { I${n.caso}Repository } from './domain/ports/outbound/I${n.caso}Repository'`)
  content = addImport(content, `import { I${n.caso}Service } from './domain/ports/inbound/I${n.caso}Service'`)
  content = addImport(content, `import { ${n.caso}DomainService } from './domain/services/${n.casoCamel}.domain.service'`)
  content = addImport(content, `import { ${n.caso}ApplicationService } from './application/services/${n.casoCamel}.application'`)

  const appToken = `${n.casoUpper}_APPLICATION`
  const inboundToken = `${n.casoUpper}_SERVICE_PORT_INBOUND`

  // 2) tokens export const, tras el último `export const ..._SERVICE_PORT_INBOUND`.
  if (!content.includes(`export const ${appToken} `)) {
    const tokenBlock =
      `export const ${appToken} = '${appToken}'\n` +
      `export const ${inboundToken} = '${inboundToken}'\n`
    const lastExportRe = /export const [A-Z0-9_]+ = '[A-Z0-9_]+'\n/g
    let last: RegExpExecArray | null = null
    let m: RegExpExecArray | null
    while ((m = lastExportRe.exec(content)) !== null) last = m
    if (last) {
      const idx = last.index + last[0].length
      content = content.slice(0, idx) + tokenBlock + content.slice(idx)
    }
  }

  // 3) destructurar el nuevo adapter de `adapters`.
  content = content.replace(
    /const \{([^}]*)\} = adapters/,
    (full, inside) => {
      if (new RegExp(`\\b${n.casoCamel}OutBound\\b`).test(inside)) return full
      const list = inside.trim().replace(/,\s*$/, '')
      return `const { ${list}, ${n.casoCamel}OutBound } = adapters`
    }
  )

  // 4) providers del caso, insertados antes del `return {`.
  if (!content.includes(`${n.casoCamel}ServiceProvider`)) {
    const providersBlock =
      `\n    const ${n.casoCamel}ServiceProvider = {\n` +
      `      provide: ${inboundToken},\n` +
      `      useFactory(repository: I${n.caso}Repository) {\n` +
      `        return new ${n.caso}DomainService(repository)\n` +
      `      },\n` +
      `      inject: [${n.casoCamel}OutBound]\n` +
      `    }\n\n` +
      `    const ${n.casoCamel}ApplicationProvider = {\n` +
      `      provide: ${appToken},\n` +
      `      useFactory(service: I${n.caso}Service) {\n` +
      `        return new ${n.caso}ApplicationService(service)\n` +
      `      },\n` +
      `      inject: [${inboundToken}]\n` +
      `    }\n`
    const retIdx = content.indexOf('return {')
    if (retIdx !== -1) {
      // Inserta antes de la indentación de la línea del return.
      const lineStart = content.lastIndexOf('\n', retIdx)
      content = content.slice(0, lineStart) + providersBlock + content.slice(lineStart)
    }
  }

  // 5) añadir providers al array y el token al exports.
  content = appendToArray(content, 'providers', `${n.casoCamel}ServiceProvider`)
  content = appendToArray(content, 'providers', `${n.casoCamel}ApplicationProvider`)
  content = appendToArray(content, 'exports', appToken)

  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

/**
 * Registra el módulo raíz de un dominio en src/app.module.ts: añade el import y
 * lo mete al array `imports` del @Module. Idempotente. Devuelve true si cambió.
 */
export function registerDomainInAppModule(opts: {
  projectRoot: string
  dominio: string
}): boolean {
  const { projectRoot, dominio } = opts
  const file = join(projectRoot, 'src', 'app.module.ts')
  let content = read(file)
  if (!content) return false
  const before = content
  // Clase en PascalCase, carpeta/archivo en lowercase (consistente con destRoot
  // y buildPlaceholderMap). No depende del case con que llegue `dominio`.
  const dominioPascal = dominio.charAt(0).toUpperCase() + dominio.slice(1)
  const domLower = dominio.toLowerCase()
  const moduleClass = `${dominioPascal}Module`
  const importPath = `./${domLower}/${domLower}.module`

  // Ya registrado: nada que hacer.
  if (new RegExp(`imports:\\s*\\[[\\s\\S]*?\\b${moduleClass}\\b`).test(content)) return false

  content = addImport(content, `import { ${moduleClass} } from '${importPath}'`)
  content = appendToArray(content, 'imports', moduleClass)

  if (content === before) return false
  writeFileSync(file, content, 'utf8')
  return true
}

/**
 * Registra un caso de uso adicional en los módulos de un dominio existente.
 * Devuelve los archivos parcheados. Idempotente.
 */
export function mergeCaseIntoDomain(opts: {
  projectRoot: string
  dominio: string
  names: CaseNames
}): MergeResult {
  const { projectRoot, dominio, names } = opts
  const domRoot = join(projectRoot, 'src', dominio)
  const domLower = dominio.toLowerCase()
  const patched: string[] = []
  const warnings: string[] = []

  const targets: Array<[string, (f: string, n: CaseNames) => boolean]> = [
    [join(domRoot, `infrastructure/http-server/http-server.module.ts`), patchHttpServerModule],
    [join(domRoot, `infrastructure/infrastructure.${domLower}.module.ts`), patchInfrastructureModule],
    [join(domRoot, `${domLower}.module.ts`), patchRootModule],
    [join(domRoot, `core/${domLower}.core.module.ts`), patchCoreModule]
  ]

  for (const [file, fn] of targets) {
    if (!existsSync(file)) {
      warnings.push(`No se encontró para merge: ${file}`)
      continue
    }
    try {
      if (fn(file, names)) patched.push(file)
    } catch (e: any) {
      warnings.push(`Fallo parcheando ${file}: ${e?.message}`)
    }
  }

  return { patched, warnings }
}
