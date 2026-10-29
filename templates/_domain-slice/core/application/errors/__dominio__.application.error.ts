export const __Dominio__ApplicationError = {
  '__ERROR_KEY__': {
    code: '<PREFIJO>-<SLUG>-0001',
    title: 'Título legible del error de aplicación.',
    status: 400,
    suggestedActions: 'Acción sugerida para el consumidor del API.'
  },
  default: {
    code: '<PREFIJO>-GENERIC-0000',
    title: 'Error',
    status: 500,
    suggestedActions: 'Revise los logs del servicio.'
  }
}
