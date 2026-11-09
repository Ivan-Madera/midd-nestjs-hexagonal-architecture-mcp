/**
 * Descubrimiento de solo lectura del proyecto destino (para el Flujo 2 refactor).
 *
 * El refactor NO debe imponer el molde del dataset: debe descubrir las "reglas"
 * del workspace y adaptarse. Esta utilería inspecciona un proyecto NestJS
 * existente y reporta lo que el agente necesita saber ANTES de generar nada:
 *   - convención de carpetas/case de los dominios,
 *   - forma de la conexión TypeORM (forRoot vs named connections, replication),
 *   - infraestructura transversal ya presente (JSON:API response, errores,
 *     middleware), que debe REUSARSE en vez de duplicarse,
 *   - módulos NestJS existentes.
 *
 * Todo es lectura: no escribe ni modifica nada.
 */
import { join, relative, basename } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { suggestAnswers, type SuggestedAnswers } from './suggestions.js'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export type ConnectionStyle =
  | 'forRoot-default' // TypeOrmModule.forRoot(...) sin nombre: conexión por defecto
  | 'named' // forRootAsync/forRoot con name: '<X>Connection'
  | 'none' // no se detecta TypeORM
  | 'unknown'

export type ProjectInspection = {
  projectRoot: string
  isNestProject: boolean
  srcDir: string
  // Convención de carpetas de dominios/módulos de primer nivel bajo src/.
  domainFolders: Array<{ name: string; hasModule: boolean; moduleFile?: string }>
  folderCaseConvention: 'PascalCase' | 'lowercase' | 'mixed' | 'unknown'
  // Conexión TypeORM.
  connection: {
    style: ConnectionStyle
    usesReplication: boolean
    namedConnections: string[]
    rootModuleFile?: string
  }
  // Infraestructura transversal existente que se debe REUSAR.
  existingInfra: {
    jsonApiResponse?: string // archivo que exporta la clase de respuesta JSON:API
    jsonApiResponseClasses?: string[] // nombres de clase exportados (p.ej. ResponseJsonApi, ResponseJsonApiArray, DataStructure)
    errorType?: string // archivo con el tipo de error del proyecto (p.ej. TopError)
    errorTypeClasses?: string[] // nombres de clase exportados (p.ej. TopError, ErrorsStructure, Source)
    jsonApiMiddleware?: string
    configVariables?: string // ConfigurationVariables si existe
    // Carpeta raíz de la infra transversal (relativa a src/), p.ej. "common".
    // Es el valor que debe pasarse como infraRoot con infraStyle="project".
    infraRoot?: string
  }
  // Módulos NestJS detectados.
  modules: string[]
  // Si ya parece hexagonal (tiene carpetas core/infrastructure).
  looksHexagonal: boolean
  // Respuestas sugeridas a las 5 preguntas generales, leidas del proyecto, cada una con su evidencia.
  suggestedAnswers: SuggestedAnswers
  notes: string[]
}

export function inspectProject(projectRoot: string): ProjectInspection {
  const srcDir = join(projectRoot, 'src')
  const notes: string[] = []
  const pkg = read(join(projectRoot, 'package.json'))
  const isNestProject = /@nestjs\/core/.test(pkg) || existsSync(join(projectRoot, 'nest-cli.json'))

  const files = walk(srcDir)
  const rel = (p: string) => relative(projectRoot, p).replace(/\\/g, '/')

  // --- Carpetas de primer nivel bajo src/ (candidatas a dominios) ------------
  const domainFolders: ProjectInspection['domainFolders'] = []
  if (existsSync(srcDir)) {
    const INFRA_FOLDERS = ['common', 'middlewares', 'shared', 'test', 'tests', 'config', 'utils']
    for (const entry of readdirSync(srcDir)) {
      const full = join(srcDir, entry)
      if (!statSync(full).isDirectory()) continue
      if (INFRA_FOLDERS.includes(entry.toLowerCase())) continue
      const moduleFile = walk(full).find((f) => /\.module\.ts$/.test(f))
      domainFolders.push({
        name: entry,
        hasModule: !!moduleFile,
        moduleFile: moduleFile ? rel(moduleFile) : undefined
      })
    }
  }

  // Convención de case de las carpetas que tienen módulo (dominios reales).
  const domainLike = domainFolders.filter((d) => d.hasModule).map((d) => d.name)
  let folderCaseConvention: ProjectInspection['folderCaseConvention'] = 'unknown'
  if (domainLike.length) {
    const pascal = domainLike.filter((n) => /^[A-Z]/.test(n)).length
    const lower = domainLike.filter((n) => /^[a-z]/.test(n)).length
    folderCaseConvention =
      pascal && lower ? 'mixed' : pascal ? 'PascalCase' : lower ? 'lowercase' : 'unknown'
  }

  // --- Conexión TypeORM ------------------------------------------------------
  const namedConnections = new Set<string>()
  let style: ConnectionStyle = 'none'
  let usesReplication = false
  let rootModuleFile: string | undefined
  for (const f of files) {
    const c = read(f)
    if (/TypeOrmModule\.forRoot(Async)?\s*\(/.test(c)) {
      rootModuleFile = rootModuleFile ?? rel(f)
      if (/replication\s*:/.test(c)) usesReplication = true
      const names = [...c.matchAll(/name\s*:\s*'([A-Za-z0-9_]+Connection)'/g)].map((m) => m[1])
      names.forEach((n) => namedConnections.add(n.replace(/Connection$/, '')))
      style = names.length ? 'named' : 'forRoot-default'
    }
    // forFeature con conexión nombrada también revela named connections.
    for (const m of c.matchAll(/forFeature\([^)]*,\s*'([A-Za-z0-9_]+)Connection'\)/g)) {
      namedConnections.add(m[1])
      if (style !== 'named') style = 'named'
    }
  }

  // --- Infra transversal existente ------------------------------------------
  // Captura TODOS los nombres de clase exportados en un archivo (para reportar
  // los símbolos reales que el agente debe reusar, no solo el path).
  const exportedClasses = (c: string): string[] =>
    [...c.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)].map((m) => m[1])

  const existingInfra: ProjectInspection['existingInfra'] = {}
  for (const f of files) {
    const c = read(f)
    const r = rel(f)
    if (!existingInfra.jsonApiResponse && /class\s+ResponseJsonApi/.test(c)) {
      existingInfra.jsonApiResponse = r
      existingInfra.jsonApiResponseClasses = exportedClasses(c)
    }
    if (!existingInfra.errorType && /class\s+(TopError|ErrorsStructure)/.test(c)) {
      existingInfra.errorType = r
      existingInfra.errorTypeClasses = exportedClasses(c)
    }
    if (!existingInfra.jsonApiMiddleware && /Middleware/.test(c) && /jsonapi/i.test(basename(f)))
      existingInfra.jsonApiMiddleware = r
    if (!existingInfra.configVariables && /registerAs\(\s*'ConfigurationVariables'/.test(c))
      existingInfra.configVariables = r
  }

  // Deriva la carpeta raíz de infra (primer segmento bajo src/) del archivo de
  // respuesta JSON:API; es el infraRoot a pasar con infraStyle="project".
  const infraSource = existingInfra.jsonApiResponse ?? existingInfra.errorType
  if (infraSource) {
    const m = infraSource.match(/^src\/([^/]+)\//)
    if (m) existingInfra.infraRoot = m[1]
  }

  const modules = files.filter((f) => /\.module\.ts$/.test(f)).map(rel)
  const looksHexagonal = files.some((f) => /[\\/]core[\\/]/.test(f) && /[\\/]domain[\\/]/.test(f))

  if (style === 'forRoot-default')
    notes.push(
      'Conexión TypeORM por defecto (forRoot sin name). Los adapters generados NO deben inyectar una conexión nombrada: usa @InjectRepository(Entity) sin el segundo argumento de conexión.'
    )
  if (usesReplication) notes.push('La conexión usa replication master/slave. Respeta esa configuración; no la reemplaces.')
  if (existingInfra.jsonApiResponse) {
    const clases = existingInfra.jsonApiResponseClasses?.length
      ? ` (clases: ${existingInfra.jsonApiResponseClasses.join(', ')})`
      : ''
    notes.push(`Ya existe respuesta JSON:API propia (${existingInfra.jsonApiResponse})${clases}. REUSA esas clases, no generes nuevas.`)
  }
  if (existingInfra.errorType) {
    const clases = existingInfra.errorTypeClasses?.length
      ? ` (clases: ${existingInfra.errorTypeClasses.join(', ')})`
      : ''
    notes.push(`Ya existe tipo de error propio (${existingInfra.errorType})${clases}. REUSA ese catálogo/estructura.`)
  }
  if (existingInfra.infraRoot)
    notes.push(
      `Infra transversal bajo src/${existingInfra.infraRoot}/. Genera con infraStyle="project" e infraRoot="${existingInfra.infraRoot}" para que los imports apunten ahí. Aun así, concilia los NOMBRES de clase: los templates usan ResponseJsonApiBase/GenericException/CustomHttpException; sustitúyelos por las clases reales listadas arriba.`
    )
  if (folderCaseConvention === 'lowercase')
    notes.push('Convención de carpetas lowercase. Genera el slice en una carpeta con el MISMO case del proyecto para no colisionar (Windows es case-insensitive).')

  return {
    projectRoot,
    isNestProject,
    srcDir: rel(srcDir),
    domainFolders,
    folderCaseConvention,
    connection: { style, usesReplication, namedConnections: [...namedConnections], rootModuleFile },
    existingInfra,
    modules,
    looksHexagonal,
    suggestedAnswers: suggestAnswers(projectRoot),
    notes
  }
}
