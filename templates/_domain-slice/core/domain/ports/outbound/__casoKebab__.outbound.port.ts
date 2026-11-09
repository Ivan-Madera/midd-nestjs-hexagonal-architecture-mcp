import { __Request__ } from '../../entities/__requestKebab__.entity'
import { __Entidad__ } from '../../entities/__entidadKebab__.entity'

export interface I__Caso__Repository {
  __metodo__(data: __Request__): Promise<__Entidad__>
}
