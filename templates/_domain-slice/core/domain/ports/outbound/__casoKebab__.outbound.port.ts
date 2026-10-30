import { __Request__ } from '../../entities/__requestKebab__.entity'
import { __Entidad__ } from '../../entities/__entidadKebab__.entity'

// Puerto OUTBOUND (driven): lo que el caso de uso necesita de la fuente de datos.
// Refleja los mismos métodos que el inbound; el domain service delega 1:1.
export interface I__Caso__Repository {
  __metodo__(data: __Request__): Promise<__Entidad__>
}
