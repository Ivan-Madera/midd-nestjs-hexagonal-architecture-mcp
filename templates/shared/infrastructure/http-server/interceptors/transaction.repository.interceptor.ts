import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common'
import { Request } from 'express'
import { Observable, catchError, concatMap, finalize } from 'rxjs'
import { DataSource } from 'typeorm'
import { InjectDataSource } from '@nestjs/typeorm'
import Logger from '../../../ErrorEventManagement/logger/Logger.service'

export const ENTITY_MANAGER_KEY = 'ENTITY_MANAGER'

@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  // Ajusta el nombre de la conexión a la del servicio.
  constructor(
    @InjectDataSource('<Conexion>Connection') private dataSource: DataSource
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler<any>
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest<Request>()
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    Logger.info('------ SE INICIA LA TRANSACCIÓN ------')
    req[ENTITY_MANAGER_KEY] = queryRunner.manager

    return next.handle().pipe(
      concatMap(async (data) => {
        Logger.info('------ LA TRANSACCIÓN SE HA COMPLETADO CORRECTAMENTE ------')
        await queryRunner.commitTransaction()
        return data
      }),
      catchError(async (e) => {
        Logger.error('------ LA TRANSACCIÓN NO SE COMPLETÓ POR UNA EXCEPCIÓN ------')
        await queryRunner.rollbackTransaction()
        throw e
      }),
      finalize(async () => {
        await queryRunner.release()
      })
    )
  }
}
