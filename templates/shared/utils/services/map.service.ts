/**
 * Proyecta un objeto plano (p.ej. el resultado crudo de un SP) a una instancia
 * de la clase `target`, copiando las propiedades coincidentes.
 */
export const Mapper = <T>(target: new () => T, data: any): T => {
  const instance = new target()
  if (data && typeof data === 'object') {
    Object.assign(instance as object, data)
  }
  return instance
}
