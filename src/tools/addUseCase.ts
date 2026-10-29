import { join } from 'node:path'
import { materializeTree } from '../lib/dataset.js'
import { buildPlaceholderMap } from '../lib/placeholders.js'
import { wireStoredProcedure } from '../lib/spWiring.js'
import {
  mergeCaseIntoDomain,
  registerDomainInAppModule,
  type CaseNames
} from '../lib/moduleMerge.js'
import { learnConventions } from '../lib/learnings.js'
import { refreshApiDocs } from '../lib/apiDocs.js'
import { ensureConnection, listConnections } from '../lib/connections.js'
import { PROFILES, type Motor } from '../lib/engines.js'
import * as s from '../lib/schemas.js'

export const addUseCaseSchema = {
  projectRoot: s.projectRoot,
  dominio: s.dominio,
  caso: s.caso,
  entidad: s.entidad,
  metodo: s.metodo,
  param: s.param,
  request: s.request,
  accion: s.accion,
  prefijoError: s.prefijoError,
  conexion: s.conexion,
  motor: s.motorOpcional,
  adapterType: s.adapterType,
  nombreSp: s.nombreSp,
  envVarSp: s.envVarSp,
  mode: s.mode,
  connectionStyle: s.connectionStyle,
  infraStyle: s.infraStyle,
  infraRoot: s.infraRoot,
  overwrite: s.overwrite
}

export async function addUseCase(args: {
  projectRoot: string
  dominio: string
  caso: string
  entidad: string
  metodo: string
  param: string
  request?: string
  accion: string
  prefijoError: string
  conexion: string
  motor?: Motor
  adapterType: 'typeorm' | 'sp'
  nombreSp?: string
  envVarSp?: string
  mode: 'greenfield' | 'refactor'
  connectionStyle: 'named' | 'default'
  infraStyle: 'dataset' | 'project'
  infraRoot?: string
  overwrite: boolean
}) {
  // Guardarraíl: SP es opt-in explícito y requiere nombre.
  if (args.adapterType === 'sp' && !args.nombreSp) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: adapterType="sp" requiere el parámetro "nombreSp" (el stored procedure es opt-in y debe nombrarse). Especifica el nombre del SP o usa adapterType="typeorm".'
        }
      ],
      isError: true
    }
  }

  // A NEW named connection is created complete (module, options, config, Joi, .env.example, AppModule, driver).
  // Nothing is assumed about its engine: the user is asked. Not in refactor: the project owns its connections.
  const connectionNotes: string[] = []
  if (args.mode === 'greenfield' && args.connectionStyle === 'named') {
    const existing = listConnections(args.projectRoot).find((c) => c.name === args.conexion)
    const fail = (text: string) => ({ content: [{ type: 'text' as const, text: `ERROR: ${text}` }], isError: true })
    if (!existing && !args.motor) {
      return fail(`la conexión "${args.conexion}" no existe todavía y falta el motor (mssql | postgres | mysql). Pregúntaselo al usuario; no se asume.`)
    }
    if (existing?.motor && args.motor && existing.motor !== args.motor) {
      return fail(`la conexión "${args.conexion}" ya existe con el motor ${existing.motor} y pediste ${args.motor}. No se cambia el motor de una conexión existente: usa otro nombre de conexión o corrige el motor.`)
    }
    if (!existing && args.motor) {
      const connection = ensureConnection({ projectRoot: args.projectRoot, conexion: args.conexion, motor: args.motor })
      connectionNotes.push(
        `Conexión nueva "${args.conexion}" (${PROFILES[args.motor].label}) creada completa: ${[...connection.written, ...connection.patched].join(', ')}. Rellena sus variables DB_* en el .env.`
      )
      connectionNotes.push(...connection.warnings.map((w) => `AVISO: ${w}`))
    }
  }

  const map = buildPlaceholderMap({
    dominio: args.dominio,
    caso: args.caso,
    entidad: args.entidad,
    metodo: args.metodo,
    param: args.param,
    request: args.request,
    accion: args.accion,
    prefijoError: args.prefijoError,
    rutaDominio: args.dominio.toLowerCase(),
    tipoRecurso: args.entidad.toLowerCase(),
    conexion: args.conexion,
    nombreSp: args.nombreSp,
    envVarSp: args.envVarSp,
    connectionStyle: args.connectionStyle,
    infraStyle: args.infraStyle,
    infraRoot: args.infraRoot
  })

  // El dominio se escribe en src/<dominio-lowercase>/ (convención de carpetas
  // del área, y evita el choque de case con las CLASES PascalCase en FS
  // case-insensitive). Las clases usan el PascalCase que deriva buildPlaceholderMap.
  const destRoot = join(args.projectRoot, 'src', args.dominio.toLowerCase())

  // Excluir el adapter que NO corresponde al adapterType elegido.
  const adapterToExclude =
    args.adapterType === 'typeorm' ? '.sp.adapter' : '.typeorm.adapter'

  const result = materializeTree({
    subdir: '_domain-slice',
    destRoot,
    map,
    overwrite: args.overwrite,
    exclude: [adapterToExclude]
  })

  // Si el dominio YA existía, los módulos del dominio se omitieron (single-caso
  // en el dataset). Mergeamos este caso en esos módulos para registrarlo.
  // Aplica en greenfield Y en refactor: en ambos, cuando los módulos del dominio
  // ya existen (los generó un add_use_case previo del MISMO dominio), el 2º/3er
  // caso debe quedar registrado en ellos automáticamente. La diferencia de modo
  // la marca app.module: en refactor NO se toca app.module (ver más abajo), pero
  // los módulos del propio dominio sí se mergean para no dejar el cableado a mano.
  const domLower = args.dominio.toLowerCase()
  const domainModuleRel = `${domLower}.module.ts`
  const dominioYaExistia = result.skipped.some((f) => f.endsWith(domainModuleRel))
  const mergeNotas: string[] = []
  if (dominioYaExistia) {
    const casoCamel = map['__caso__']
    const casoUpper = map['__CASO__']
    const adapterClass = `${args.caso}Adapter`
    const adapterFile =
      args.adapterType === 'sp' ? `${casoCamel}.sp.adapter` : `${casoCamel}.typeorm.adapter`
    const names: CaseNames = {
      caso: args.caso,
      casoCamel,
      casoUpper,
      entidad: args.entidad,
      adapterClass,
      adapterImportPath: `./adapters/${adapterFile}`,
      adapterImportPathFromRoot: `./infrastructure/adapters/${adapterFile}`,
      controllerClass: `${args.caso}Controller`,
      conexion: args.conexion,
      adapterType: args.adapterType,
      connectionStyle: args.connectionStyle
    }
    const merge = mergeCaseIntoDomain({ projectRoot: args.projectRoot, dominio: args.dominio, names })
    mergeNotas.push(
      `Dominio "${args.dominio}" ya existía: caso "${args.caso}" registrado en los módulos del dominio (merge).`
    )
    for (const f of merge.patched) mergeNotas.push(`Actualizado: ${f}`)
    for (const w of merge.warnings) mergeNotas.push(`AVISO: ${w}`)
  }

  // Si se eligió typeorm, el adapter queda como <caso>.typeorm.adapter.ts; si sp,
  // como <caso>.sp.adapter.ts. Para SP, el MCP cablea automáticamente los módulos
  // (import al .sp.adapter, sin forFeature) y registra el SP en config/joi/.env.
  const notas: string[] = []
  if (args.adapterType === 'sp') {
    const casoCamel = map['__caso__']
    const nombreSp = map['__NombreSp__']
    const envVarSp = map['__ENV_VAR_SP__']
    const wiring = wireStoredProcedure({
      projectRoot: args.projectRoot,
      dominio: args.dominio,
      casoCamel,
      nombreSp,
      envVarSp,
      entidad: args.entidad,
      patchModules: !dominioYaExistia
    })
    notas.push(
      `SP opt-in cableado automáticamente: "${nombreSp}" (env: ${envVarSp}) registrado en ConfigurationVariables, joiSchema y .env.example; módulos apuntando al .sp.adapter.`
    )
    for (const f of wiring.patched) notas.push(`Ajustado: ${f}`)
    for (const w of wiring.warnings) notas.push(`AVISO: ${w}`)
    notas.push('Rellena el valor real del SP en el .env del servicio.')
  }
  // Registra el dominio en app.module.ts (idempotente). SOLO greenfield: en
  // refactor, el app.module del proyecto es ajeno y lo ajusta el agente.
  if (args.mode === 'greenfield') {
    const appModuleChanged = registerDomainInAppModule({
      projectRoot: args.projectRoot,
      dominio: args.dominio
    })
    if (appModuleChanged) {
      mergeNotas.push(`Dominio "${args.dominio}" registrado automáticamente en src/app.module.ts.`)
    }
  }

  if (args.mode === 'refactor') {
    mergeNotas.push(
      dominioYaExistia
        ? 'MODO REFACTOR: el MCP generó el slice y REGISTRÓ este caso en los módulos del propio dominio (merge). NO tocó app.module.'
        : 'MODO REFACTOR: el MCP generó el slice hexagonal con los módulos del dominio (single-caso). NO tocó app.module del proyecto.'
    )
    mergeNotas.push(
      'Adapta a mano: mueve la lógica real del service existente al domain/application service y al adapter; reusa la infra JSON:API/errores del proyecto (no la del dataset); registra el dominio en app.module respetando su convención; borra los archivos del dataset que dupliquen infra existente (p.ej. shared/errores).'
    )
    mergeNotas.push(
      `Conexión: ${args.connectionStyle === 'default' ? 'por defecto (adapter sin conexión nombrada)' : `nombrada '${args.conexion}Connection'`}.`
    )
  }

  notas.unshift(...connectionNotes, ...mergeNotas)
  // The contract and the sequence diagram follow the code: regenerate them for this module every time.
  // Postman / ARCHITECTURE.md are refreshed only when they already exist (the user opted in).
  const docs = refreshApiDocs(args.projectRoot, args.dominio)
  if (docs && docs.written.length) notas.push(`Documentacion de la API actualizada desde el codigo (${docs.written.length} archivo(s)): ${docs.written.join(', ')}.`)
  notas.push('Corre `npm run build` + `npm test` + `npm run verify`.')

  // Remembered for the next session of this repo. Only naming facts: the adapter kind (typeorm/sp) is
  // deliberately NOT learned, because a stored procedure is opt-in and must always be asked.
  learnConventions(args.projectRoot, {
    errorPrefix: args.prefijoError,
    connection: { name: args.conexion, style: args.connectionStyle }
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Caso de uso "${args.caso}" generado en src/${args.dominio.toLowerCase()}/ (adapter: ${args.adapterType}).`,
          '',
          `Archivos escritos (${result.written.length}):`,
          ...result.written.map((f) => `  + ${f}`),
          result.skipped.length
            ? `\nOmitidos por ya existir (usa overwrite=true para pisar) (${result.skipped.length}):`
            : '',
          ...result.skipped.map((f) => `  = ${f}`),
          '',
          'Siguientes pasos:',
          ...notas.map((n) => `  - ${n}`)
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
  }
}
