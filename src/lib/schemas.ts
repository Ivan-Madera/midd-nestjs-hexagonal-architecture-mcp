import { z } from 'zod'
import { MOTORES, SIN_BASE_DE_DATOS } from './engines.js'
import { ADAPTERS, HTTP_VERBS } from './adapters.js'

/**
 * Inputs comunes a las herramientas. `projectRoot` es la raíz del servicio
 * destino donde el MCP escribirá (modo A: escribe disco).
 */

export const projectRoot = z
  .string()
  .describe('Ruta absoluta de la raíz del servicio NestJS destino donde se escriben los archivos.')

export const dominio = z
  .string()
  .describe('Nombre del bounded context en PascalCase, p.ej. "Catalog".')

export const caso = z
  .string()
  .describe('Nombre del caso de uso en PascalCase, p.ej. "RetrieveProduct".')

export const entidad = z
  .string()
  .describe('Nombre de la entidad de dominio en PascalCase, p.ej. "Product".')

export const metodo = z
  .string()
  .describe('Método del puerto en camelCase, p.ej. "retrieveBySku".')

export const param = z
  .string()
  .describe('Parámetro principal del método en camelCase, p.ej. "sku". (Legado: usado solo para el fixture del test generado.)')

export const request = z
  .string()
  .optional()
  .describe(
    'Entidad de dominio request del método principal en PascalCase, p.ej. "RetrieveProductRequest". Canon: los métodos del puerto reciben una entidad tipada, no un string. Por defecto <Caso>Request.'
  )

export const accion = z
  .string()
  .describe('Ruta del endpoint POST (camel o kebab), p.ej. "retrieveProduct".')

export const prefijoError = z
  .string()
  .describe(
    'Prefijo de errores de la API en mayúsculas. Por ejemplo, CATALOG. Los errores quedarán como CATALOG-PRODUCTNOTFOUND-001; el número va de 001 a 999 y lo asigna el MCP en secuencia por prefijo.'
  )

export const conexion = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]{0,47}$/, 'PascalCase, solo letras y numeros, p.ej. "Mssql2".')
  .optional()
  .describe(
    'OPCIONAL: no se le pregunta al usuario. Sin valor, la conexión se llama como su motor (Mssql, Postgres, Mysql): se reutiliza la única conexión de ese motor o se crea una nueva. Pásalo solo para una conexión ADICIONAL de un motor que ya tiene una (Mssql2, Mssql3; inspect_project dice cuál toca) y solo si el usuario la pide. En refactor NO lo pases: la conexión del proyecto se detecta y se reutiliza (solo si el proyecto tiene varias, indica cuál). PascalCase, sin el sufijo Connection.'
  )

export const prefijoApi = z
  .string()
  .describe(
    'Prefijo de la API en kebab-case. Por ejemplo, midd-catalog. Los endpoints quedarán como /<prefijo>/api/v1/{recurso}. Se guarda como API_CONTEXT (prefijo global). Pregúntalo como "prefijo de la API", no como prefijo del servicio.'
  )

export const adapterType = z
  .enum(ADAPTERS)
  .default('typeorm')
  .describe(
    'Tipo de acceso a datos. "typeorm" por defecto. "sp" (stored procedure) es OPT-IN: requiere nombreSp. "http" consume una API externa con fetch nativo y NO usa base de datos: requiere apiExterna y rutaApi (y no necesita conexion ni motor).'
  )
export const apiExterna = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]{0,47}$/, 'PascalCase, solo letras y numeros, p.ej. "ExchangeRates".')
  .optional()
  .describe(
    'Solo adapterType="http": nombre PascalCase de la API externa, p.ej. "ExchangeRates". Su URL base vive en la variable de entorno <NOMBRE>_BASE_URL (EXCHANGE_RATES_BASE_URL), validada con Joi al arrancar.'
  )
export const rutaApi = z
  .string()
  .optional()
  .describe('Solo adapterType="http": ruta del endpoint de la API externa que llama el metodo, empieza con "/", sin query string, p.ej. "/rates".')
export const metodoHttp = z
  .enum(HTTP_VERBS)
  .optional()
  .describe('Solo adapterType="http": verbo de la llamada. GET (default) envia la request como query string; POST y PUT la envian como cuerpo JSON.')

export const nombreSp = z
  .string()
  .optional()
  .describe(
    'Nombre del stored procedure (solo si adapterType="sp"). El MCP lo registra en ConfigurationVariables.storedProcedures + joiSchema + .env.example.'
  )

export const envVarSp = z
  .string()
  .optional()
  .describe(
    'Nombre de la variable de entorno que porta el SP (MAYÚSCULAS, solo si adapterType="sp"). Por defecto se deriva de nombreSp como <NOMBRE_SP>_SP.'
  )

export const overwrite = z
  .boolean()
  .default(false)
  .describe('Si true, sobrescribe archivos existentes. Por defecto false (no pisa).')

export const mode = z
  .enum(['greenfield', 'refactor'])
  .default('greenfield')
  .describe(
    'Modo de generación. "greenfield" (default): servicio nuevo, cablea app.module y mergea módulos del dataset. "refactor": proyecto existente — NO toca app.module ni módulos ajenos; genera el slice hexagonal para que el agente lo adapte a la infra del proyecto.'
  )

export const connectionStyle = z
  .enum(['named', 'default'])
  .default('named')
  .describe(
    'Forma de la conexión TypeORM del proyecto. "named" (default): conexión nombrada (<Conexion>Connection). "default": conexión por defecto de forRoot (los adapters no inyectan nombre de conexión). Úsalo según lo que reporte inspect_project.'
  )

export const infraStyle = z
  .enum(['dataset', 'project'])
  .default('dataset')
  .describe(
    'Capa de infraestructura transversal (logger, excepciones, respuesta JSON:API base, config) que importan los archivos generados. "dataset" (default, greenfield): usa la capa shared del dataset (src/shared/*). "project" (refactor): los imports apuntan a la carpeta de infra propia del proyecto (ver infraRoot); el agente aún debe conciliar los NOMBRES de símbolo (p.ej. ResponseJsonApiBase vs ResponseJsonApi del proyecto).'
  )

export const infraRoot = z
  .string()
  .optional()
  .describe(
    'Solo con infraStyle="project": carpeta (relativa a src/) de la infra transversal propia del proyecto que reemplaza a "shared" en los imports generados, p.ej. "common". Por defecto "common".'
  )

export const motor = z
  .enum([...MOTORES, SIN_BASE_DE_DATOS])
  .describe(
    'Motor de base de datos: mssql (SQL Server), postgres (PostgreSQL) o mysql (MySQL), o "none" si el servicio NO usa base de datos (no se crea ninguna conexión, ni módulo, ni variables, ni driver). SIEMPRE se le pregunta al usuario: no hay default. Define el tipo de TypeORM, el driver, el puerto y la sintaxis de los stored procedures.'
  )
export const crearConexion = z
  .boolean()
  .default(false)
  .describe(
    'SOLO refactor, y SOLO si el usuario pidio EXPRESAMENTE crear una conexion. Un refactor reutiliza la conexion que el proyecto ya tiene y, si no tiene ninguna, NO crea una por su cuenta. Con true el MCP crea la conexion completa, nombrada por el motor, asi que tambien hay que pasar el motor (se le pregunta al usuario si no lo dijo).'
  )
export const motorOpcional = motor
  .optional()
  .describe(
    'Motor de la conexión. Greenfield: obligatorio si la conexión es nueva (el MCP la crea completa); "none" = sin base de datos (rechaza adapters TypeORM/SP). Refactor: solo se pasa, junto con "conexion", cuando el usuario pidió EXPRESAMENTE crear una conexión que el proyecto no tiene; si no, se reutiliza la del proyecto y el motor se ignora. Valores: mssql | postgres | mysql | none.'
  )
