import { Request } from 'express'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { ENTITY_MANAGER_KEY } from '../../http-server/interceptors/transaction.repository.interceptor'

/**
 * Repositorio base: resuelve el Repository<T> desde el EntityManager de la
 * transacción en curso (adjuntado al request por el TransactionInterceptor), o
 * del DataSource si no hay transacción activa.
 */
export class BaseRepository {
  constructor(private dataSource: DataSource, private request: Request) {}

  protected getRepository<T>(entityCls: new () => T): Repository<T> {
    const entityManager: EntityManager =
      this.request[ENTITY_MANAGER_KEY] ?? this.dataSource.manager
    return entityManager.getRepository(entityCls)
  }
}
