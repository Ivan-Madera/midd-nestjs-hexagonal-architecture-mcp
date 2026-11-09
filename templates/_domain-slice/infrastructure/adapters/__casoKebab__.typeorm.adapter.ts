import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/__casoKebab__.outbound.port'
import { __Entidad__EntityConfiguration } from '../sql-database/entities/__entidadKebab__.entity'
import { __Request__ } from '../../core/domain/entities/__requestKebab__.entity'
import { __Entidad__ } from '../../core/domain/entities/__entidadKebab__.entity'
import { Mapper } from '../../../<sharedRoot>/utils/services/map.service'

export class __Caso__Adapter implements I__Caso__Repository {
  constructor(
    @InjectRepository(__Entidad__EntityConfiguration<ConexionArg>)
    private readonly repository: Repository<__Entidad__EntityConfiguration>
  ) {}

  async __metodo__(data: __Request__): Promise<__Entidad__> {
    // TODO(midd): ajusta el criterio de busqueda (where) a las columnas reales.
    const row = await this.repository.findOne({ where: { ...data } as any })
    if (!row) {
      return null
    }
    return Mapper(__Entidad__, row)
  }
}
