import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { __Conexion____Motor__Option } from './options/__conexionKebab__.__motorOption__.option'

/**
 * Named TypeORM connection '<Conexion>Connection'. The engine is set in its options class.
 *
 * Entities are NOT listed here: each domain registers its own with
 * TypeOrmModule.forFeature([...], '<Conexion>Connection') in its infrastructure module and
 * `autoLoadEntities` (see the options class) loads them into this connection.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: '<Conexion>Connection',
      useClass: __Conexion____Motor__Option
    })
  ],
  providers: [__Conexion____Motor__Option],
  exports: [TypeOrmModule]
})
export class __Motor____Conexion__DatabaseModule {}
