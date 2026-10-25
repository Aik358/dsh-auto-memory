
import io
p = r"D:\dsh-auto-memory\lib\client.js"
s = io.open(p, encoding="utf-8", newline="").read()
L0 = len(s)
out = []

def rep(old, new, label, expect=1):
    global s
    n = s.count(old)
    if n != expect:
        out.append("SKIP %-28s 命中=%d 期望=%d" % (label, n, expect)); return False
    s = s.replace(old, new, 1)
    out.append("OK   %s" % label); return True

# ---- A) 适配层：插在 EventCard 之前 ----
ANCHOR_ADAPTER = "    var EVENT_STATUS_LABEL ="
ADAPTER = u"""    // \u2605\u2605\u4e8b\u4ef6\u89c6\u56fe \u2194 \u65e7\u770b\u677f UI \u8d44\u4ea7\u7684\u9002\u914d\u5c42\uff082026-10-24\uff0c\u7528\u6237\u6307\u793a\u300c\u5bf9\u7ee7\u627f\u7684\u4e1c\u897f\u505a\u9002\u914d\u300d\uff09
    // \u8bbe\u8ba1\uff1a\u65e7\u7ec4\u4ef6\u96f6\u6539\u52a8\uff0c\u53ea\u5728\u524d\u7aef\u52a0\u8584\u8584\u4e00\u5c42\u5f62\u72b6\u8f6c\u6362\u3002
    function eventStatsToCards4Pre(events, unarchivedTotal, zh) {
      var list = Array.isArray(events) ? events : []
      var cnt = function (s) { var n = 0; for (var i = 0; i < list.length; i++) if (String(list[i] && list[i].status) === s) n++; return n }
      var Z = zh !== false
      return { cards4: [
        { key: 'active', label: Z ? '\u8fdb\u884c\u4e2d' : 'Active', value: cnt('active'), unit: Z ? '\u4ef6' : '' },
        { key: 'paused', label: Z ? '\u6401\u7f6e' : 'Paused', value: cnt('paused'), unit: Z ? '\u4ef6' : '' },
        { key: 'closed', label: Z ? '\u5df2\u5b8c\u6210' : 'Done', value: cnt('closed'), unit: Z ? '\u4ef6' : '' },
        { key: 'unarchived', label: Z ? '\u672a\u5f52\u6863\u8d26\u672c' : 'Unarchived', value: Number(unarchivedTotal) || 0, unit: Z ? '\u7bc7' : '' },
      ] }
    }
    function eventsToTimelineShapePre(events, zh) {
      var list = Array.isArray(events) ? events : []
      var Z = zh !== false
      var entries = []
      for (var i = 0; i < list.length; i++) {
        var ev = list[i] || {}
        var st = String(ev.status || 'active')
        var badge = st === 'active' ? (Z ? '\u8fdb\u884c\u4e2d' : 'active') : (st === 'paused' ? (Z ? '\u6401\u7f6e' : 'paused') : (Z ? '\u5df2\u5b8c\u6210' : 'done'))
        entries.push({ relPath: 'event/' + String(ev.id || i),
          text: String(ev.name || '(\u672a\u547d\u540d)') + '\n' + badge + (ev.summary ? ' \u00b7 ' + String(ev.summary) : ''),
          kind: 'ledger', mtime: Number(ev.updatedAt) || 0 })
      }
      return { entries: entries }
    }

"""
rep(ANCHOR_ADAPTER, ADAPTER + ANCHOR_ADAPTER, "A 适配层")

# ---- B) view state ----
rep("      var lim = (props && props.limit) || 10\n      var tickPair = useState(0)",
    "      var lim = (props && props.limit) || 10\n      var viewPair = useState('cards')\n      var view = viewPair[0]\n      var setView = viewPair[1]\n      var tickPair = useState(0)",
    "B view state")

# ---- C) 空态锚点 empty ----
rep("('data-dam-event-view': '', 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { lineHeight: 1.7 })",
    "('data-dam-event-view': '', 'data-dam-slot': 'hint', 'data-dam-hint': '', 'data-dam-block': 'empty', 'data-dam-kind': 'empty', style: { lineHeight: 1.7 })",
    "C empty \u951a\u70b9")

# ---- D) 渲染尾部 ----
OLD_TAIL = u"""      var more = sorted.length > shown.length
      return h('div', { 'data-dam-event-view': '', 'data-dam-event-limit': String(lim) }, [
        h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: '12px', marginBottom: '10px' } },
          (zh ? '\u53ea\u663e\u793a\u6700\u65b0 ' + shown.length + ' \u4ef6' : 'Showing latest ' + shown.length) + (more ? (zh ? '\uff08\u5171 ' + sorted.length + ' \u4ef6\uff0c\u5176\u4f59\u7528 memory_recall(scope=events) \u67e5\uff09' : ' of ' + sorted.length + ' \u2014 use memory_recall(scope=events) for the rest') : '')),
        shown.map(function (ev) { return h(EventCard, { key: ev.id, ev: ev, zh: zh }) }),
      ])"""
NEW_TAIL = u"""      var more = sorted.length > shown.length
      var stats = eventStatsToCards4Pre(sorted, (data && data.unarchivedTotal) || 0, zh)
      var cardsNode = shown.map(function (ev) { return h(EventCard, { key: ev.id, ev: ev, zh: zh }) })
      var timelineNode = h(DamTimelineList, { data: eventsToTimelineShapePre(shown, zh), zh: zh })
      var body = (view === 'timeline') ? timelineNode : cardsNode
      return h('div', { 'data-dam-event-view': '', 'data-dam-event-limit': String(lim), 'data-dam-event-mode': view }, [
        h(DamStatBar, { stats: stats, zh: zh }),
        h('div', { 'data-dam-event-viewswitch': '', 'data-dam-slot': 'list', 'data-dam-block': 'actions', 'data-dam-kind': 'actions', 'data-dam-row': '' }, [
          h('button', { key: 'v-card', 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-dam-view-btn': 'cards', style: { marginRight: '6px' }, onClick: function () { setView('cards') } }, zh ? '\u5361\u7247' : 'Cards'),
          h('button', { key: 'v-tl', 'data-dam-slot': 'actions', 'data-dam-btn': '', 'data-dam-view-btn': 'timeline', onClick: function () { setView('timeline') } }, zh ? '\u65f6\u95f4\u8f74' : 'Timeline'),
        ]),
        h('div', { 'data-dam-slot': 'hint', 'data-dam-hint': '', style: { fontSize: '12px', marginBottom: '10px' } },
          (zh ? '\u53ea\u663e\u793a\u6700\u65b0 ' + shown.length + ' \u4ef6' : 'Showing latest ' + shown.length) + (more ? (zh ? '\uff08\u5171 ' + sorted.length + ' \u4ef6\uff0c\u5176\u4f59\u7528 memory_recall(scope=events) \u67e5\uff09' : ' of ' + sorted.length + ' \u2014 use memory_recall(scope=events) for the rest') : '')),
        body,
      ])"""
rep(OLD_TAIL, NEW_TAIL, "D \u6e32\u67d3\u5c3e\u90e8")

io.open(p, "w", encoding="utf-8", newline="").write(s)
print("\n".join(out))
print("chars %d -> %d (%+d)" % (L0, len(s), len(s)-L0))
