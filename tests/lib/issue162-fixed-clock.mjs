// Test-only reproduction preload; no production files are modified.
const NativeDate = globalThis.Date
const fixed = NativeDate.parse(process.env.ISSUE162_FIXED_NOW)
if (!Number.isFinite(fixed)) throw Error('ISSUE162_FIXED_NOW requires an ISO timestamp')
globalThis.Date = class FixedDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [fixed])) }
  static now() { return fixed }
}
// debugInfo derives startTime from now - uptime. Make that fixture exact.
process.uptime = () => 0
