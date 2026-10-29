import { generateUuid } from '../../../../shared/utils/services/GeneratorUuidService'

type JsonApiResource = {
  type: string
  id: string
  attributes: any
  links: { self: string }
  relationships?: any
}

export class ResponseJsonApiBase {
  data: JsonApiResource | JsonApiResource[]

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
    const uuid = generateUuid()
    const arrayAttributes = Array.isArray(attributes)
      ? attributes
      : [attributes]

    const mapped = arrayAttributes.map((obj) => {
      const resource: JsonApiResource = {
        type,
        id: uuid,
        attributes: obj,
        links: { self: links }
      }
      if (relationships) {
        resource.relationships = relationships
      }
      return resource
    })

    this.data = mapped.length === 1 ? mapped[0] : mapped
  }
}
