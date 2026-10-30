import { toKebab } from './names.js'

/**
 * Database engine profiles. The agent asks which engine a NEW connection uses and everything that
 * depends on the engine is derived from the answer: TypeORM type, driver package, default port,
 * extra connection options and the names of the generated files and classes.
 *
 * SQL Server keeps the names of the canonical service (mssql.database.<x>.module.ts,
 * <X>SqlServerOption, SqlServer<X>DatabaseModule); the other engines follow the same pattern.
 */

export const MOTORES = ['mssql', 'postgres', 'mysql'] as const
export type Motor = (typeof MOTORES)[number]

export type EngineProfile = {
  id: Motor
  label: string
  /** `type` of the TypeORM options. */
  typeormType: string
  /** Prefix of the generated classes: SqlServer<X>DatabaseModule, <X>SqlServerOption. */
  classPrefix: string
  /** Tag of the module file: <fileTag>.database.<x>.module.ts */
  fileTag: string
  /** Tag of the options file: <x>.<optionTag>.option.ts */
  optionTag: string
  defaultPort: number
  /** Sample user for .env.example (a placeholder, never a secret). */
  sampleUser: string
  /** Runtime driver TypeORM loads. It goes in `dependencies`: the production image installs with --omit=dev. */
  driver: { name: string; version: string }
  /** Extra TypeORM options, already indented and starting with a newline (or empty). */
  extraOptions: string
}

export const PROFILES: Record<Motor, EngineProfile> = {
  mssql: {
    id: 'mssql',
    label: 'SQL Server',
    typeormType: 'mssql',
    classPrefix: 'SqlServer',
    fileTag: 'mssql',
    optionTag: 'sqlserver',
    defaultPort: 1433,
    sampleUser: 'sa',
    driver: { name: 'mssql', version: '^10' },
    extraOptions: '\n      options: { trustServerCertificate: true },'
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    typeormType: 'postgres',
    classPrefix: 'Postgres',
    fileTag: 'postgres',
    optionTag: 'postgres',
    defaultPort: 5432,
    sampleUser: 'postgres',
    driver: { name: 'pg', version: '^8' },
    extraOptions: ''
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    typeormType: 'mysql',
    classPrefix: 'MySql',
    fileTag: 'mysql',
    optionTag: 'mysql',
    defaultPort: 3306,
    sampleUser: 'root',
    driver: { name: 'mysql2', version: '^3' },
    extraOptions: ''
  }
}

/** The answer "this service does not use a database": no connection of any engine is generated. */
export const SIN_BASE_DE_DATOS = 'none' as const
export type MotorChoice = Motor | typeof SIN_BASE_DE_DATOS
export const isMotorChoice = (value: unknown): value is MotorChoice =>
  value === SIN_BASE_DE_DATOS || (typeof value === 'string' && (MOTORES as readonly string[]).includes(value))

export const isMotor = (value: unknown): value is Motor =>
  typeof value === 'string' && (MOTORES as readonly string[]).includes(value)

const upperSnake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase()

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/** Environment variables of a connection: DB_<CONNECTION>_HOST / _PORT / _USERNAME / _PASSWORD / _NAME. */
export function connectionEnv(conexion: string) {
  const prefix = `DB_${upperSnake(conexion)}`
  return {
    prefix,
    host: `${prefix}_HOST`,
    port: `${prefix}_PORT`,
    username: `${prefix}_USERNAME`,
    password: `${prefix}_PASSWORD`,
    name: `${prefix}_NAME`
  }
}

/** Names the generated files and classes of a connection have for an engine. */
export function connectionNames(conexion: string, motor: Motor) {
  const profile = PROFILES[motor]
  const kebab = toKebab(conexion)
  return {
    moduleClass: `${profile.classPrefix}${conexion}DatabaseModule`,
    optionClass: `${conexion}${profile.classPrefix}Option`,
    moduleFile: `${profile.fileTag}.database.${kebab}.module`,
    optionFile: `${kebab}.${profile.optionTag}.option`
  }
}

/** Placeholders of the templates/database/* files. */
export function connectionPlaceholders(conexion: string, motor: Motor): Record<string, string> {
  const profile = PROFILES[motor]
  return {
    __Conexion__: conexion,
    __conexion__: lowerFirst(conexion),
    __conexionKebab__: toKebab(conexion),
    '<Conexion>': conexion,
    '<envPrefix>': connectionEnv(conexion).prefix,
    __Motor__: profile.classPrefix,
    __motorFile__: profile.fileTag,
    __motorOption__: profile.optionTag,
    __typeormType__: profile.typeormType,
    __extraOptions__: profile.extraOptions
  }
}
