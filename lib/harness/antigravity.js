export const ANTIGRAVITY_HOOK_EVENTS = Object.freeze(['SessionStart', 'PreInvocation', 'Stop'])

export function formatAntigravityHookOutput(result) {
  const context = result?.output?.hookSpecificOutput?.additionalContext
  if (result?.event?.name === 'Stop') return '{"decision":"stop"}\n'
  if (result?.status === 'accepted' && typeof context === 'string' && context.trim()) {
    return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: context } }] }) + '\n'
  }
  return '{}\n'
}
