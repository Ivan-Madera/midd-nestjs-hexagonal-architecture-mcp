import { randomUUID } from 'node:crypto'

/**
 * Genera un UUID v4 usando el módulo nativo `crypto` de Node (sin dependencias
 * externas). Usado por los contratos de respuesta JSON:API para el campo `id`.
 */
export const generateUuid = (): string => randomUUID()
