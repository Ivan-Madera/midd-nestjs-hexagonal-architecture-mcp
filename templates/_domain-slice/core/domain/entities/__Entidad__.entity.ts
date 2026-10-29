// Entidad de dominio pura (sin decoradores TypeORM). Representa un concepto
// del negocio dentro del bounded context <Dominio>.
//
// Convención: declara los campos como OPCIONALES (con `?`). La entidad de
// dominio suele poblarse por mapeo parcial desde un adapter o un mock, así que
// forzar campos requeridos rompe esos usos. Marca como requerido solo lo que
// SIEMPRE esté presente en todos los flujos. Para mapear columnas de BD
// (snake_case) usa @Expose({ name: '<columna>' }) de class-transformer.
export class __Entidad__ {
  // Define aquí las propiedades del modelo de dominio (opcionales por defecto).
  // ejemplo:
  // id?: string
  // __param__?: string
}
