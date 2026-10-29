import { generateUuid } from '../../../../shared/utils/services/GeneratorUuidService'

/**
 * Variante de respuesta JSON:API para un recurso individual.
 */
export class ResponseJson {
  attributes: any
  type: string
  id?: string
  links: object
  relationships?: any

  constructor({
    attributes,
    type,
    links,
    relationships
  }: {
    attributes: any
    type: string
    links: string
    relationships?: any
  }) {
    this.type = type
    this.id = generateUuid()
    this.attributes = attributes
    if (relationships) {
      this.relationships = relationships
    }
    this.links = { self: links }
  }
}
