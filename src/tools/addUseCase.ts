import { join } from 'node:path'
import { domainFolder, toKebab } from '../lib/names.js'
import { legacyDomainLayout } from '../lib/projectFiles.js'
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
import { chooseProjectConnection, ensureConnection, listConnections } from '../lib/connections.js'
import { isApiPath, isHttpVerb, usesDatabase, type AdapterType } from '../lib/adapters.js'
import { wireExternalApi } from '../lib/httpWiring.js'
import { nextErrorNumbers } from '../lib/errorCodes.js'
import { ensureCaseErrors } from '../lib/caseErrors.js'
import { PROFILES, SIN_BASE_DE_DATOS, type MotorChoice } from '../lib/engines.js'
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
  tipoRecurso: s.tipoRecurso,
  prefijoError: s.prefijoError,
  conexion: s.conexion,
  motor: s.motorOpcional,
  crearConexion: s.crearConexion,
  adapterType: s.adapterType,
  apiExterna: s.apiExterna,
  rutaApi: s.rutaApi,
  metodoHttp: s.metodoHttp,
  nombreSp: s.nombreSp,
  envVarSp: s.envVarSp,
  mode: s.mode,
  connectionStyle: s.connectionStyle,
  infraStyle: s.infraStyle,
  infraRoot: s.infraRoot,
  overwrite: s.overwrite
}

export async function addUseCase(input: {
  projectRoot: string
  dominio: string
  caso: string
  entidad: string
  metodo: string
  param: string
  request?: string
  accion: string
  tipoRecurso?: string
  prefijoError: string
  conexion?: string
  motor?: MotorChoice
  crearConexion?: boolean
  adapterType: AdapterType
  apiExterna?: string
  rutaApi?: string
  metodoHttp?: string
  nombreSp?: string
  envVarSp?: string
  mode: 'greenfield' | 'refactor'
  connectionStyle: 'named' | 'default'
  infraStyle: 'dataset' | 'project'
  infraRoot?: string
  overwrite: boolean
}) {
  const args = { ...input, conexion: input.conexion ?? '' }
  // A domain written before the kebab-case standard has other file names: mixing both layouts in one domain breaks it.
  const legacy = legacyDomainLayout(args.projectRoot, domainFolder(args.dominio))
  if (legacy) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: el dominio "${args.dominio}" ya existe con la estructura anterior (src/${domainFolder(args.dominio)}/${legacy}). Mezclar la estructura nueva (archivos kebab-case: <dominio>.infrastructure.module.ts, <caso>.inbound.port.ts...) con la anterior rompe sus modulos. Renombra el dominio existente a la convencion kebab-case, o agrega el caso a mano; no se genera nada.`
        }
      ],
      isError: true
    }
  }
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

  // An external API needs its name and the path to call; the verb defaults to GET.
  if (args.adapterType === 'http') {
    const problems: string[] = []
    if (!args.apiExterna) problems.push('falta apiExterna (nombre PascalCase de la API externa, p.ej. "ExchangeRates")')
    if (!isApiPath(args.rutaApi)) problems.push('rutaApi es obligatoria y empieza con "/" (p.ej. "/rates"; sin espacios ni query string)')
    if (args.metodoHttp && !isHttpVerb(args.metodoHttp)) problems.push('metodoHttp debe ser GET, POST o PUT')
    if (problems.length) {
      return { content: [{ type: 'text' as const, text: `ERROR: adapterType="http": ${problems.join('; ')}.` }], isError: true }
    }
  }
  // Only the TypeORM and stored procedure adapters read a database, so only they need a connection.
  const needsConnection = usesDatabase(args.adapterType)
  // "none" = the service has no database: no connection exists, so the TypeORM and stored procedure adapters
  // have nothing to work on. (In a refactor the engine only matters to create a connection the user asked for.)
  const engine = args.motor === SIN_BASE_DE_DATOS ? undefined : args.motor
  if (needsConnection && args.motor === SIN_BASE_DE_DATOS && args.mode === 'greenfield' && args.connectionStyle === 'named') {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: el servicio se definio SIN base de datos (motor none): no hay conexion y los adapters TypeORM y SP la necesitan. Para consumir una API externa usa adapterType=http (no necesita conexion). Si ahora el servicio SI usa una base de datos, pregunta el motor (mssql | postgres | mysql) y vuelve a llamar con el.'
        }
      ],
      isError: true
    }
  }
  // Greenfield: the connection is named after its engine unless the caller names it (an extra connection).
  // Refactor: the project's own connection is found and reused. It is created ONLY when the user explicitly asked for
  // one (the caller then passes both the name and the engine); otherwise a project without a connection is an error.
  const choice = !needsConnection ? { name: 'Default', exists: true } : chooseProjectConnection({
    projectRoot: args.projectRoot,
    mode: args.mode,
    style: args.connectionStyle,
    conexion: input.conexion,
    motor: engine,
    crear: args.crearConexion
  })
  if ('error' in choice) {
    return { content: [{ type: 'text' as const, text: `ERROR: ${choice.error}` }], isError: true }
  }
  args.conexion = choice.name
  // The area does not use stored procedures on PostgreSQL. The engine is the one of the connection (or the one being created).
  if (args.adapterType === 'sp') {
    const connectionEngine = listConnections(args.projectRoot).find((c) => c.name === args.conexion)?.motor ?? engine
    if (connectionEngine === 'postgres') {
      return { content: [{ type: 'text' as const, text: 'ERROR: el area no usa stored procedures en PostgreSQL: usa adapterType="typeorm" para esa conexion (los stored procedures siguen disponibles en SQL Server y MySQL).' }], isError: true }
    }
  }
  // A NEW named connection is created complete (module, options, config, Joi, .env.example, AppModule, driver).
  // Nothing is assumed about its engine: the user is asked.
  const connectionNotes: string[] = []
  if (needsConnection && args.connectionStyle === 'named' && (args.mode === 'greenfield' || !choice.exists)) {
    const existing = listConnections(args.projectRoot).find((c) => c.name === args.conexion)
    const fail = (text: string) => ({ content: [{ type: 'text' as const, text: `ERROR: ${text}` }], isError: true })
    if (!existing && !engine) {
      return fail(`la conexión "${args.conexion}" no existe todavía y falta el motor (mssql | postgres | mysql). Pregúntaselo al usuario; no se asume.`)
    }
    if (existing?.motor && engine && existing.motor !== engine) {
      return fail(`la conexión "${args.conexion}" ya existe con el motor ${existing.motor} y pediste ${engine}. No se cambia el motor de una conexión existente: usa otro nombre de conexión o corrige el motor.`)
    }
    if (!existing && engine) {
      const connection = ensureConnection({ projectRoot: args.projectRoot, conexion: args.conexion, motor: engine })
      connectionNotes.push(
        `Conexión nueva "${args.conexion}" (${PROFILES[engine].label}) creada completa: ${[...connection.written, ...connection.patched].join(', ')}. AGENTE: pide al usuario los valores de sus variables DB_* y escríbelos tú en el .env (sin repetir la contraseña).`
      )
      if (args.mode === 'refactor') {
        connectionNotes.push('REFACTOR: la conexión se creó porque el usuario la pidió expresamente. Revisa app.module.ts del proyecto: el MCP intenta registrarla, pero ese archivo es del proyecto.')
      }
      connectionNotes.push(...connection.warnings.map((w) => `AVISO: ${w}`))
    }
  }
  // The two errors of the case (application and domain catalog) take the next free numbers of the prefix.
  let errorNumbers: number[]
  try {
    errorNumbers = nextErrorNumbers(args.projectRoot, args.prefijoError, 2)
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: `ERROR: ${err.message}` }], isError: true }
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
    errorNumApp: errorNumbers[0],
    errorNumDom: errorNumbers[1],
    rutaDominio: domainFolder(args.dominio),
    tipoRecurso: args.tipoRecurso ?? toKebab(args.entidad),
    conexion: args.conexion,
    nombreSp: args.nombreSp,
    envVarSp: args.envVarSp,
    apiExterna: args.apiExterna,
    rutaApi: args.rutaApi,
    metodoHttp: args.metodoHttp,
    connectionStyle: needsConnection ? args.connectionStyle : 'default',
    infraStyle: args.infraStyle,
    infraRoot: args.infraRoot
  })

  // El dominio se escribe en src/<dominio-kebab>/ (convención de carpetas
  // del área, y evita el choque de case con las CLASES PascalCase en FS
  // case-insensitive). Las clases usan el PascalCase que deriva buildPlaceholderMap.
  const destRoot = join(args.projectRoot, 'src', domainFolder(args.dominio))

  // Excluir el adapter que NO corresponde al adapterType elegido.
  const adaptersToExclude =
    args.adapterType === 'typeorm'
      ? ['.sp.adapter', '.http.adapter']
      : args.adapterType === 'sp'
        ? ['.typeorm.adapter', '.http.adapter']
        : ['.typeorm.adapter', '.sp.adapter', 'sql-database'] // an external API has no TypeORM entity

  const result = materializeTree({
    subdir: '_domain-slice',
    destRoot,
    map,
    overwrite: args.overwrite,
    exclude: adaptersToExclude
  })

  // Si el dominio YA existía, los módulos del dominio se omitieron (single-caso
  // en el dataset). Mergeamos este caso en esos módulos para registrarlo.
  // Aplica en greenfield Y en refactor: en ambos, cuando los módulos del dominio
  // ya existen (los generó un add_use_case previo del MISMO dominio), el 2º/3er
  // caso debe quedar registrado en ellos automáticamente. La diferencia de modo
  // la marca app.module: en refactor NO se toca app.module (ver más abajo), pero
  // los módulos del propio dominio sí se mergean para no dejar el cableado a mano.
  const domLower = domainFolder(args.dominio)
  const domainModuleRel = `${domLower}.module.ts`
  const dominioYaExistia = result.skipped.some((f) => f.endsWith(domainModuleRel))
  const mergeNotas: string[] = []
  if (dominioYaExistia) {
    const casoCamel = map['__caso__']
    const casoUpper = map['__CASO__']
    const adapterClass = `${args.caso}Adapter`
    const casoKebab = map['__casoKebab__']
    const adapterFile = `${casoKebab}.${args.adapterType}.adapter`
    const names: CaseNames = {
      caso: args.caso,
      casoCamel,
      casoKebab,
      casoUpper,
      entidad: args.entidad,
      entidadKebab: map['__entidadKebab__'],
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
    // The catalogs of the domain already exist (the first case made them): this case adds its own entries,
    // each with the next free number of the prefix. Without them its key would not exist and it would not compile.
    try {
      const errors = ensureCaseErrors({
        projectRoot: args.projectRoot,
        dominio: args.dominio,
        prefix: args.prefijoError,
        errorKey: map['__ERROR_KEY__'],
        slug: map['<SLUG>'],
        entidad: args.entidad
      })
      for (const f of errors.patched) mergeNotas.push(`Errores del caso agregados a ${f}`)
      for (const w of errors.warnings) mergeNotas.push(`AVISO: ${w}`)
    } catch (err: any) {
      mergeNotas.push(`AVISO: ${err.message}`)
    }
  }

  // Si se eligió typeorm, el adapter queda como <caso>.typeorm.adapter.ts; si sp,
  // como <caso>.sp.adapter.ts. Para SP, el MCP cablea automáticamente los módulos
  // (import al .sp.adapter, sin forFeature) y registra el SP en config/joi/.env.
  const notas: string[] = []
  if (args.adapterType === 'sp') {
    const nombreSp = map['__NombreSp__']
    const envVarSp = map['__ENV_VAR_SP__']
    const wiring = wireStoredProcedure({
      projectRoot: args.projectRoot,
      dominio: args.dominio,
      casoKebab: map['__casoKebab__'],
      nombreSp,
      envVarSp,
      entidad: args.entidad,
      patchModules: !dominioYaExistia
    })
    notas.push(
      `SP opt-in cableado automáticamente: "${nombreSp}" (env: ${envVarSp}) registrado en la configuracion (configuration-variables), el Joi schema y .env.example; módulos apuntando al .sp.adapter.`
    )
    for (const f of wiring.patched) notas.push(`Ajustado: ${f}`)
    for (const w of wiring.warnings) notas.push(`AVISO: ${w}`)
    notas.push('AGENTE: pide al usuario el nombre real del SP y escríbelo tú en el .env.')
  }
  // An external API: the domain modules point to the http adapter and its base URL is declared (config, Joi, .env.example).
  if (args.adapterType === 'http' && args.apiExterna) {
    const wiring = wireExternalApi({
      projectRoot: args.projectRoot,
      dominio: args.dominio,
      casoKebab: map['__casoKebab__'],
      api: args.apiExterna,
      errorPrefix: args.prefijoError,
      entidad: args.entidad,
      patchModules: !dominioYaExistia
    })
    notas.push(`API externa "${args.apiExterna}" cableada: la URL base va en ${map['__ENV_VAR_API__']} (configuration-variables, joi-schema y .env.example); los modulos apuntan al .http.adapter. AGENTE: pide al usuario esa URL y escríbela tú en el .env.`)
    for (const f of wiring.patched) notas.push(`Ajustado: ${f}`)
    for (const w of wiring.warnings) notas.push(`AVISO: ${w}`)
    notas.push('Revisa el mapeo de la respuesta de la API a la entidad de dominio, y las credenciales si la API las exige (TODO en el adapter).')
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
    connection: needsConnection ? { name: args.conexion, style: args.connectionStyle } : undefined
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Caso de uso "${args.caso}" generado en src/${domainFolder(args.dominio)}/ (adapter: ${args.adapterType}).`,
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
