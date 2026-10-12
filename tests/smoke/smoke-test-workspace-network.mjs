import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let states = [], cursor = 0, effects = []
const context = vm.createContext({
  Set, graphDensity: 'relaxed', pathName: s => s.split('/').pop(),
  L: (zh, en) => en,
  h: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) {
    const i = cursor++
    if (!(i in states)) states[i] = initial
    return [states[i], value => { states[i] = value }]
  },
  useRef: value => ({ current: value }),
  useEffect: effect => { effects.push(effect) },
})
vm.runInContext(readFileSync(new URL('../../skins/iter5/native-map.js', import.meta.url), 'utf8'), context)
const { iter5WorkspaceLayout: layoutOf, Iter5WorkspaceGraph: render } = context
const fixture = (n, path = '/first') => ({
  path, name: path, logCount: 7,
  graphTopics: Array.from({ length: n }, (_, i) => ({ label: 'Topic ' + i, detail: 'Evidence ' + i })),
})

for (const width of [248, 390, 640, 1000, 1560]) {
  for (const count of [0, 1, 2, 8, 14, 40]) {
    const a = fixture(count), b = fixture(3, '/second')
    const layout = layoutOf([a, b], { links: [{ from: a.path, to: b.path, label: 'shared' }] }, width)
    assert.equal(layout.nodes.length, count + 5, 'Retain every workspace and actual topic')
    assert.equal(layout.edges.filter(e => e.shared).length, 1)
    for (const node of layout.nodes) {
      assert(node.width >= 208, 'Wrapping preserves readable card widths')
      assert(node.x - node.width / 2 >= 0 && node.x + node.width / 2 <= layout.width)
      assert(node.y - node.height / 2 >= 0 && node.y + node.height / 2 <= layout.height)
    }
    for (let i = 0; i < layout.nodes.length; i++) for (const b of layout.nodes.slice(i + 1)) {
      const a = layout.nodes[i]
      assert(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2, 'Cards never overlap after wrapping')
    }
    for (const edge of layout.edges.filter(e => !e.shared)) {
      assert.equal(edge.from.kind, 'workspace')
      assert.equal(edge.to.kind, 'topic')
      assert.equal(edge.from.workspace.path, edge.to.workspace.path, 'Wrapped topics still connect to their own workspace')
    }
  }
}
context.graphDensity = 'compact'
assert.equal(layoutOf([fixture(14)], {}, 390).nodes.length, 15)
assert.equal(layoutOf([], {}, 390).nodes.length, 0)
const duplicates = layoutOf([{ path: '/a', name: 'same', items: ['Topic', ' topic ', 'Other'] }, { path: '/b', name: 'same' }], { links: [{ from: 'same', to: '/b' }] }, 640)
assert.equal(duplicates.nodes.filter(n => n.kind === 'topic').length, 2)
assert.equal(duplicates.edges.filter(e => e.shared).length, 0, 'Ambiguous names must not fabricate a shared link')
console.log('PASS responsive bands retain topics, fit bounds, avoid overlaps and preserve true parentage')

function flatten(node) {
  if (!node || typeof node !== 'object') return []
  return [node, ...(node.children || []).flat(Infinity).flatMap(flatten)]
}
function fresh(props) { states = []; cursor = 0; effects = []; return render(props) }
const a = fixture(8), b = fixture(3, '/second'), selected = []
const props = { workspaces: [a, b], current: a, allWorkspaces: true, onSelect: ws => selected.push(ws.path), graph: { links: [{ from: a.path, to: b.path }] } }
const tree = fresh(props), nodes = flatten(tree)
const workspaces = nodes.filter(n => n.props['data-native-map-node'] === 'workspace')
const topics = nodes.filter(n => n.props['data-native-map-node'] === 'topic')
assert.equal(workspaces.length, 2)
assert.equal(topics.length, 11)
workspaces[1].props.onKeyDown({ key: 'Enter', preventDefault() {} })
workspaces[1].props.onKeyDown({ key: ' ', preventDefault() {} })
assert.deepEqual(selected, ['/second', '/second'])
assert.equal(workspaces[0].props['aria-pressed'], true)
assert.equal(workspaces[1].props['aria-pressed'], false)
for (const topic of topics) {
  assert.equal(topic.props.role, 'img')
  assert.equal(topic.props.onClick, undefined)
  assert.equal(topic.props.tabIndex, undefined)
}
nodes.find(n => n.type === 'select').props.onChange({ target: { value: '/second' } })
cursor = 0
assert.equal(flatten(render({ ...props, current: b })).filter(n => n.props['data-native-map-node'] === 'topic').length, 3)
const paths = nodes.filter(n => n.type === 'path')
assert(paths.every(n => n.props.d.includes(' C ')), 'Links land on card boundaries using curves')
assert.equal(paths.filter(n => n.props.strokeDasharray).length, 1, 'Shared themes stay visibly distinct')
const layout = layoutOf([a, b], props.graph, 968)
paths.filter(n => !n.props.strokeDasharray).forEach((path, i) => {
  const edge = layout.edges.filter(e => !e.shared)[i]
  const coordinates = path.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  assert.deepEqual(coordinates.slice(0, 2), [edge.from.x, edge.from.y + edge.from.height / 2], 'Start at the parent bottom edge')
  assert.deepEqual(coordinates.slice(-2), [edge.to.x, edge.to.y - edge.to.height / 2], 'End at the topic top edge')
})
const longLabel = '跨工作区的超长中文主题与VeryLongUnbrokenEnglishIdentifierForWrapping'
const longTree = flatten(fresh({ workspaces: [{ ...a, graphTopics: [{ label: longLabel, detail: longLabel }] }] }))
assert(longTree.some(n => n.type === 'title' && n.children[0] === longLabel + '\n' + longLabel), 'Clamping must preserve full text in the tooltip')
const localProps = { workspaces: [a, b], allWorkspaces: true, onSelect() {} }
const localTree = flatten(fresh(localProps))
localTree.find(n => n.type === 'select').props.onChange({ target: { value: '/second' } })
cursor = 0
assert.equal(flatten(render(localProps)).filter(n => n.props['data-native-map-node'] === 'topic').length, 3, 'Overview-only callers can choose a scope without owning selection state')
console.log('PASS scope selection, shared links and keyboard workspace actions; topics stay non-actionable')
