import { configValidationSchema } from './joiSchema'

/**
 * Valida las variables de entorno contra el esquema Joi al arrancar la app.
 * Lanza y detiene el bootstrap si falta o es inválida alguna variable requerida.
 */
export const validateEnv = (config: Record<string, unknown>) => {
  const { error, value } = configValidationSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false
  })

  if (error) {
    throw new Error(`Error en la validación de variables de entorno: ${error.message}`)
  }

  return value
}
