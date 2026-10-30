export interface IDatabaseCommonService {
  executeStoredProcedure<T>(
    procedureName: string,
    parameters: any,
    isSingleObject?: boolean
  ): Promise<T>
}
