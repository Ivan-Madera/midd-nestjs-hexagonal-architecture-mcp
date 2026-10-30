import { __Request__ } from '../../domain/entities/__requestKebab__.entity'
import { __Entidad__ } from '../../domain/entities/__entidadKebab__.entity'

export interface I__Caso__Application {
  __casoDeUso__(attributes: __Request__): Promise<__Entidad__>
}
