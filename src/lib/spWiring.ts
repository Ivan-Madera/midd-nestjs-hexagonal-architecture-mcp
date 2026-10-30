/**
 * Wiring automático para el modo Stored Procedure (SP opt-in, decisión de diseño A).
 *
 * Cuando un caso de uso se genera con adapterType="sp", además de materializar el
 * `.sp.adapter`, hay que dejar el servicio coherente SIN edición manual:
 *   1. Los módulos del dominio deben importar el `.sp.adapter` (no el `.typeorm`).
 *   2. El `forFeature` de la entidad sobra (el SP no usa repositorio TypeORM).
 *   3. El SP debe quedar declarado en ConfigurationVariables.storedProcedures,
 *      en el joiSchema y en el .env.example (lo exige verify_standards).
 */
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ENV_SECTIONS, addEnvEntries } from './envFile.js'

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

export type SpWiringResult = {
  patched: string[]
  warnings: string[]
}

/**
 * Reescribe los módulos del dominio para apuntar al `.sp.adapter` y elimina el
 * registro TypeOrmModule.forFeature de la entidad (el SP no inyecta repositorio).
 */
/**
 * Quita UNA sola entidad de un `forFeature([...], 'XConnection')` preservando el
 * resto. Si tras quitarla el array queda vacío, elimina el forFeature completo
 * (con su coma colgante). Si el array conserva otras entidades, deja el
 * forFeature intacto con las demás. Idempotente y quirúrgico: NUNCA borra
 * entidades de otros casos.
 */
function removeEntityFromForFeature(content: string, entityConfig: string): string {
  const ffRe = /TypeOrmModule\.forFeature\(\[([^\]]*)\]\s*(,\s*'[^']*Connection')?\)/g
  return content.replace(ffRe, (full, list: string, conn: string | undefined) => {
    const items = list
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    if (!items.includes(entityConfig)) return full // esta entidad no está aquí: no tocar
    const rest = items.filter((x) => x !== entityConfig)
    if (rest.length === 0) {
      // Marca para borrar el forFeature entero (y su coma) en un segundo paso.
      return '__FORFEATURE_EMPTY__'
    }
    return `TypeOrmModule.forFeature([${rest.join(', ')}]${conn ?? ''})`
  })
}

export function patchDomainModules(opts: {
  projectRoot: string
  dominio: string
  caso: string // camelCase del caso (nombre de archivo del adapter)
  entidad?: string // PascalCase; para quitar SOLO su entidad del forFeature
  adapter?: 'sp' | 'http' // a que adapter apuntan los modulos (sp por defecto)
}): string[] {
  const { projectRoot, dominio, caso, entidad } = opts
  const adapter = opts.adapter ?? 'sp'
  const patched: string[] = []
  const domLower = dominio.toLowerCase()
  const domRoot = join(projectRoot, 'src', domLower)

  const files = [
    join(domRoot, `${domLower}.module.ts`),
    join(domRoot, `infrastructure/infrastructure.${domLower}.module.ts`)
  ]

  for (const file of files) {
    let content = read(file)
    if (!content) continue
    const before = content

    // 1) import del adapter: .typeorm.adapter -> .sp.adapter (solo el de ESTE caso).
    content = content
      .split(`/adapters/${caso}.typeorm.adapter`)
      .join(`/adapters/${caso}.${adapter}.adapter`)

    // 2) quitar del forFeature SOLO la entidad de este caso SP, preservando las
    //    de otros casos TypeORM del mismo módulo. Si el forFeature se queda
    //    vacío, se elimina completo (con su coma colgante).
    const entityConfig = entidad ? `${entidad}EntityConfiguration` : undefined
    if (entityConfig && new RegExp(`\\b${entityConfig}\\b`).test(content)) {
      content = removeEntityFromForFeature(content, entityConfig)
      // Borra los forFeature marcados como vacíos, comiéndose la coma/línea.
      content = content
        .replace(/,\s*\n\s*__FORFEATURE_EMPTY__/g, '')
        .replace(/\n\s*__FORFEATURE_EMPTY__\s*,?/g, '')
        .replace(/__FORFEATURE_EMPTY__\s*,?/g, '')

      // 3) quitar el import de la entidad de ESTE caso si ya no se usa.
      const entityImportRe = new RegExp(
        `import \\{ ${entityConfig} \\} from '[^']*'\\n`
      )
      const withoutImport = content.replace(entityImportRe, '')
      const stillUsed = new RegExp(`\\b${entityConfig}\\b`).test(withoutImport)
      if (!stillUsed) content = withoutImport

      // 4) quitar el import de TypeOrmModule SOLO si ya no queda ningún forFeature.
      if (!/TypeOrmModule\.forFeature/.test(content)) {
        const tomRe = /import \{ TypeOrmModule \} from '@nestjs\/typeorm'\n/
        const withoutTom = content.replace(tomRe, '')
        if (!/\bTypeOrmModule\b/.test(withoutTom)) content = withoutTom
      }
    }

    if (content !== before) {
      writeFileSync(file, content, 'utf8')
      patched.push(file)
    }
  }
  return patched
}

/** Inserta la clave del SP en el bloque storedProcedures de ConfigurationVariables.ts. */
function patchConfigurationVariables(opts: {
  projectRoot: string
  nombreSp: string
  envVarSp: string
}): string | null {
  const { projectRoot, nombreSp, envVarSp } = opts
  const file = join(
    projectRoot,
    'src/shared/infrastructure/config/ConfigurationVariables.ts'
  )
  let content = read(file)
  if (!content) return null
  if (new RegExp(`\\b${nombreSp}\\s*:`).test(content)) return null // ya declarado

  // Inserta dentro del objeto storedProcedures: { ... }
  const entry = `      ${nombreSp}: process.env.${envVarSp}`
  const re = /storedProcedures:\s*\{/
  if (!re.test(content)) return null
  content = content.replace(re, (m) => `${m}\n${entry},`)
  writeFileSync(file, content, 'utf8')
  return file
}

/** Añade la clave del SP al joiSchema.ts como string requerido. */
export function patchJoiSchema(opts: { projectRoot: string; envVarSp: string; rule?: string }): string | null {
  const { projectRoot, envVarSp } = opts
  const rule = opts.rule ?? 'Joi.string().required()'
  const file = join(projectRoot, 'src/shared/infrastructure/config/joiSchema.ts')
  let content = read(file)
  if (!content) return null
  if (new RegExp(`\\b${envVarSp}\\s*:`).test(content)) return null

  // Localiza la ÚLTIMA propiedad Joi existente (`X: Joi.<...>(...)`) e inserta la
  // nueva clave justo después, garantizando la coma de la propiedad previa. Más
  // robusto que insertar antes de `})` (que rompe si la última propiedad no
  // tenía coma colgante).
  const propRe = /^[ \t]*([A-Z0-9_]+)\s*:\s*Joi\.[^\n]*$/gm
  let lastMatch: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = propRe.exec(content)) !== null) lastMatch = m
  if (!lastMatch) return null

  const lineStart = lastMatch.index
  const lineEnd = lineStart + lastMatch[0].length
  const line = lastMatch[0]
  // Asegura coma al final de la última propiedad.
  const fixedLine = /,\s*$/.test(line) ? line : `${line.replace(/\s*$/, '')},`
  const insertion = `\n  ${envVarSp}: ${rule},`
  content = content.slice(0, lineStart) + fixedLine + insertion + content.slice(lineEnd)
  writeFileSync(file, content, 'utf8')
  return file
}

/** Añade la clave del SP al .env.example (y a .env si existe). */
function patchEnvFiles(opts: { projectRoot: string; envVarSp: string }): string[] {
  const { projectRoot, envVarSp } = opts
  const touched: string[] = []
  for (const name of ['.env.example', '.env']) {
    const file = join(projectRoot, name)
    const content = read(file)
    if (!content) continue
    if (new RegExp(`^${envVarSp}=`, 'm').test(content)) continue
    if (name === '.env.example') {
      writeFileSync(file, addEnvEntries(content, ENV_SECTIONS.storedProcedures, [[envVarSp, 'sp_Nombre_Del_Procedure']]), 'utf8')
    } else {
      const suffix = content.endsWith('\n') ? '' : '\n'
      writeFileSync(file, `${content}${suffix}${envVarSp}=sp_Nombre_Del_Procedure\n`, 'utf8')
    }
    touched.push(file)
  }
  return touched
}

/**
 * Orquesta todo el wiring SP. Idempotente: no duplica registros si ya existen.
 */
export function wireStoredProcedure(opts: {
  projectRoot: string
  dominio: string
  casoCamel: string
  nombreSp: string
  envVarSp: string
  entidad?: string // PascalCase; para quitar SOLO su entidad del forFeature
  // Solo reescribe los módulos del dominio al .sp.adapter cuando este caso es el
  // PRIMERO del dominio (módulos recién generados single-caso). En un dominio ya
  // existente, el merge ya insertó el adapter SP correctamente; tocar los módulos
  // aquí no es necesario. Además, el parcheo es QUIRÚRGICO: solo quita del
  // forFeature la entidad de ESTE caso, preservando las de otros casos TypeORM.
  patchModules: boolean
}): SpWiringResult {
  const patched: string[] = []
  const warnings: string[] = []

  if (opts.patchModules) {
    patched.push(...patchDomainModules({
      projectRoot: opts.projectRoot,
      dominio: opts.dominio,
      caso: opts.casoCamel,
      entidad: opts.entidad
    }))
  }

  const cfg = patchConfigurationVariables({
    projectRoot: opts.projectRoot,
    nombreSp: opts.nombreSp,
    envVarSp: opts.envVarSp
  })
  if (cfg) patched.push(cfg)
  else warnings.push('No se pudo registrar el SP en ConfigurationVariables (¿ya existe o falta el archivo?).')

  const joi = patchJoiSchema({ projectRoot: opts.projectRoot, envVarSp: opts.envVarSp })
  if (joi) patched.push(joi)
  else warnings.push('No se pudo añadir la clave al joiSchema (¿ya existe o falta el archivo?).')

  patched.push(...patchEnvFiles({ projectRoot: opts.projectRoot, envVarSp: opts.envVarSp }))

  return { patched, warnings }
}
