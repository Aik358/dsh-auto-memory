/* Browser entry: one conversation tab, using the host's React and session store. */
window.__ModuleLoader__.load({
  id: '@a9i5k4/dsh-auto-memory',
  factory: require => {
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = React
    const apiPath = '/api/dsh-auto-memory/core'
    const css = `.memory-core{box-sizing:border-box;width:100%;height:100%;overflow:auto;padding:24px;font:14px/1.6 system-ui;color:inherit}.memory-core main{max-width:900px;margin:auto}.memory-core h2{margin:0 0 8px}.memory-core form,.memory-core .actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.memory-core input{flex:1;min-width:180px}.memory-core input,.memory-core textarea,.memory-core select,.memory-core button{font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px;padding:6px 10px}.memory-core button{cursor:pointer}.memory-core button:disabled{opacity:.5;cursor:wait}.memory-core textarea{width:100%;box-sizing:border-box;min-height:110px}.memory-core article{padding:16px 0;border-bottom:1px solid #8884}.memory-core p{white-space:pre-wrap;overflow-wrap:anywhere}.memory-core small{opacity:.7}.memory-core pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#8881;max-height:50vh;overflow:auto}.memory-core [role=alert]{color:#cc5544}.memory-core :focus-visible{outline:2px solid #578bdf;outline-offset:2px}`

    function currentSession(sessions) {
      const snapshot = sessions.list.getSnapshot()
      if (snapshot.current) return String(snapshot.current)
      return Object.entries(snapshot.byId || {}).filter(([, row]) => row.retainedBy?.mainView > 0)
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))[0]?.[0] || ''
    }

    function Page({ sessionId }) {
      const [data, setData] = useState({ records: [], sources: [] })
      const [query, setQuery] = useState('')
      const [activeQuery, setActiveQuery] = useState('')
      const [offset, setOffset] = useState(0)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [edit, setEdit] = useState(null)
      const [remove, setRemove] = useState('')
      const [source, setSource] = useState(null)
      const requestVersion = useRef(0)
      const live = useRef(true)
      useEffect(() => { live.current = true; return () => { live.current = false; requestVersion.current++ } }, [])

      async function call(action, args = {}, method = 'GET') {
        const values = { action, sessionId, ...args }
        const response = await fetch(method === 'GET' ? apiPath + '?' + new URLSearchParams(values) : apiPath,
          method === 'GET' ? { cache: 'no-store' } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '请求失败')
        return result
      }

      async function load(search = activeQuery, page = offset) {
        if (!sessionId) return
        const version = ++requestVersion.current
        setBusy(true); setError('')
        try {
          const result = await call(search ? 'search' : 'list', search ? { query: search } : { offset: page })
          if (live.current && version === requestVersion.current) { setData(result); setActiveQuery(search); setOffset(page) }
        } catch (e) { if (live.current && version === requestVersion.current) setError(e.message) }
        finally { if (live.current && version === requestVersion.current) setBusy(false) }
      }
      useEffect(() => { load('', 0) }, [sessionId])

      async function action(name, args) {
        setBusy(true); setError('')
        try {
          await call(name, args, 'POST')
          if (!live.current) return
          setEdit(null); setRemove(''); setSource(null)
          await load()
        } catch (e) { if (live.current) setError(e.message) }
        finally { if (live.current) setBusy(false) }
      }
      async function showSource(id, offset = 0) {
        setBusy(true); setError('')
        try { const result = await call('source', { id, offset }); if (live.current) setSource(result) }
        catch (e) { if (live.current) setError(e.message) }
        finally { if (live.current) setBusy(false) }
      }
      const button = (label, onClick, extra = {}) => h('button', { type: 'button', disabled: busy, onClick, ...extra }, label)
      return h('div', { className: 'memory-core' }, h('style', null, css), h('main', null,
        h('h2', null, '记忆'),
        h('p', null, '自动提取与整理，短摘要随会话载入；详细内容按需查询。'),
        !sessionId ? h('p', null, '请先打开一个工作区会话。') : h(React.Fragment, null,
          data.status && h('small', null, `${data.status.memories} 条记忆 · ${data.status.pending} 份原文待整理${data.status.running ? ' · 整理中' : ''}${data.status.autoExtract ? '' : ' · 自动提取已关闭'}`),
          (error || data.status?.error) && h('p', { role: 'alert' }, error || data.status.error),
          h('form', { onSubmit: e => { e.preventDefault(); load(query.trim(), 0) } },
            h('input', { 'aria-label': '搜索记忆和原文', placeholder: '搜索记忆和原文', value: query, onChange: e => setQuery(e.target.value) }),
            h('button', { disabled: busy }, '搜索'), button('全部', () => { setQuery(''); load('', 0) })),
          h('div', { className: 'actions' }, button('刷新', () => load()), button('整理待处理原文', () => action('consolidate', {})),
            button('新增记忆', () => setEdit({ text: '', scope: 'project' }))),
          edit && h('form', { onSubmit: e => { e.preventDefault(); action('write', { id: edit.id, text: edit.text, scope: edit.scope, expectedVersion: edit.version }) } },
            h('textarea', { 'aria-label': '记忆内容', maxLength: 2000, required: true, value: edit.text, onChange: e => setEdit({ ...edit, text: e.target.value }) }),
            h('select', { 'aria-label': '适用范围', value: edit.scope, onChange: e => setEdit({ ...edit, scope: e.target.value }) }, h('option', { value: 'project' }, '当前项目'), h('option', { value: 'user' }, '用户偏好（跨项目）')),
            h('button', { disabled: busy }, '保存'), button('取消', () => setEdit(null))),
          source && h('section', { 'aria-label': '来源原文' },
            h('h3', null, '来源原文'), h('small', null, `${source.origin} · ${source.sessionId || '本地记忆'} · 字符 ${source.offset} 起`),
            source.suppressed && h('p', null, '该来源已退出检索和自动提取，仅保留追溯。'),
            h('pre', null, source.content), h('div', { className: 'actions' },
              source.offset > 0 && button('原文首页', () => showSource(source.id)),
              source.nextOffset !== null && button('下一段', () => showSource(source.id, source.nextOffset)), button('关闭原文', () => setSource(null)))),
          data.records.map(record => h('article', { key: record.id },
            h('small', null, `${record.scope === 'user' ? '用户偏好' : '当前项目'} · ${record.manual ? '手动确认' : '自动整理'} · ${new Date(record.updatedAt).toLocaleString()}`),
            h('p', null, record.text), h('div', { className: 'actions' },
              button('纠正', () => setEdit(record)), button('删除', () => setRemove(record.id)),
              ...record.sources.map((id, i) => button(`来源 ${i + 1}`, () => showSource(id), { key: id }))),
            remove === record.id && h('div', null, h('p', null, '删除此记忆？相关旧来源将退出检索和自动提取；原文保留用于追溯。'),
              button('确认删除', () => action('delete', { id: record.id, expectedVersion: record.version })), button('取消', () => setRemove(''))))),
          data.sources.map(item => h('article', { key: item.id }, h('small', null, '原文匹配'), h('p', null, item.excerpt), button('查看原文', () => showSource(item.id)))),
          !busy && !data.records.length && !data.sources.length && h('p', null, activeQuery ? '没有匹配内容。' : '暂无记忆。对话结束后会自动提取。'),
          !activeQuery && h('div', { className: 'actions' }, offset > 0 && button('上一页', () => load('', Math.max(0, offset - 50))),
            data.records.length === 50 && button('下一页', () => load('', offset + 50))),
          busy && h('p', { role: 'status' }, '处理中…'),
        ),
      ))
    }

    function apply(ctx) {
      function View(props) {
        const selected = useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => currentSession(ctx.sessions))
        const sessionId = props.sessionId || selected
        return h(Page, { key: sessionId, sessionId })
      }
      ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'auto-memory-core', order: 78, label: () => '记忆' }, props => h(View, props),
      )), 'dsh-auto-memory: memory page')
    }
    return { inject: ['slots', 'sessions'], apply }
  },
})
