import { z } from 'zod'
import { loadAndValidateSpec, SpecValidationError, type MiddlewareSpec } from '../lib/spec.js'
import { fillSpecConnection } from '../lib/connections.js'
import { usesDatabase, type AdapterType, type HttpVerb } from '../lib/adapters.js'
import { addUseCase } from './addUseCase.js'
import { enrichPortMethods, type PortMethod } from '../lib/portMethods.js'
import { applyDtoFields } from '../lib/dtoFields.js'
import { applyBusinessRules } from '../lib/businessRules.js'
import { recordInventory } from '../lib/inventory.js'
import { wireStoredProcedure } from '../lib/spWiring.js'
import { deriveEnvVarSp } from '../lib/placeholders.js'
import { MOTORES, PROFILES } from '../lib/engines.js'
import { refreshApiDocs } from '../lib/apiDocs.js'
import * as s from '../lib/schemas.js'

/**
 * generate_from_spec — genera un módulo hexagonal a partir de un
 * middleware.spec.yaml declarativo (agnóstico de dominio: module/entity los
 * define el usuario en el spec).
 *
 * Flujo: carga + valida el spec, construye un PLAN (casos/métodos/archivos) y:
 *   - dryRun=true (default): devuelve el plan SIN escribir disco (para revisar).
 *   - dryRun=false: genera el slice por cada caso de uso (reusa add_use_case).
 *
 * Modelo multi-método: un caso de uso puede declarar N métodos en su puerto.
 * El primer método es el "principal" que siembra el slice; los métodos
 * adicionales se enriquecen en los puertos/servicios/adapter (ver Bloque 3).
 */

export const generateFromSpecSchema = {
  projectRoot: s.projectRoot,
  specPath: z
    .string()
    .describe('Ruta absoluta al middleware.spec.yaml a generar. La ubicación la decide el usuario (no se impone carpeta).'),
  mode: s.mode,
  dryRun: z
    .boolean()
    .default(true)
    .describe(
      'Si true (default): valida el spec y devuelve el PLAN de generación SIN escribir disco. Si false: genera el módulo.'
    ),
  overwrite: s.overwrite
}

type PlanMethod = { name: string; request: string; response: string; sp?: string; http?: { method: HttpVerb; path: string } }
type PlanCase = {
  useCase: string
  action: string
  resourceType: string
  adapter: AdapterType
  api?: string
  principalMethod: PlanMethod
  extraMethods: PlanMethod[]
  files: string[]
}

/** Archivos que el slice de un caso produce (rutas relativas a src/<module>/). */
function slicePaths(spec: MiddlewareSpec, useCase: string, adapter: AdapterType): string[] {
  const dom = spec.module.toLowerCase()
  const Caso = useCase
  const caso = Caso.charAt(0).toLowerCase() + Caso.slice(1)
  const adapterFile = `${caso}.${adapter}.adapter.ts`
  return [
    `src/${dom}/${dom}.module.ts`,
    `src/${dom}/core/${dom}.core.module.ts`,
    `src/${dom}/core/domain/ports/inbound/I${Caso}Service.ts`,
    `src/${dom}/core/domain/ports/outbound/I${Caso}Repository.ts`,
    `src/${dom}/core/domain/services/${caso}.domain.service.ts`,
    `src/${dom}/core/application/interfaces/I${Caso}Application.ts`,
    `src/${dom}/core/application/services/${caso}.application.ts`,
    `src/${dom}/infrastructure/infrastructure.${dom}.module.ts`,
    `src/${dom}/infrastructure/adapters/${adapterFile}`,
    `src/${dom}/infrastructure/http-server/controllers/${caso}.controller.ts`,
    `src/${dom}/infrastructure/http-server/dto/${caso}.dto.ts`,
    `src/${dom}/infrastructure/http-server/dto/${caso}RequestJsonApi.dto.ts`
  ]
}

function buildPlan(spec: MiddlewareSpec): PlanCase[] {
  return spec.useCases.map((uc) => {
    const [principal, ...extra] = uc.methods
    return {
      useCase: uc.name,
      action: uc.action,
      resourceType: uc.resourceType,
      adapter: uc.adapter,
      api: uc.api,
      principalMethod: principal,
      extraMethods: extra,
      files: slicePaths(spec, uc.name, uc.adapter)
    }
  })
}

function renderPlan(spec: MiddlewareSpec, plan: PlanCase[], mode: string): string {
  const lines: string[] = []
  lines.push(`PLAN de generación (dryRun) — módulo "${spec.module}" (entity: ${spec.entity})`)
  lines.push(`  stack: ${spec.stack} | modo: ${mode} | complejidad declarada: ${spec.complexity.level}`)
  if (!spec.useCases.some((uc) => usesDatabase(uc.adapter))) lines.push(`  conexión: ninguna (todos los casos consumen una API externa) | prefijo error: ${spec.errorPrefix}`)
  else lines.push(`  conexión: ${spec.connection.name} (${spec.connection.style}, ${spec.connection.engine && spec.connection.engine !== 'none' ? PROFILES[spec.connection.engine].label : 'conexion del proyecto'}) | prefijo error: ${spec.errorPrefix}`)
  lines.push(`  carpeta destino: src/${spec.module.toLowerCase()}/`)
  if (spec.businessRules.none) lines.push('  reglas de negocio: ninguna (declarado explícitamente)')
  else {
    lines.push(`  reglas de negocio (${spec.businessRules.rules.length}):`)
    for (const r of spec.businessRules.rules) lines.push(`    - ${r}`)
  }
  lines.push('')
  plan.forEach((pc, i) => {
    lines.push(`Caso ${i + 1}: ${pc.useCase}  (adapter: ${pc.adapter}, acción POST: ${pc.action}, type JSON:API: ${pc.resourceType})`)
    lines.push(`  método principal: ${pc.principalMethod.name}(${pc.principalMethod.request}) : ${pc.principalMethod.response}` + (pc.principalMethod.sp ? ` [SP: ${pc.principalMethod.sp}]` : '') + (pc.principalMethod.http ? ` [API ${pc.api}: ${pc.principalMethod.http.method} ${pc.principalMethod.http.path}]` : ''))
    if (pc.extraMethods.length) {
      lines.push(`  métodos adicionales del puerto (${pc.extraMethods.length}):`)
      for (const m of pc.extraMethods)
        lines.push(`    - ${m.name}(${m.request}) : ${m.response}` + (m.sp ? ` [SP: ${m.sp}]` : ''))
    }
    lines.push(`  archivos (${pc.files.length}):`)
    for (const f of pc.files) lines.push(`    + ${f}`)
    lines.push('')
  })
  if (spec.notes.length) {
    lines.push('Notas del spec:')
    for (const n of spec.notes) lines.push(`  - ${n}`)
    lines.push('')
  }
  lines.push('Para generar, vuelve a llamar generate_from_spec con dryRun=false.')
  return lines.join('\n')
}

export async function generateFromSpec(a: {
  projectRoot: string
  specPath: string
  mode: 'greenfield' | 'refactor'
  dryRun: boolean
  overwrite: boolean
}) {
  // 1. Cargar + validar el spec.
  let spec: MiddlewareSpec
  try {
    spec = loadAndValidateSpec(a.specPath)
  } catch (err: any) {
    const msg =
      err instanceof SpecValidationError ? err.message : `Error al cargar el spec: ${err.message}`
    return { content: [{ type: 'text' as const, text: `ERROR: ${msg}` }], isError: true }
  }

  // The spec does not need to name its connection: it is named after its engine. Read only, so a dry run
  // already shows the name the real run will use.
  const needsDb = spec.useCases.some((uc) => usesDatabase(uc.adapter))
  if (needsDb && a.mode === 'greenfield' && spec.connection.style === 'named' && spec.connection.engine === 'none') {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: el spec declara el servicio SIN base de datos (connection.engine: none), pero sus casos de uso usan adapters TypeORM o SP, que necesitan una conexion. Sin base de datos usa adapter: http (API externa) en los casos de uso; si ahora el servicio SI usa una base de datos, pregunta el motor (mssql | postgres | mysql).'
        }
      ],
      isError: true
    }
  }
  if (needsDb && a.mode === 'greenfield' && spec.connection.style === 'named' && !spec.connection.engine) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: El middleware.spec no es valido:\n- connection.engine es obligatorio para crear la conexion: ${MOTORES.join(' | ')}. Se le pregunta al usuario; no hay default.`
        }
      ],
      isError: true
    }
  }
  const connectionProblem = needsDb ? fillSpecConnection(spec, a.projectRoot, a.mode) : undefined
  if (connectionProblem) {
    return { content: [{ type: 'text' as const, text: `ERROR: ${connectionProblem}` }], isError: true }
  }
  // The area does not use stored procedures on PostgreSQL.
  if (spec.connection.engine === 'postgres') {
    const sp = spec.useCases.filter((uc) => uc.adapter === 'sp').map((uc) => uc.name)
    if (sp.length > 0) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${sp.join(', ')}: el area no usa stored procedures en PostgreSQL: usa adapterType="typeorm" para esa conexion (los stored procedures siguen disponibles en SQL Server y MySQL).` }], isError: true }
    }
  }
  // 2. Construir el plan.
  const plan = buildPlan(spec)

  // 3. dryRun: devolver el plan sin escribir.
  if (a.dryRun) {
    return { content: [{ type: 'text' as const, text: renderPlan(spec, plan, a.mode) }] }
  }

  // 4. Generación: un slice por caso de uso (reusa add_use_case con el método principal).
  const dom = spec.module
  const outputs: string[] = []
  outputs.push(`Generando módulo "${spec.module}" (${spec.useCases.length} caso[s]) en modo ${a.mode}.`)
  outputs.push('')

  for (const pc of plan) {
    const principal = pc.principalMethod
    const res = await addUseCase({
      projectRoot: a.projectRoot,
      dominio: dom,
      caso: pc.useCase,
      entidad: principal.response || spec.entity,
      metodo: principal.name,
      param: deriveParam(principal.request),
      request: principal.request,
      accion: pc.action,
      prefijoError: spec.errorPrefix,
      conexion: spec.connection.name,
      motor: spec.connection.engine,
    crearConexion: spec.connection.create === true && a.mode === 'refactor',
      adapterType: pc.adapter,
      nombreSp: principal.sp,
      envVarSp: undefined,
      apiExterna: pc.api,
      rutaApi: principal.http?.path,
      metodoHttp: principal.http?.method,
      mode: a.mode,
      connectionStyle: spec.connection.style,
      infraStyle: 'dataset',
      infraRoot: undefined,
      overwrite: a.overwrite
    })
    const text = res.content?.[0]?.text ?? ''
    if (res.isError) {
      outputs.push(`── Caso "${pc.useCase}" ──`, text)
      return { content: [{ type: 'text' as const, text: outputs.join('\n') }], isError: true }
    }
    outputs.push(`── Caso "${pc.useCase}" ──`)
    outputs.push(text)

    // Enriquecimiento multi-método: añade los métodos adicionales del puerto
    // (inbound/outbound), su implementación en domain service + adapter, y crea
    // las entidades request/response que falten. El método principal ya quedó
    // sembrado por add_use_case.
    if (pc.extraMethods.length) {
      const extra: PortMethod[] = pc.extraMethods.map((m) => ({
        name: m.name,
        request: m.request,
        response: m.response,
        sp: m.sp,
        http: m.http
      }))
      const enrich = enrichPortMethods({
        projectRoot: a.projectRoot,
        dominio: dom,
        caso: pc.useCase,
        adapterType: pc.adapter,
        methods: extra
      })
      outputs.push('')
      outputs.push(
        `Enriquecimiento multi-método de "${pc.useCase}" (${extra.length} método[s] adicional[es]: ${extra
          .map((m) => m.name)
          .join(', ')}):`
      )
      for (const f of enrich.created) outputs.push(`  + entidad creada: ${f}`)
      for (const f of enrich.patched) outputs.push(`  ~ parcheado: ${f}`)
      for (const w of enrich.warnings) outputs.push(`  AVISO: ${w}`)

      // The adapter of every extra method reads storedProcedures.<SP> from config: each SP must be
      // declared (ConfigurationVariables + joiSchema + .env.example) or the service does not compile.
      // add_use_case only wires the principal SP, so the extra ones are wired here.
      if (pc.adapter === 'sp') {
        const casoCamel = pc.useCase.charAt(0).toLowerCase() + pc.useCase.slice(1)
        for (const m of extra) {
          if (!m.sp) continue
          const envVarSp = deriveEnvVarSp(m.sp)
          const wiring = wireStoredProcedure({
            projectRoot: a.projectRoot,
            dominio: dom,
            casoCamel,
            nombreSp: m.sp,
            envVarSp,
            patchModules: false
          })
          outputs.push(`  SP "${m.sp}" (env: ${envVarSp}) registrado en ConfigurationVariables, joiSchema y .env.example.`)
          for (const f of wiring.patched) outputs.push(`  ~ ${f}`)
          for (const w of wiring.warnings) outputs.push(`  AVISO: ${w}`)
        }
      }
    }

    // DTOs input/output + entidades request/response del caso (método principal).
    const hasDtos =
      Object.keys(spec.dtos.input).length > 0 || Object.keys(spec.dtos.output).length > 0
    if (hasDtos) {
      const dto = applyDtoFields({
        projectRoot: a.projectRoot,
        dominio: dom,
        caso: pc.useCase,
        attributesClass: `${pc.useCase}Attributes`,
        requestEntity: principal.request,
        responseEntity: principal.response || spec.entity,
        input: spec.dtos.input,
        output: spec.dtos.output
      })
      if (dto.patched.length || dto.warnings.length) {
        outputs.push('')
        outputs.push(`DTOs input/output de "${pc.useCase}":`)
        for (const f of dto.patched) outputs.push(`  ~ poblado: ${f}`)
        for (const w of dto.warnings) outputs.push(`  AVISO: ${w}`)
      }
    }
    outputs.push('')
  }

  // Reglas de negocio: se materializan como guardas en el application service.
  // A falta de una asociación explícita regla↔caso en el spec, se aplican al
  // PRIMER caso (con NOTA). Si una regla pertenece a otro caso, muévela a mano.
  if (!spec.businessRules.none && spec.businessRules.rules.length > 0 && plan.length > 0) {
    const target = plan[0]
    const br = applyBusinessRules({
      projectRoot: a.projectRoot,
      dominio: dom,
      caso: target.useCase,
      errorPrefix: spec.errorPrefix,
      rules: spec.businessRules.rules
    })
    outputs.push(
      `Reglas de negocio (${spec.businessRules.rules.length}) materializadas en el application service de "${target.useCase}" ` +
        `(${br.inferred}/${br.generated} con condición inferida):`
    )
    for (const f of br.patched) outputs.push(`  ~ ${f}`)
    for (const w of br.warnings) outputs.push(`  AVISO: ${w}`)
    outputs.push(
      '  NOTA: las condiciones generadas son APROXIMACIONES del texto del spec; revísalas y ' +
        'ajústalas al requerimiento real. Si una regla corresponde a otro caso, muévela a su application service.'
    )
    outputs.push('')
  }

  // Registra el módulo en el inventario (memoria por repo). La auditoría con
  // compliance/build la escribe record_architecture tras correr verify/build.
  try {
    const inv = recordInventory({
      projectRoot: a.projectRoot,
      entry: {
        module: spec.module,
        entity: spec.entity,
        description: spec.description || undefined,
        stack: spec.stack,
        connection: needsDb ? spec.connection : undefined,
        complexity: { level: spec.complexity.level, signals: spec.complexity.signals },
        useCases: spec.useCases.map((uc) => ({
          name: uc.name,
          adapter: uc.adapter,
          api: uc.api,
          methods: uc.methods.map((m) => ({
            name: m.name,
            request: m.request,
            response: m.response,
            sp: m.sp
          }))
        })),
        businessRules: spec.businessRules.none ? [] : spec.businessRules.rules
      }
    })
    outputs.push(
      `Inventario ${inv.created ? 'creado' : inv.replaced ? 'actualizado' : 'actualizado'}: ${inv.file}`
    )
  } catch (err: any) {
    outputs.push(`AVISO: no se pudo actualizar el inventario: ${err?.message}`)
  }

  // The DTOs and entities were filled in AFTER each add_use_case, so the contract is regenerated once more now.
  const docs = refreshApiDocs(a.projectRoot, dom)
  if (docs && docs.written.length) outputs.push(`Documentacion de la API generada desde el codigo: ${docs.written.join(', ')}.`)
  outputs.push(
    'Siguiente: `npm run build` + `npm test` + `verify_standards`; luego `record_architecture` ' +
      '(con compliance y build) para escribir la auditoría del módulo.'
  )

  return { content: [{ type: 'text' as const, text: outputs.join('\n') }] }
}

/** Deriva un nombre de parámetro camelCase razonable desde el nombre de la entidad request. */
function deriveParam(request: string): string {
  if (!request) return 'input'
  const base = request.replace(/Request$/i, '')
  return base.charAt(0).toLowerCase() + base.slice(1) || 'input'
}
