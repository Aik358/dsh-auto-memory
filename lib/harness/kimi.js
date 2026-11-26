export const KIMI_HOOK_EVENTS = Object.freeze([
  'SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact', 'PostCompact',
])

export const CLOUD_CODE_HOOK_EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'])

export function normalizeKimiHookInput(payload) {
  // Kimi's turn counter starts at zero. The shared lifecycle contract uses string IDs.
  const turnId = payload.turn_id
  if (Number.isSafeInteger(turnId) && turnId >= 0) return { ...payload, turn_id: String(turnId) }
  return payload
}

export function formatKimiHookOutput(result) {
  // Kimi ignores observation-only hook output and reads "message" for prompt hooks.
  if (result?.status !== 'accepted' || result.event?.name !== 'UserPromptSubmit') return ''
  const context = result.output?.hookSpecificOutput?.additionalContext
  if (typeof context !== 'string' || !context.trim()) return ''
  return JSON.stringify({ message: context }) + '\n'
}
