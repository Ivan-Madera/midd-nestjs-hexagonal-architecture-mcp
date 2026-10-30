import { envVarApiBaseUrl, httpCallExpression, isHttpVerb } from './adapters.js'
import { formatErrorNumber } from './errorCodes.js'
/**
 * Sustitución de placeholders case-sensitive.
 *
 * Aprendizaje clave de la validación en sandbox: `__Caso__`, `__caso__` y
 * `__CASO__` son marcadores DISTINTOS. Un reemplazo case-insensitive los
 * confunde y rompe el código generado. Aquí reemplazamos con String.replaceAll
 * (sensible a mayúsculas) y en orden de más específico a menos, para evitar
 * solapamientos.
 */

export type PlaceholderMap = Record<string, string>

/** UPPER_SNAKE_CASE of a name (RetrieveProduct -> RETRIEVE_PRODUCT). */
const toUpperSnake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toUpperCase()

/**
 * Env var that holds the name of a stored procedure (GetProductBySku -> GET_PRODUCT_BY_SKU_SP).
 * Single source of truth: the principal SP of a use case and the SPs of its extra methods
 * MUST resolve to the same name in ConfigurationVariables, joiSchema and .env.example.
 */
export function deriveEnvVarSp(nombreSp: string): string {
  const snake = toUpperSnake(nombreSp)
  return /(_SP|SP)$/.test(snake) ? snake : `${snake}_SP`
}

/**
 * Deriva el mapa de placeholders estándar a partir de los nombres de negocio.
 * Cubre los marcadores del dataset `_domain-slice/`.
 */
export function buildPlaceholderMap(input: {
  dominio: string // nombre del dominio; cualquier case. Clases -> PascalCase, carpeta/ruta -> lowercase
  caso: string // PascalCase, p.ej. "RetrieveProduct"
  entidad: string // PascalCase, p.ej. "Product"
  metodo: string // camelCase, p.ej. "retrieveBySku"
  param: string // camelCase, p.ej. "sku"
  accion: string // kebab/camel para la ruta POST, p.ej. "retrieveProduct"
  prefijoError: string // MAYUSCULAS, p.ej. "CATALOG"
  rutaDominio: string // kebab-case, p.ej. "catalog"
  tipoRecurso: string // kebab-case JSON:API, p.ej. "product"
  conexion: string // nombre de conexion TypeORM en PascalCase, p.ej. "Catalog"
  servicio?: string // prefijo del servicio para setGlobalPrefix, p.ej. "midd-catalog"
  errorKey?: string // llave del catalogo, p.ej. "PRODUCT_NOT_FOUND"
  errorNumApp?: number // numero (001-999) del error del catalogo de aplicacion; lo asigna la secuencia del prefijo
  errorNumDom?: number // numero (001-999) del error del catalogo de dominio
  slug?: string // slug del codigo de error, p.ej. "PRODUCTNOTFOUND"
  attributes?: string // clase de attributes, por defecto `${caso}Attributes`
  respuesta?: string // tipo de retorno, por defecto = entidad
  request?: string // entidad request del método principal, por defecto `${caso}Request`
  nombreSp?: string // nombre del SP si adapterType === 'sp'
  envVarSp?: string // nombre de la env var del SP, p.ej. "RETRIEVE_PRODUCT_SP"
  apiExterna?: string // adapter http: nombre PascalCase de la API externa, p.ej. "ExchangeRates"
  rutaApi?: string // adapter http: ruta del metodo principal en la API externa, p.ej. "/rates"
  metodoHttp?: string // adapter http: GET | POST | PUT (GET por defecto)
  connectionStyle?: 'named' | 'default' // forma de la conexión TypeORM del proyecto
  infraStyle?: 'dataset' | 'project' // capa de infra transversal de los imports
  infraRoot?: string // carpeta de infra propia (project), por defecto "common"
}): PlaceholderMap {
  const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
  // PascalCase: primera letra a mayúscula, resto preservado. Normaliza el input
  // para que los nombres de CLASE no dependan del case con que llegó `dominio`
  // (p.ej. "setups" -> "Setups"), evitando el choque con carpetas lowercase en
  // sistemas de archivos case-insensitive (Windows).
  const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const upperSnake = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toUpperCase()

  // Nombre de dominio para CLASES (PascalCase) separado del de CARPETA/RUTA
  // (lowercase). Un único arg `dominio` ya no fuerza ambos al mismo case.
  const dominioClase = pascal(input.dominio)
  const dominioCarpeta = input.dominio.toLowerCase()

  const attributes = input.attributes ?? `${input.caso}Attributes`
  const respuesta = input.respuesta ?? input.entidad
  // Entidad request del método principal. Canon: los métodos del puerto reciben
  // una entidad de dominio tipada (p.ej. RetrieveLockTypeTvRequest), nunca un
  // `string` suelto. Por defecto <Caso>Request.
  const request = input.request ?? `${input.caso}Request`
  const errorKey = input.errorKey ?? `${upperSnake(input.entidad)}_ERROR`
  const slug = input.slug ?? input.entidad.toUpperCase()
  const nombreSp = input.nombreSp ?? input.caso
  const envVarSp = input.envVarSp ?? deriveEnvVarSp(nombreSp)
  // External API (adapter http): its base URL lives in <NAME>_BASE_URL and the call is built once, for the template.
  const apiExterna = input.apiExterna ?? 'ExternalApi'
  const verbo = (input.metodoHttp ?? 'GET').toUpperCase()
  const llamadaHttp = httpCallExpression(isHttpVerb(verbo) ? verbo : 'GET', input.rutaApi ?? `/${input.accion}`)
  const servicio = input.servicio ?? camel(dominioClase)
  // Argumento de conexión para @InjectRepository/forFeature: named añade el
  // segundo arg "'<Conexion>Connection'"; default lo omite (conexión por defecto).
  const conexionArg =
    input.connectionStyle === 'default' ? '' : `, '${input.conexion}Connection'`

  // Segmento de carpeta de la infra transversal en los imports generados.
  // dataset -> "shared" (capa del dataset); project -> infraRoot del proyecto
  // (por defecto "common"). Solo cambia el PATH; los nombres de símbolo los
  // concilia el agente en refactor.
  const sharedRoot =
    input.infraStyle === 'project' ? (input.infraRoot || 'common') : 'shared'



  // Orden: primero los de contenido/código, luego los textuales <X>.
  // El motor de reemplazo ya ordena por longitud; aquí solo definimos valores.
  return {
    // Identificadores de código (y nombres de archivo)
    __Dominio__: dominioClase,
    __dominio__: camel(dominioClase),
    __CASO__: upperSnake(input.caso),
    __Caso__: input.caso,
    __caso__: camel(input.caso),
    __Entidad__: input.entidad,
    __Attributes__: attributes,
    __Respuesta__: respuesta,
    __Request__: request,
    __metodo__: input.metodo,
    __param__: input.param,
    __casoDeUso__: camel(input.caso),
    __accion__: input.accion,
    __ERROR_KEY__: errorKey,
    __NombreSp__: nombreSp,
    __ENV_VAR_SP__: envVarSp,
    __ApiExterna__: apiExterna,
    __ENV_VAR_API__: envVarApiBaseUrl(apiExterna),
    __HTTP_CALL__: llamadaHttp,
    // Nombre de conexion como identificador (clase/archivo) y camel (archivo)
    __Conexion__: input.conexion,
    __conexion__: camel(input.conexion),
    // Valores textuales no-identificador
    '<ConexionArg>': conexionArg,
    '<Conexion>': input.conexion,
    '<conexion>': camel(input.conexion),
    '<Dominio>': dominioClase,
    '<dominio>': camel(dominioClase),
    '<servicio>': servicio,
    '<PREFIJO>': input.prefijoError,
    '<SLUG>': slug,
    '<ERR_NUM_APP>': formatErrorNumber(input.errorNumApp ?? 1),
    '<ERR_NUM_DOM>': formatErrorNumber(input.errorNumDom ?? 1),
    '<ruta-dominio>': input.rutaDominio,
    '<tipo-recurso>': input.tipoRecurso,
    // Carpeta de infra transversal en los imports (shared | common | ...).
    '<sharedRoot>': sharedRoot,
    // A stored procedure adapter injects the database service of ITS connection. The generic token is
    // only the first connection registered, so a second connection would silently use the wrong database.
    // In a refactor the project has its own utils module, which only knows the generic token.
    '<dbTokenImport>': input.infraStyle === 'project' ? 'DATABASE_COMMON_PROCESS_SERVICES_ADAPTER' : 'databaseServiceToken',
    '<dbTokenExpr>':
      input.infraStyle === 'project'
        ? 'DATABASE_COMMON_PROCESS_SERVICES_ADAPTER'
        : `databaseServiceToken('${input.conexion}')`
  }
}

/**
 * Aplica el mapa de placeholders a un texto, de forma case-sensitive.
 * Reemplaza las llaves más largas primero para evitar solapamientos
 * (p.ej. `__CASO__` antes que un hipotético `__CAS__`).
 */
export function substitute(text: string, map: PlaceholderMap): string {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    out = out.split(key).join(map[key])
  }
  return out
}

/**
 * Aplica el mapa a un nombre de archivo/carpeta (mismos marcadores `__X__`).
 */
export function substitutePath(pathSegment: string, map: PlaceholderMap): string {
  return substitute(pathSegment, map)
}
