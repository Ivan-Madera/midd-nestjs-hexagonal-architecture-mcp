// Entidad de dominio pura (sin decoradores TypeORM). Representa un concepto
// del negocio dentro del bounded context <Dominio>.
//
// Convención: declara los campos como OPCIONALES (con `?`). La entidad de
// dominio suele poblarse por mapeo parcial desde un adapter o un mock, así que
// forzar campos requeridos rompe esos usos. Marca como requerido solo lo que
// SIEMPRE esté presente en todos los flujos.
//
// Mapeo desde la fuente (el adapter usa Mapper = plainToInstance + excludeExtraneousValues: un campo SIN
// @Expose se pierde):
//   - propiedades en camelCase y con las palabras tal como vienen de la fuente (tipo_bloqueo -> tipoBloqueo)
//   - stored procedure o API externa: @Expose({ name: 'tipo_bloqueo' }) (nombre como lo envía la fuente)
//   - TypeORM: @Expose() (mismo nombre que la propiedad de la entidad TypeORM)
//   import { Expose } from 'class-transformer'
export class __Entidad__ {
  // Define aquí las propiedades del modelo de dominio (opcionales por defecto).
  // ejemplo:
  // id?: string
  // __param__?: string
}
