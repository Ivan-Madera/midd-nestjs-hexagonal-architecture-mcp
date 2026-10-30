/**
 * Naming of everything the MCP generates.
 *
 * One convention, used everywhere, so a name is never decided in two places:
 *   - folders and files ........ kebab-case, with a dotted type suffix: retrieve-product.controller.ts
 *   - classes, interfaces, types  PascalCase: RetrieveProductController, IRetrieveProductService (I prefix = area canon)
 *   - variables, methods, params  camelCase: retrieveProduct
 *   - constants and env vars ... UPPER_SNAKE_CASE: RETRIEVE_PRODUCT_APPLICATION
 *   - URL paths ................ kebab-case segments (the action of an endpoint keeps the camelCase the area uses)
 *
 * The names of a module, an entity or a use case are written in ENGLISH (the code is in English).
 */

/** The words of a name written in any case: "TiendaConfig", "tienda-config", "tienda_config" -> ["tienda", "config"]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/** kebab-case: "RetrieveIMEIStatus" -> "retrieve-imei-status". */
export const toKebab = (name: string): string => nameWords(name).join('-')

const capitalizeWord = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
const hasSeparator = (name: string): boolean => /[^A-Za-z0-9]/.test(name)

/**
 * PascalCase. A name that already is one word-run ("RetrieveIMEIStatus") keeps its letters (an acronym stays an
 * acronym); a name with separators ("tienda-configuracion") is rebuilt from its words.
 */
export const toPascal = (name: string): string =>
  hasSeparator(name) ? nameWords(name).map(capitalizeWord).join('') : name.charAt(0).toUpperCase() + name.slice(1)

/** camelCase, with the same rule as toPascal. */
export const toCamel = (name: string): string => {
  const pascal = toPascal(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/** UPPER_SNAKE_CASE: "RetrieveProduct" -> "RETRIEVE_PRODUCT". */
export const toUpperSnake = (name: string): string => nameWords(name).join('_').toUpperCase()

/**
 * Property name of a class field that comes from a column or a key of the source ("tipo_bloqueo", "PFM_Id",
 * "IMEIStatus" -> tipoBloqueo, pfmId, imeiStatus). camelCase is what the TypeScript style guides use for properties
 * (PascalCase is for classes and types). The words stay as they come (Spanish stays Spanish); only the case changes.
 */
export const toPropertyName = (name: string): string => {
  const words = nameWords(name)
  return words.map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))).join('')
}
/** Folder of a domain under src/: always kebab-case ("StoreConfiguration" and "store-configuration" are the same). */
export const domainFolder = (domain: string): string => toKebab(domain)

/** Is it a valid file or folder name of the convention? Folders: words and dashes. Files: dotted parts, each kebab. */
export const isKebabSegment = (segment: string): boolean => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(segment)
export const isKebabFileName = (fileName: string): boolean =>
  /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*\.(ts|tsx|js|mjs|json)$/.test(fileName)
