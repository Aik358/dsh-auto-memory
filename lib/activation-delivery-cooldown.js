export const ACTIVATION_DELIVERY_COOLDOWN_OPTIONS_MINUTES_PRE_V2 = Object.freeze([1, 2, 3, 4, 5])

export function normalizeActivationDeliveryCooldownMinutesPre(value) {
  if (value === null || value === undefined || value === 'off' || value === '') return null
  return Number.isSafeInteger(value) && ACTIVATION_DELIVERY_COOLDOWN_OPTIONS_MINUTES_PRE_V2.includes(value)
    ? value : null
}
