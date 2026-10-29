export interface IdatabaseCommonService {
  executeStoredProcedure<T>(
    procedureName: string,
    parameters: any,
    isSingleObject?: boolean
  ): Promise<T>
}
