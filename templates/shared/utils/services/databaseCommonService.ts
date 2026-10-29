import { DataSource } from 'typeorm'
import { IdatabaseCommonService } from '../interfaces/IdatabaseCommonService'
import { spDialectFor } from './spDialects'
import LoggerService from '../../ErrorEventManagement/logger/Logger.service'

export class DatabaseCommonService implements IdatabaseCommonService {
  // The DataSource is injected by UtilsModule.register() according to the connection of the service.
  constructor(private entityManager: DataSource) {}

  /**
   * Executes a stored procedure with n parameters. The statement is built for the engine of the
   * connection (SQL Server, PostgreSQL or MySQL), see spDialects.ts.
   * @param procedureName name of the stored procedure (validated: it is part of the statement)
   * @param parameters object with the parameters (its values are passed in order)
   * @param isSingleObject if the procedure returns a single record, returns the object instead of the array
   */
  async executeStoredProcedure<T>(
    procedureName: string,
    parameters: any,
    isSingleObject = false
  ): Promise<T | any> {
    // Outside the try on purpose: an invalid name or an unsupported engine is a configuration error
    // and must surface, not be swallowed like a failing query.
    const dialect = spDialectFor(String(this.entityManager.options.type))
    const parameterValues: any[] = Object.values(parameters ?? {})
    const queryCommand = dialect.buildCall(procedureName, parameterValues.length)

    try {
      const results = await this.entityManager
        .query(queryCommand, parameterValues)
        .then((raw: unknown) => dialect.rows(raw))
        .catch((error: any) => {
          const errorResponse = {
            query: error?.query,
            message: dialect.errorMessage(error),
            parameters: error?.parameters ?? [],
            hasFailed: true
          }
          LoggerService.error(
            `An error occurred while executing the stored procedure: ${error?.query}. ${JSON.stringify(errorResponse)}`
          )
          return errorResponse
        })

      if (Array.isArray(results) && results?.length === 1 && isSingleObject) {
        return results.shift() as T
      }
      LoggerService.debug(`SP ${procedureName} RESULT: ${JSON.stringify(results)}`)
      return results as T
    } catch (error) {
      LoggerService.error(`An error occurred in executeStoredProcedure: ${error}`)
    }
  }
}
