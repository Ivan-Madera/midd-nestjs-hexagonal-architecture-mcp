// Adapter de stored procedure (patrón dominante del área). Ejecuta un SP vía el
// DatabaseCommonService y mapea el resultado a una entidad de dominio.
//
// Hexagonal puro: el nombre del SP es un detalle de INFRAESTRUCTURA — no viaja
// por el puerto de dominio. El adapter lo resuelve desde ConfigurationVariables;
// el core (puerto, domain service, application) solo conoce `data`.
import { Inject } from '@nestjs/common'
import { ConfigType } from '@nestjs/config'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/I__Caso__Repository'
import { IdatabaseCommonService } from '../../../<sharedRoot>/utils/interfaces/IdatabaseCommonService'
import { <dbTokenImport> } from '../../../<sharedRoot>/utils/utils.module'
import ConfigurationVariables from '../../../<sharedRoot>/infrastructure/config/ConfigurationVariables'
import { Mapper } from '../../../<sharedRoot>/utils/services/mapService'
import { __Request__ } from '../../core/domain/entities/__Request__.entity'
import { __Entidad__ } from '../../core/domain/entities/__Entidad__.entity'

export class __Caso__Adapter implements I__Caso__Repository {
  constructor(
    @Inject(<dbTokenExpr>)
    private readonly dbProcessCommon: IdatabaseCommonService,
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
