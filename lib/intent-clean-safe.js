/** Remove runtime envelopes only at unquoted line boundaries; preserve literal examples/code. */
const tags = new Set(['memory_system', 'system-reminder', 'long_term_memory'])
export function stripRuntimeIntentPre(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  const out = [], stack = []
  let fence = null
  for (let line of lines) {
    const trimmed = line.trim()
    if (!stack.length) {
      const f = /^( {0,3})(`{3,}|~{3,})/.exec(line)
      if (f) {
        if (!fence) fence = { char: f[2][0], size: f[2].length }
        else if (f[2][0] === fence.char && f[2].length >= fence.size && /^( {0,3})(`+|~+)\s*$/.test(line)) fence = null
        out.push(line); continue
      }
      if (fence || /^\s*>/.test(line) || /^ {4}/.test(line)) { out.push(line); continue }
      if (/^(?:current runtime context\.|current dsh file policy:)/i.test(trimmed)) continue
    }
    // Consume one or more envelopes at the beginning of an unquoted line.
    // Closing tags can end a prefix split across messages; trailing human text is retained.
    for (;;) {
      if (stack.length) {
        const token = /<(\/?)(memory_system|system-reminder|long_term_memory)>/.exec(line)
        if (!token) { line = ''; break }
        line = line.slice(token.index + token[0].length)
        if (!token[1]) stack.push(token[2])
        else if (stack[stack.length - 1] === token[2]) stack.pop()
        continue
      }
      const open = /^\s*<(memory_system|system-reminder|long_term_memory)>/.exec(line)
      if (open && tags.has(open[1])) { stack.push(open[1]); line = line.slice(open[0].length); continue }
      const close = /^\s*<\/(memory_system|system-reminder|long_term_memory)>/.exec(line)
      if (close) { line = line.slice(close[0].length); continue }
      break
    }
    if (line.trim()) out.push(line)
    else if (!stack.length && !trimmed) out.push('')
  }
  return out.join('\n')
}
