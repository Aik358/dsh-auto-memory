const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const escapeStrings = /(?:\x1b[\]PX^_]|[\x90\x98\x9d-\x9f])[^\x07\x1b\x9c\r\n]*(?:\x07|\x1b\\|\x9c|(?=[\x1b\r\n]|$))/g
const escapeSequences = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?|\x1b[ -/]*[0-~]/g
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g

export function clean(value) {
  return String(value ?? '').replace(escapeStrings, '').replace(escapeSequences, '')
    .replace(/\r\n?/g, '\n').replace(controls, '').replace(/\t/g, '    ')
}

export function singleLine(value) {
  return clean(value).replace(/\n/g, ' ')
}

function glyphWidth(glyph) {
  if (/^[\p{Mark}\p{Cf}]+$/u.test(glyph)) return 0
  if (/\p{Emoji_Presentation}|\uFE0F|\u20E3/u.test(glyph)) return 2
  const code = glyph.codePointAt(0)
  return Number(code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) || (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x16fe0 && code <= 0x18dff) ||
    (code >= 0x1aff0 && code <= 0x1b2ff) || (code >= 0x20000 && code <= 0x3fffd)
  )) + 1
}

function* glyphs(text) {
  if (/^[\x20-\x7e]*$/.test(text)) yield* text
  else for (const { segment } of graphemes.segment(text)) yield segment
}

export function cells(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text.length
  let width = 0
  for (const glyph of glyphs(text)) width += glyphWidth(glyph)
  return width
}

export function clip(text, width, marker = '') {
  if (cells(text) <= width) return text
  const available = width - marker.length
  if (available < 0) return ''
  let output = ''
  let used = 0
  for (const glyph of glyphs(text)) {
    used += glyphWidth(glyph)
    if (used > available) break
    output += glyph
  }
  return output + marker
}

export function wrap(text, width) {
  if (cells(text) <= width) return [text]
  const lines = []
  let line = ''
  let used = 0
  for (const word of text.match(/\S+| +/g) ?? []) {
    const size = cells(word)
    if (size <= width && used + size > width && word.trim() && line.trim()) {
      lines.push(line.trimEnd())
      line = ''
      used = 0
    }
    for (const glyph of glyphs(word)) {
      const size = glyphWidth(glyph)
      if (used + size > width && line) {
        lines.push(line)
        line = ''
        used = 0
      }
      line += glyph
      used += size
    }
  }
  if (line) lines.push(line)
  return lines
}

export function documentLines(value, width) {
  const lines = []
  function add(text, depth, heading = false) {
    const prefix = '  '.repeat(Math.min(depth, Math.floor(width / 8)))
    for (const logical of clean(text).split('\n')) {
      // Keep fenced code, punctuation, and original heading levels readable in plain terminals.
      const isHeading = /^\s*#{1,6}\s/.test(logical)
      for (const line of wrap(logical, width - prefix.length)) {
        lines.push({ text: prefix + line, style: heading || isHeading ? 'strong' : undefined })
      }
    }
  }
  function visit(data, depth) {
    if (Array.isArray(data)) {
      if (!data.length) add('（空列表）', depth)
      for (const [index, item] of data.entries()) {
        if (typeof item === 'string') add(`${index + 1}. ${item}`, depth)
        else {
          add(`${index + 1}.`, depth, true)
          visit(item, depth + 1)
        }
      }
    } else if (data !== null && typeof data === 'object') {
      const entries = Object.entries(data)
      if (!entries.length) add('{}', depth)
      for (const [key, item] of entries) {
        if (typeof item === 'string' && (item.includes('\n') || cells(singleLine(item)) > width)) {
          add(key, depth, true)
          visit(item, depth + 1)
        } else if (item !== null && typeof item === 'object') {
          add(key, depth, true)
          visit(item, depth + 1)
        } else {
          add(`${singleLine(key)}  ${item === null ? 'null' : item}`, depth)
        }
      }
    } else add(data === null ? 'null' : data ?? '（无返回数据）', depth)
  }
  visit(value, 0)
  return lines
}

export function previousGlyph(text, cursor) {
  return cursor ? graphemes.segment(text).containing(cursor - 1).index : 0
}

export function nextGlyph(text, cursor) {
  const item = graphemes.segment(text).containing(cursor)
  return item ? item.index + item.segment.length : text.length
}
