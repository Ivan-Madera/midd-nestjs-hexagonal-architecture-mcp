// Entrada del método principal del caso __Caso__ como entidad de dominio PURA
// (sin decoradores). Es el contrato que ven la capa application y el dominio:
// tipos del core, nunca el DTO de infraestructura. El DTO de validación HTTP
// (infrastructure/.../dto) expone estos campos y se mapea a esta forma en el
// controller.
export class __Request__ {
  __param__: string
}
