import { Inject } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/__casoKebab__.outbound.port'
import { IDatabaseCommonService } from '../../../<sharedRoot>/utils/interfaces/database-common.service.interface'
import { <dbTokenImport> } from '../../../<sharedRoot>/utils/utils.module'
import ConfigurationVariables from '../../../<sharedRoot>/infrastructure/config/configuration-variables'
import { Mapper } from '../../../<sharedRoot>/utils/services/map.service'
import { __Request__ } from '../../core/domain/entities/__requestKebab__.entity'
import { __Entidad__ } from '../../core/domain/entities/__entidadKebab__.entity'

export class __Caso__Adapter implements I__Caso__Repository {
  constructor(
    @Inject(<dbTokenExpr>)
    private readonly dbProcessCommon: IDatabaseCommonService,
    @Inject(ConfigurationVariables.KEY)
    private readonly config: ConfigType<typeof ConfigurationVariables>
  ) {}

  async __metodo__(data: __Request__): Promise<__Entidad__> {
    // isSingleObject=true cuando el SP devuelve un único registro.
    return Mapper(
      __Entidad__,
      await this.dbProcessCommon.executeStoredProcedure<__Entidad__>(
        this.config.storedProcedures.__NombreSp__,
        data,
        true
      )
    )
  }
}
