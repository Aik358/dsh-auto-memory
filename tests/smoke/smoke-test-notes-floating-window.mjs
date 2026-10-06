// #238: execute the shipped floating-panel and NotesTab render paths. Browser
// geometry under a late composer stylesheet is validated separately in DSH.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
function shippedFunction(name) {
  const start = source.indexOf('    function ' + name + '(')
  const end = source.indexOf('\n    }', start)
  assert(start >= 0 && end > start, name + ' source is present')
  return source.slice(start, end + 6)
}

let tab = 'overview'
let geom = { left: 16, top: 120, width: 440, height: 560 }
const listeners = new Map()
const context = vm.createContext({
  h: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: value => [value, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useTick: () => [0, () => {}],
  panelOpen: true, panelClosing: false, dragActive: false, pinned: false,
  fontScale: 'md', FONT_SCALES: { md: 1 }, FONT_SCALE_VALUES: { md: '1' },
  accentTheme: 'deepseek', ACCENT_VALUES: { deepseek: '#4f7cff' },
  t: key => key === 'autoMemory' ? 'Automatic memory' : key,
  L: (_zh, en) => en,
  currentSessionIdClient: () => null,
  enterExpandedGeom: () => {}, exitExpandedGeom: () => {},
  PinIcon: () => null, TabScroller: () => null,
  MEMORY_TABS: () => [], Loading: () => null,
  controller: {
    panelTab: () => tab, setPanelTab: next => { tab = next },
    geom: () => geom, panelPos: () => 'both',
    setGeom: next => { geom = { ...geom, ...next } },
    flushGeom: () => {}, close: () => { context.panelOpen = false },
  },
  emit: () => {},
  window: {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  },
})
vm.runInContext(['NotesTab', 'startPointerDrag', 'MemoryPanel'].map(shippedFunction).join('\n'), context)
context.MemoryTabBody = () => {
  if (tab !== 'notes') return { type: 'div', props: {}, children: ['Overview'] }
  // Resolve the real NotesTab loaded state with synthetic data, without APIs,
  // timers, React internals or access to the user's memory.
  const saved = context.useState
  let first = true
  context.useState = value => {
    const initial = first ? { notesPath: '/synthetic/notes.md' } : value
    first = false
    return [initial, () => {}]
  }
  try { return context.NotesTab() } finally { context.useState = saved }
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const match = find(child, predicate)
    if (match) return match
  }
  return null
}
function panel() {
  const root = context.MemoryPanel()
  assert.equal(root.props['data-dam-panel'], '')
  // A late attribute-selector rule must not replace the panel's fixed layout.
  assert.equal(root.props.style.position, 'fixed', 'floating panel owns its fixed positioning')
  // Dream skin ignores textarea descendants of dialogs. This is a named,
  // non-modal floating dialog; the conversation page stays a separate surface.
  assert.equal(root.props.role, 'dialog', 'note editor is outside chat-composer discovery')
  assert.equal(root.props['aria-label'], 'Automatic memory')
  assert.notEqual(root.props['aria-modal'], true)
  assert.equal(root.props.style.left, geom.left + 'px')
  assert.equal(root.props.style.top, geom.top + 'px')
  return root
}
panel()
tab = 'notes'
let root = panel()
assert(find(root, node => node.type === 'textarea'), 'real NotesTab editor is rendered')
context.controller.close()
assert.equal(context.MemoryPanel(), null, 'close unmounts the panel')
context.panelOpen = true
root = panel()
assert(find(root, node => node.type === 'textarea'), 'reopen preserves the Notes tab')

const header = find(root, node => node.type === 'header')
header.props.onPointerDown({ clientX: 20, clientY: 130, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} })
listeners.get('pointermove')({ clientX: 70, clientY: 160 })
listeners.get('pointerup')()
panel()
assert.equal(geom.left, 66)
assert.equal(geom.top, 150)
assert.equal(listeners.size, 0, 'drag releases pointer listeners')
console.log('PASS #238: Notes render/reopen, named dialog and fixed drag geometry')
