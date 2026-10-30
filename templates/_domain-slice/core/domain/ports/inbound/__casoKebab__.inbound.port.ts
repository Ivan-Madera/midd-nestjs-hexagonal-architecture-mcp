import { __Request__ } from '../../entities/__requestKebab__.entity'
import { __Entidad__ } from '../../entities/__entidadKebab__.entity'

// Puerto INBOUND (driving): lo que el caso de uso ofrece hacia el interior.
// Hexagonal puro: cada método recibe una entidad de dominio request tipada y
// devuelve una entidad response. El puerto NO conoce detalles de infraestructura
// (p.ej. nombres de stored procedure). Un puerto puede exponer N métodos.
export interface I__Caso__Service {
  __metodo__(data: __Request__): Promise<__Entidad__>
}
