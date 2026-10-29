export const __Dominio__DomainError = {
  '__ERROR_KEY__': {
    message: 'Mensaje técnico con {placeholders} si aplica.',
    code: '<PREFIJO>-<SLUG>-0001',
    title: 'Título legible del error.',
    status: 404,
    suggestedActions: 'Acción sugerida para el consumidor del API.'
  },
  default: {
    message: 'Mensaje genérico de fallo.',
    code: '<PREFIJO>-GENERIC-0000',
    title: 'Error',
    status: 500,
    suggestedActions: 'Revise los logs del servicio.'
  }
}
