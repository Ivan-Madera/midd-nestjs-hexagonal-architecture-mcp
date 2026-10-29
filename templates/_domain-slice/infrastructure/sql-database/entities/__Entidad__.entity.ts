import { Entity, Column, PrimaryColumn } from 'typeorm'

// Entidad TypeORM: mapea una tabla a columnas. El nombre de clase lleva el
// sufijo EntityConfiguration. Ajusta el nombre de tabla y las columnas reales
// de la BD. La columna del parámetro del caso se usa como clave de búsqueda.
// TODO: replace '<nombre_tabla>' and '<columna>' with the real table and column names of the database.
// The entity is loaded into its connection automatically (autoLoadEntities), nothing else to register.
@Entity('<nombre_tabla>')
export class __Entidad__EntityConfiguration {
  @PrimaryColumn({ name: '<columna>' })
  __param__: string

  // Añade aquí el resto de columnas de la tabla, p.ej.:
  // @Column({ type: 'varchar', name: '<columna_nombre>' })
  // nombre: string
}
