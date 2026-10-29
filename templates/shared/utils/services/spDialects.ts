/**
 * How a stored routine is called in each supported engine, and how its result and its errors are read.
 * A pure module (no imports): DatabaseCommonService picks the dialect from the TYPE OF THE CONNECTION,
 * so one service can talk to a SQL Server, a PostgreSQL and a MySQL connection at the same time.
 *
 *   mssql     NAME @0, @1                        T-SQL procedure, positional parameters
 *   postgres  SELECT * FROM NAME($1, $2)         PostgreSQL FUNCTION that returns rows
 *   mysql     CALL NAME(?, ?)                    MySQL procedure
 *
 * PostgreSQL note: a routine that returns data is a FUNCTION there. A CREATE PROCEDURE routine is
 * invoked with CALL and returns no rows, so it is not supported by this dialect.
 */
export type SpDialect = {
  buildCall(procedure: string, parameterCount: number): string
  /** Rows of whatever the driver returns for that statement. */
  rows(result: unknown): unknown[]
  /** Readable message of a driver error. */
  errorMessage(error: any): string | undefined
}

/** A configuration or programming error (bad procedure name, unsupported engine), not a business error. */
export class SpConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpConfigurationError'
  }
}

const SEGMENT = /^[A-Za-z_][A-Za-z0-9_$]*$/
const BRACKETED = /^\[[A-Za-z0-9_$ ]+\]$/

/**
 * The name is concatenated into the statement (it cannot be a bound parameter), so it is validated.
 * It comes from configuration, never from a request, but a typo or a bad value must fail loudly
 * instead of becoming SQL. Accepts name, schema.name, database.schema.name (and [bracketed] in SQL Server).
 */
function assertProcedureName(name: string, allowBrackets: boolean): void {
  const parts = String(name).split('.')
  const valid =
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => SEGMENT.test(part) || (allowBrackets && BRACKETED.test(part)))
  if (!valid) throw new SpConfigurationError(`Invalid stored procedure name: "${name}"`)
}

const placeholders = (count: number, build: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => build(index)).join(', ')

const mssql: SpDialect = {
  buildCall(procedure, count) {
    assertProcedureName(procedure, true)
    return `${procedure} ${placeholders(count, (i) => `@${i}`)}`.trim()
  },
  rows: (result) => (Array.isArray(result) ? result : []),
  errorMessage: (error) => error?.originalError?.message ?? error?.message
}

const postgres: SpDialect = {
  buildCall(procedure, count) {
    assertProcedureName(procedure, false)
    return `SELECT * FROM ${procedure}(${placeholders(count, (i) => `$${i + 1}`)})`
  },
  rows: (result) => {
    if (Array.isArray(result)) return result
    const rows = (result as { rows?: unknown })?.rows
    return Array.isArray(rows) ? rows : []
  },
  errorMessage: (error) => error?.driverError?.message ?? error?.message
}

const mysql: SpDialect = {
  buildCall(procedure, count) {
    assertProcedureName(procedure, false)
    return `CALL ${procedure}(${placeholders(count, () => '?')})`
  },
  // CALL answers [rowsOfTheFirstResultSet, ..., OkPacket]; a routine with no result set answers an object.
  rows: (result) => {
    if (!Array.isArray(result)) return []
    return Array.isArray(result[0]) ? result[0] : result
  },
  errorMessage: (error) => error?.driverError?.sqlMessage ?? error?.sqlMessage ?? error?.message
}

const DIALECTS = new Map<string, SpDialect>([
  ['mssql', mssql],
  ['postgres', postgres],
  ['mysql', mysql]
])

export function spDialectFor(connectionType: string): SpDialect {
  const dialect = DIALECTS.get(connectionType)
  if (!dialect) {
    throw new SpConfigurationError(
      `Stored procedures are not supported for the "${connectionType}" connection type (supported: ${[...DIALECTS.keys()].join(', ')})`
    )
  }
  return dialect
}
