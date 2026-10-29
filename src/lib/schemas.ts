import { z } from 'zod'
import { MOTORES } from './engines.js'

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
  .describe('Prefijo de los códigos de error del servicio en MAYÚSCULAS, p.ej. "CATALOG".')

export const conexion = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]{0,47}$/, 'PascalCase, solo letras y numeros, p.ej. "Catalog".')
  .describe('Nombre de la conexión TypeORM en PascalCase (sin el sufijo Connection), p.ej. "Catalog".')

export const prefijoServicio = z
  .string()
  .describe(
    'Context of the service (kebab-case), e.g. "midd-catalog". It becomes API_CONTEXT, the global prefix, so endpoints are /<prefijoServicio>/api/v{N}/{resource}.'
  )

export const adapterType = z
  .enum(['typeorm', 'sp'])
  .default('typeorm')
  .describe(
    'Tipo de acceso a datos. "typeorm" por defecto. "sp" (stored procedure) es OPT-IN: requiere nombreSp.'
  )

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
  .enum(MOTORES)
  .describe(
    'Motor de base de datos de la conexión: mssql (SQL Server), postgres (PostgreSQL) o mysql (MySQL). SIEMPRE se le pregunta al usuario: no hay default. Define el tipo de TypeORM, el driver, el puerto y la sintaxis de los stored procedures.'
  )
export const motorOpcional = motor
  .optional()
  .describe(
    'Motor de la conexión. OBLIGATORIO si la conexión es nueva (el MCP la crea completa); se ignora si ya existe, y si no coincide con el motor existente se rechaza. Valores: mssql | postgres | mysql.'
  )
