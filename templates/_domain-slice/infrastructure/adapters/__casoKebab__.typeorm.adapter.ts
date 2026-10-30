// Adapter TypeORM repository. Usa esta variante cuando el acceso a datos es
// vía repositorio de entidad. Para stored procedures, usa __casoKebab__.sp.adapter.ts.
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
    // Mapea los campos de `data` al criterio de búsqueda que corresponda.
    const row = await this.repository.findOne({ where: { ...data } as any })
    if (!row) {
      return null
    }
    // La entidad TypeORM y la de dominio son clases distintas: se mapea con Mapper (los campos de la
    // entidad de dominio llevan @Expose). Nunca se castea la fila con `as`.
    return Mapper(__Entidad__, row)
  }
}
