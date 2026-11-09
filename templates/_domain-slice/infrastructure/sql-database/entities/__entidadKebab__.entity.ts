import { Entity, Column, PrimaryColumn } from 'typeorm'

// TODO(midd): pon la tabla y las columnas reales en lugar de '<nombre_tabla>' y '<columna>'.
@Entity('<nombre_tabla>')
export class __Entidad__EntityConfiguration {
  @PrimaryColumn({ name: '<columna>' })
  __param__: string

}
