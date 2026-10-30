import { z } from 'zod'
import { generateApiDocs, scanService } from '../lib/apiDocs.js'
import * as s from '../lib/schemas.js'

/**
 * generate_api_docs - writes the API documentation of the service from its real code.
 *
 * Always: the contract (src/<module>/contracts/<module>.api.md), the Mermaid sequence diagram
 * (src/<module>/diagrams/<module>.flow.mmd) and the index (docs/api/README.md).
 * Also always: docs/ARCHITECTURE.md (Mermaid architecture-beta overview). Nothing to ask: it is derived from the code.
 * Opt-in (the agent ASKS the user): the Postman collection.
 * It is safe to run any time: same code, same files.
 */
export const generateApiDocsSchema = {
  projectRoot: s.projectRoot,
  modules: z
    .array(z.string())
    .optional()
    .describe('Solo estos modulos (carpetas bajo src/). Por defecto todos los que tengan controllers.'),
  postman: z
    .boolean()
    .default(false)
    .describe(
      'Crear/actualizar docs/api/middleware.postman_collection.json (una coleccion, una carpeta por modulo, fusion sin tocar las demas). El agente debe PREGUNTAR al usuario antes de poner true. Si la coleccion ya existe se actualiza siempre.'
    ),
  architecture: z
    .boolean()
    .default(true)
    .describe(
      'Crear/actualizar docs/ARCHITECTURE.md con un diagrama Mermaid architecture-beta. Se genera siempre (no se pregunta al usuario); pon false solo si no se quiere.'
    )
}

export async function generateApiDocsTool(a: {
  projectRoot: string
  modules?: string[]
  postman: boolean
  architecture: boolean
}) {
  const service = scanService(a.projectRoot)
  if (service.modules.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'ERROR: no encontre controllers con @Controller y @Post bajo src/ (se ignora src/shared). Genera primero un caso de uso con add_use_case o generate_from_spec.'
        }
      ],
      isError: true
    }
  }
  const unknown = (a.modules ?? []).filter((m) => !service.modules.some((found) => found.module === m))
  if (unknown.length) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `ERROR: modulo(s) sin controllers: ${unknown.join(', ')}. Disponibles: ${service.modules.map((m) => m.module).join(', ')}.`
        }
      ],
      isError: true
    }
  }
  const result = generateApiDocs({
    projectRoot: a.projectRoot,
    modules: a.modules,
    postman: a.postman,
    architecture: a.architecture
  })
  const lines = [
    `Documentacion generada desde el codigo para: ${result.modules.join(', ')}.`,
    '',
    `Escritos (${result.written.length}):`,
    ...result.written.map((f) => `  + ${f}`),
    result.unchanged.length ? `Sin cambios (${result.unchanged.length}): ${result.unchanged.join(', ')}` : '',
    '',
    'Siguientes pasos:',
    '  - Los archivos se regeneran desde el codigo: no los edites a mano.',
    '  - Vuelve a correr esta herramienta (o record_architecture) cuando cambien controllers, DTOs o errores.',
    a.postman || result.written.some((f) => f.endsWith('postman_collection.json'))
      ? '  - Postman: define las variables baseUrl y token de la coleccion.'
      : '  - Postman: no se genero. Si el usuario la quiere, vuelve a llamar con postman=true.'
  ]
  return { content: [{ type: 'text' as const, text: lines.filter((l) => l !== '').join('\n') }] }
}
