import { cells, clip, singleLine } from './tui-text.js'

const ESC = '\x1b['
const styles = { strong: '1', selected: '7', active: '32', activeSelected: '7;32' }
const BEL = '\x07'

export function makeScreen(stdout, env = process.env) {
  const cursor = env.TERM !== 'dumb'
  const alt = cursor && env.DAM_TUI_ALT_SCREEN !== '0'
  const color = cursor && !Object.hasOwn(env, 'NO_COLOR') && stdout.getColorDepth?.(env) > 1
  let previous = []
  let previousWidth
  let previousHeight
  return {
    get width() { return Math.max(1, (stdout.columns || 80) - 1) },
    get height() { return Math.max(1, stdout.rows || 24) },
    ascii: env.DAM_TUI_ASCII === '1',
    enter() {
      if (cursor) stdout.write(`${alt ? `${ESC}?1049h` : ''}${ESC}?25l${ESC}?2004h${ESC}H${ESC}2J`)
    },
    leave() {
      if (cursor) stdout.write(`${ESC}?2004l${ESC}?25h${alt ? `${ESC}?1049l` : '\r\n'}`)
    },
    paint(rows) {
      const width = this.width
      const height = this.height
      const lines = rows.slice(0, height).map(row => {
        let remaining = width
        return row.map(({ text, style }) => {
          const value = clip(singleLine(text), remaining)
          remaining -= cells(value)
          return value && color && styles[style] ? `${ESC}${styles[style]}m${value}${ESC}0m` : value
        }).join('')
      })
      if (!cursor) {
        if (lines.join('\n') !== previous.join('\n')) stdout.write(lines.join('\n') + '\n\n')
      } else {
        let frame = ''
        if (previousWidth !== width || previousHeight !== height) {
          frame = `${ESC}H${ESC}2J`
          previous = []
        }
        for (let index = 0; index < height; index++) {
          const line = lines[index] ?? ''
          if (line !== (previous[index] ?? '')) frame += `${ESC}${index + 1};1H${ESC}2K${line}`
        }
        if (frame) stdout.write(frame)
      }
      previous = lines
      previousWidth = width
      previousHeight = height
    },
  }
}

export function splitRow(left, right, width, separator) {
  const leftText = clip(singleLine(left.text), width, '...')
  return [{ ...left, text: leftText.padEnd(leftText.length + width - cells(leftText)) }, { text: separator }, right]
}

export function pasteInput(dispatch) {
  // Node's keypress decoder also decodes Escape and arrow keys inside bracketed paste.
  // Hold the complete paste and hand its contents to the active input field as text.
  let active = false
  let value = ''
  const flush = () => {
    if (!active) return
    active = false
    dispatch(value, { name: 'paste' })
    value = ''
  }
  return {
    handle(text, key) {
      if (key.sequence === `${ESC}200~` || key.name === 'paste-start') {
        active = true
        value = ''
        return
      }
      if (key.sequence === `${ESC}201~` || key.name === 'paste-end') {
        flush()
        return
      }
      if (active) {
        if (text && text !== BEL) value += text
        else if (key.name === 'return' || key.name === 'enter') value += '\n'
        return
      }
      dispatch(text, key)
    },
  }
}
