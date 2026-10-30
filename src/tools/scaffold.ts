import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { materializeTree, materializeFile, readTemplate } from '../lib/dataset.js'
import { buildPlaceholderMap } from '../lib/placeholders.js'
import { buildEnvExample } from '../lib/env.js'
import { learnConventions } from '../lib/learnings.js'
import { chooseConnection, ensureConnection, listConnections } from '../lib/connections.js'
import { PROFILES, SIN_BASE_DE_DATOS, connectionEnv, isMotorChoice, type MotorChoice } from '../lib/engines.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// scaffold_service: base del servicio (shared + config + enforcement)
// ---------------------------------------------------------------------------
// Real values live in .env and never go to git; .env.example documents the keys.
export const GITIGNORE = [
  '# Dependencies and build output',
  'node_modules/',
  'dist/',
  'coverage/',
  '',
  '# Environment: the real values (credentials, URLs) stay out of git. .env.example documents the keys.',
  '.env',
  '.env.*',
  '!.env.example',
  '',
  '# Logs and system files',
  '*.log',
  '.DS_Store',
  ''
].join('\n')

export const scaffoldServiceSchema = {
  projectRoot: s.projectRoot,
  conexion: s.conexion,
  motor: s.motor.optional(),
  prefijoApi: s.prefijoApi.optional(),
  prefijoError: s.prefijoError.optional(),
  overwrite: s.overwrite
}

export async function scaffoldService(input: {
  projectRoot: string
  conexion?: string
  motor?: MotorChoice
  prefijoApi?: string
  prefijoError?: string
  overwrite: boolean
}) {
  // Obligatory, and never invented: the user is asked. Only what is missing is listed.
  const questions: string[] = []
  if (!input.prefijoApi) {
    questions.push('prefijoApi: prefijo de la API en kebab-case. Por ejemplo, midd-catalog. Los endpoints quedaran como /<prefijo>/api/v1/{recurso}.')
  }
  if (!input.prefijoError) {
    questions.push('prefijoError: prefijo de errores de la API en MAYUSCULAS. Por ejemplo, CATALOG. Los errores quedaran como CATALOG-PRODUCTNOTFOUND-001.')
  }
  if (!input.motor) {
    questions.push('motor: base de datos de la API: mssql, postgres, mysql o none si no usa base de datos.')
  }
  if (questions.length > 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `ERROR: faltan datos para crear la API (${questions.map((q) => q.split(':')[0]).join(', ')}). No los inventes ni uses un valor por defecto: preguntaselos al usuario, todos en un solo mensaje:`,
            ...questions.map((q, i) => `  ${i + 1}. ${q}`),
            'Con sus respuestas vuelve a llamar scaffold_service. El agente middleware-generator hace estas preguntas por ti: si este chat no lo esta usando, pidele al usuario que lo seleccione en el selector de agentes.'
          ].join('\n')
        }
      ],
      isError: true
    }
  }
  const args = { ...input, conexion: input.conexion ?? '' } as typeof input & { conexion: string; motor: MotorChoice; prefijoApi: string; prefijoError: string }
  // The engine is never assumed: it is asked. (The MCP schema already requires it; this guards direct calls.)
  if (!isMotorChoice(args.motor)) {
    return {
      content: [{ type: 'text' as const, text: 'ERROR: falta el motor de base de datos (mssql | postgres | mysql, o none si el servicio no usa base de datos). Pregúntaselo al usuario; no se asume.' }],
      isError: true
    }
  }
  // "none": the service does not use a database, so NO connection is generated, whatever the engine.
  const engine = args.motor === SIN_BASE_DE_DATOS ? undefined : args.motor
  if (engine) {
    // The connection is named after its engine unless the caller names it (an extra connection).
    const choice = chooseConnection({ projectRoot: args.projectRoot, conexion: input.conexion, motor: engine })
    if ('error' in choice) {
      return { content: [{ type: 'text' as const, text: `ERROR: ${choice.error}` }], isError: true }
    }
    args.conexion = choice.name
  }
  // Re-running scaffold on a project whose connection uses ANOTHER engine must not silently keep (or change) it.
  const existing = engine ? listConnections(args.projectRoot).find((c) => c.name === args.conexion) : undefined
  if (engine && existing?.motor && existing.motor !== engine) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: la conexión "${args.conexion}" ya existe con el motor ${existing.motor} y pediste ${engine}. No se cambia el motor de una conexión existente: usa otro nombre de conexión o corrige el motor.`
        }
      ],
      isError: true
    }
  }
  const map = buildPlaceholderMap({
    dominio: 'Sample',
    caso: 'Sample',
    entidad: 'Sample',
    metodo: 'retrieveSample',
    param: 'id',
    accion: 'sample',
    prefijoError: args.prefijoError,
    rutaDominio: 'sample',
    tipoRecurso: 'sample',
    conexion: args.conexion,
    servicio: args.prefijoApi
  })

  // 1) Copiar la capa shared tal cual a src/shared/
  const sharedRes = materializeTree({
    subdir: 'shared',
    destRoot: join(args.projectRoot, 'src', 'shared'),
    map,
    overwrite: args.overwrite
  })

  // 2) Copiar archivos de config a la raiz / rutas correspondientes.
  const written: string[] = [...sharedRes.written.map((f) => `src/shared/${f}`)]
  const skipped: string[] = [...sharedRes.skipped.map((f) => `src/shared/${f}`)]

  const configFiles: Array<{ tpl: string; dest: string }> = [
    // Base del proyecto NestJS (para que compile y arranque desde cero).
    { tpl: 'config/package.base.json', dest: 'package.json' },
    { tpl: 'config/tsconfig.json', dest: 'tsconfig.json' },
    { tpl: 'config/tsconfig.build.json', dest: 'tsconfig.build.json' },
    { tpl: 'config/nest-cli.json', dest: 'nest-cli.json' },
    // Enforcement / calidad.
    { tpl: 'config/.eslintrc.js', dest: '.eslintrc.js' },
    { tpl: 'config/.prettierrc', dest: '.prettierrc' },
    { tpl: 'config/.dockerignore', dest: '.dockerignore' },
    { tpl: 'config/Dockerfile', dest: 'Dockerfile' },
    { tpl: 'config/verify-standards.mjs', dest: 'scripts/verify-standards.mjs' },
    { tpl: 'config/husky/pre-commit', dest: '.husky/pre-commit' },
    { tpl: 'config/husky/pre-push', dest: '.husky/pre-push' },
    { tpl: 'config/main.ts', dest: 'src/main.ts' },
    { tpl: 'config/app.module.ts', dest: 'src/app.module.ts' }
  ]

  for (const f of configFiles) {
    const r = materializeFile({
      templateRelPath: f.tpl,
      destFullPath: join(args.projectRoot, f.dest),
      map,
      overwrite: args.overwrite
    })
    if (r.written.length) written.push(f.dest)
    if (r.skipped.length) skipped.push(f.dest)
  }

  // 3) Generar .env.example sincronizado con el Joi schema (fuente de verdad).
  const envPath = join(args.projectRoot, '.env.example')
  if (!existsSync(envPath) || args.overwrite) {
    const joiText = readTemplate('shared/infrastructure/config/joi-schema.ts')
    mkdirSync(args.projectRoot, { recursive: true })
    writeFileSync(
      envPath,
      buildEnvExample(joiText, [], { API_CONTEXT: args.prefijoApi }),
      'utf8'
    )
    written.push('.env.example')
  } else {
    skipped.push('.env.example')
  }

  // A .gitignore that keeps the real values (.env) out of git. Never overwrites the one a project already has.
  const gitignorePath = join(args.projectRoot, '.gitignore')
  if (!existsSync(gitignorePath)) {
    mkdirSync(args.projectRoot, { recursive: true })
    writeFileSync(gitignorePath, GITIGNORE, 'utf8')
    written.push('.gitignore')
  } else {
    skipped.push('.gitignore')
  }
  // The primary connection goes through the same path as any later one: module, options, config,
  // Joi, .env.example, AppModule and the driver of its engine.
  const connection = engine
    ? ensureConnection({ projectRoot: args.projectRoot, conexion: args.conexion, motor: engine })
    : { written: [] as string[], patched: [] as string[], warnings: [] as string[] }
  written.push(...connection.written, ...connection.patched)
  const connectionWarnings = connection.warnings

  // Remembered for the next session of this repo (advisory; never affects what is generated).
  learnConventions(args.projectRoot, {
    serviceContext: args.prefijoApi,
    errorPrefix: args.prefijoError,
    connection: engine ? { name: args.conexion, style: 'named' } : undefined
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Base del servicio generada en ${args.projectRoot}.`,
          '',
          `Escritos (${written.length}):`,
          ...written.map((f) => `  + ${f}`),
          skipped.length ? `\nOmitidos por ya existir (${skipped.length}):` : '',
          ...skipped.map((f) => `  = ${f}`),
          '',
          'Siguientes pasos:',
          `  - Proyecto base listo (package.json, tsconfig, nest-cli). Base URL "/${args.prefijoApi}/api/v{N}/{resource}" (API_CONTEXT=${args.prefijoApi})${engine ? `; conexión "${args.conexion}" cableada en app.module.ts y el módulo de BD.` : '.'}`,
          '  - AGENTE (hazlo tú con shell, no se lo pidas al usuario): corre npm install.',
          engine
            ? `  - Motor ${PROFILES[engine].label}: AGENTE: pide al usuario los valores de ${connectionEnv(args.conexion).prefix}_HOST, _PORT, _USERNAME, _PASSWORD y _NAME y escríbelos tú en el .env (no le pidas que lo edite). No repitas la contraseña en tus respuestas.`
            : '  - SIN base de datos (el usuario eligió none): no se generó ninguna conexión, módulo de BD, variable DB_* ni driver. Un caso de uso que consume una API externa (adapterType http) funciona sin base de datos; los de TypeORM o SP necesitan una conexión, que se crea al indicar el motor en add_use_case.',
          ...connectionWarnings.map((w) => `  ! ${w}`),
          '  - AGENTE: crea el .env a partir del .env.example con tus herramientas de archivos (sin pisar uno existente) y escribe los valores reales que te dé el usuario. Los de seguridad (CORS, RL_*) ya traen su valor por defecto: no los preguntes. El .gitignore generado ya excluye .env.',
          '  - AGENTE: la base NO es el final. No cierres ni digas "sin pendientes": PIDE AL USUARIO el primer caso de uso (que hace, que recibe y que devuelve) y sigue la Fase 3 del flujo; generalo con generate_from_spec o add_use_case (registra el dominio en app.module.ts automáticamente).'
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
  }
}


