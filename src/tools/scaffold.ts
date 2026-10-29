import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { materializeTree, materializeFile, readTemplate } from '../lib/dataset.js'
import { buildPlaceholderMap } from '../lib/placeholders.js'
import { buildEnvExample } from '../lib/env.js'
import { learnConventions } from '../lib/learnings.js'
import { ensureConnection, listConnections } from '../lib/connections.js'
import { PROFILES, connectionEnv, isMotor, type Motor } from '../lib/engines.js'
import * as s from '../lib/schemas.js'

// ---------------------------------------------------------------------------
// scaffold_service: base del servicio (shared + config + enforcement)
// ---------------------------------------------------------------------------
export const scaffoldServiceSchema = {
  projectRoot: s.projectRoot,
  conexion: s.conexion,
  motor: s.motor,
  prefijoServicio: s.prefijoServicio,
  prefijoError: s.prefijoError,
  overwrite: s.overwrite
}

export async function scaffoldService(args: {
  projectRoot: string
  conexion: string
  motor: Motor
  prefijoServicio: string
  prefijoError: string
  overwrite: boolean
}) {
  // The engine is never assumed: it is asked. (The MCP schema already requires it; this guards direct calls.)
  if (!isMotor(args.motor)) {
    return {
      content: [{ type: 'text' as const, text: 'ERROR: falta el motor de base de datos (mssql | postgres | mysql). Pregúntaselo al usuario; no se asume.' }],
      isError: true
    }
  }

  // Re-running scaffold on a project whose connection uses ANOTHER engine must not silently keep (or change) it.
  const existing = listConnections(args.projectRoot).find((c) => c.name === args.conexion)
  if (existing?.motor && existing.motor !== args.motor) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: la conexión "${args.conexion}" ya existe con el motor ${existing.motor} y pediste ${args.motor}. No se cambia el motor de una conexión existente: usa otro nombre de conexión o corrige el motor.`
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
    servicio: args.prefijoServicio
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

  // 3) Generar .env.example sincronizado con el joiSchema (fuente de verdad).
  const envPath = join(args.projectRoot, '.env.example')
  if (!existsSync(envPath) || args.overwrite) {
    const joiText = readTemplate('shared/infrastructure/config/joiSchema.ts')
    mkdirSync(args.projectRoot, { recursive: true })
    writeFileSync(
      envPath,
      buildEnvExample(joiText, [], { API_CONTEXT: args.prefijoServicio }),
      'utf8'
    )
    written.push('.env.example')
  } else {
    skipped.push('.env.example')
  }

  // The primary connection goes through the same path as any later one: module, options, config,
  // Joi, .env.example, AppModule and the driver of its engine.
  const connection = ensureConnection({ projectRoot: args.projectRoot, conexion: args.conexion, motor: args.motor })
  written.push(...connection.written, ...connection.patched)
  const connectionWarnings = connection.warnings

  // Remembered for the next session of this repo (advisory; never affects what is generated).
  learnConventions(args.projectRoot, {
    serviceContext: args.prefijoServicio,
    errorPrefix: args.prefijoError,
    connection: { name: args.conexion, style: 'named' }
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
          `  - Proyecto base listo (package.json, tsconfig, nest-cli). Base URL "/${args.prefijoServicio}/api/v{N}/{resource}" (API_CONTEXT=${args.prefijoServicio}); conexión "${args.conexion}" cableada en app.module.ts y el módulo de BD.`,
          '  - Corre npm install.',
          `  - Motor ${PROFILES[args.motor].label}: rellena ${connectionEnv(args.conexion).prefix}_HOST, _PORT, _USERNAME, _PASSWORD y _NAME en el .env.`,
          ...connectionWarnings.map((w) => `  ! ${w}`),
          '  - Copia .env.example a .env y rellena los valores reales de BD/seguridad.',
          '  - Añade un caso de uso con add_use_case (registra el dominio en app.module.ts automáticamente).'
        ]
          .filter(Boolean)
          .join('\n')
      }
    ]
  }
}


