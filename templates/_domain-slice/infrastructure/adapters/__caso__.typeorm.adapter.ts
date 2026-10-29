// Adapter TypeORM repository. Usa esta variante cuando el acceso a datos es
// vía repositorio de entidad. Para stored procedures, usa __caso__.sp.adapter.ts.
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { I__Caso__Repository } from '../../core/domain/ports/outbound/I__Caso__Repository'
import { __Entidad__EntityConfiguration } from '../sql-database/entities/__Entidad__.entity'
import { __Request__ } from '../../core/domain/entities/__Request__.entity'
import { __Entidad__ } from '../../core/domain/entities/__Entidad__.entity'

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
    // Mapea la entidad TypeORM a la entidad de dominio (son tipos distintos).
    return { ...row } as unknown as __Entidad__
  }
}
