    // Two distinct presentations of the same resolved home data; no extra requests.
    function Iter5AlternateHome(p) {
      if (p.variant === 'water') return h(Iter5WaterHome, p)
      var count = p.files ? p.files.length : null
      var phase = !p.known ? L('会话未接入 · 仪表待机', 'No session · gauge idle') : p.hot ? L('已达接续阈值，可接续', 'Handoff threshold reached') : L('监测中 · 未达阈值', 'Monitoring · below threshold')
      var maximum = Math.max.apply(null, p.days.map(function (d) { return d.count }).concat([1]))
      var reading = h('div', { className: 'i5-alt-reading' },
        h('div', { className: 'i5-alt-label' }, L('上下文水位', 'Context water level')),
        h('strong', { className: 'i5-alt-percent i5-num' }, p.known ? p.pct : '—', p.known ? h('small', null, '%') : null),
        h('p', { className: 'i5-alt-tokens' }, p.known ? Number(p.water.tokens).toLocaleString() + ' / ' + Number(p.water.window).toLocaleString() + ' tokens' : '—'), h('p', null, phase))
      var loop = h('div', { className: 'i5-alt-loop' }, h('span', null, L('监测水位', 'Monitor level')), h('span', { 'aria-hidden': true }, '→'), h('button', { onClick: function () { p.onNav('handoff') } }, L('接续 HANDOFF', 'Handoff')), h('span', { 'aria-hidden': true }, '→'), h('span', null, L('新会话带记忆重生', 'Reborn with memory')))
      var ruler = h('div', { className: 'i5-alt-ruler', role: 'img', 'aria-label': L('上下文水位', 'Context water level') + ': ' + (p.known ? p.pct + '%' : '—') },
        h('div', { className: 'i5-alt-ruler-line' }),
        [0,20,40,60,80,100].map(function (n) { return h('span', { key: n, style: { left: n + '%' } }, n) }),
        p.known ? h('i', { className: 'i5-alt-pointer', style: { left: Math.max(0,Math.min(100,p.pct)) + '%' } }) : null,
        p.band ? h('b', { className: 'i5-alt-threshold', style: { left: p.band.lo + '%', width: (p.band.hi - p.band.lo) + '%' }, title: L('接续阈值', 'Threshold') + ' ' + p.band.lo + '–' + p.band.hi + '%' }) : null)
      var trace = h('section', { className: 'i5-alt-trace' }, h('h2', null, L('近 7 日沉淀', 'Last 7 days')),
        h('div', { className: 'i5-alt-total i5-num' }, p.files ? '+' + p.weekTotal : '—'),
        h('div', { className: 'i5-alt-days' }, p.days.map(function (d) { return h('div', { key:d.date, 'data-today': String(d.today) }, h('span', null, d.label, ' ', h('small', null, d.date.slice(5))), h('i', null, h('b', { style: { width: p.files ? (d.count / maximum * 100) + '%' : '0' } })), h('strong', null, p.files ? d.count : '—')) })))
      var mix = h('section', { className: 'i5-alt-mix' }, h('h2', null, L('记忆构成', 'Memory mix')), h('div', { className: 'i5-alt-total i5-num' }, count === null ? '—' : count),
        p.comp.map(function (c) { return h('div', { className: 'i5-alt-mix-row', key:c.kind, 'data-kind': c.kind }, h('span', null,c.label), h('i', null,h('b',{style:{width:p.compTotal ? c.count/p.compTotal*100+'%' : '0'}})), h('strong',null,p.files?c.count:'—'), h('small',null,p.compTotal?(c.count/p.compTotal*100).toFixed(1)+'%':'—')) }))
      var schedule = h('section', { className: 'i5-alt-schedule' }, h('h2', null, L('今日日程', "Today's schedule")), h('time', null,p.today),
        h('button', { className: 'i5-alt-calendar-link', onClick:function(){p.onNav('calendar')} }, p.calText),
        h('dl', { className: 'i5-alt-session' }, h('dt',null,L('工作区','Workspace')),h('dd',null,currentWs()?pathName(currentWs()):'—'),h('dt',null,L('检索','Retrieval')),h('dd',null,p.semantic?(p.semantic.resolvedTier||'c1').toUpperCase():'—'),h('dt',null,L('自动沉淀','Auto memory')),h('dd',null,p.state&&p.state.autoStats&&typeof p.state.autoStats.count==='number'?p.state.autoStats.count:'—')))
      function record(r) { return h('button',{className:'i5-alt-record',key:r.path,onClick:function(){p.onNav('library',{path:r.path})}},h('time',null,r.date?r.date.slice(5):'—'),h('span',null,p.previews[r.path]||r.label),h('small',null,fmtSize(r.size))) }
      var records = h('section', { className: 'i5-alt-records' }, h('div', { className: 'i5-alt-records-head' }, h('h2', null, L('最近记录', 'Recent records')), h('small', null, L('按写入时间', 'By write time'))),
        p.result.loading ? h(Loading) : p.files === null ? h(Iter5Empty, { title: L('记忆暂不可用', 'Memory unavailable') }) : !p.files.length ? h(Iter5Empty, { title: L('还没有记录', 'No records yet') }) : h('div', { className: 'i5-editor-records' }, (p.recent || []).slice(0, 9).map(record)))
      var error = p.result.error || p.values.some(function(r){return r.status==='rejected'}) ? h(Iter5Error,{error:p.result.error||L('部分数据暂不可用','Some data is unavailable'),retry:p.result.retry}) : null
      return h('div',{className:'i5-alt-home i5-alt-'+p.variant,'aria-busy':p.result.loading},error,
        h('div',{className:'i5-alt-hero'},reading,h('div',{className:'i5-alt-story'},h('h2',null,L('项目记忆','Project memory')),h('div',{className:'i5-alt-story-count'},count===null?'—':count,h('small',null,L(' 条记忆 · 4 通道',' memories · 4 channels'))),h('p',null,L('记忆文件会按当前工作区显示。','Memory files appear for the current workspace.')),loop)),
        ruler, h('div', { className: 'i5-editor-columns' }, trace, mix, schedule), records,
        h('details',{className:'i5-secondary-details'},h('summary',null,L('工作区概览、总结与技术详情','Workspace overview, summaries and technical details')),h('div',{className:'i5-hosted'},h(OverviewTab,{nonce:p.nonce}))))
    }

    // The revised L2-3 reference: a continuous tank above a compact sediment core.
    function Iter5WaterHome(p) {
      var order = ['logs', 'reflections', 'notes', 'user']
      var groups = p.comp.slice().sort(function (a, b) { return order.indexOf(a.kind) - order.indexOf(b.kind) })
      var phase = !p.known ? L('会话未接入 · 仪表待机', 'No session · gauge idle') : p.hot ? L('已达接续阈值，可接续', 'Handoff threshold reached') : L('监测中 · 未达阈值', 'Monitoring · below threshold')
      var error = p.result.error || p.values.some(function (r) { return r.status === 'rejected' })
      return h('div', { className: 'i5-water-tank', 'aria-busy': p.result.loading },
        h('div', { className: 'i5-water-light', 'aria-hidden': true },
          h('i', { className: 'i5-water-ray' }), h('i', { className: 'i5-water-ray second' }),
          h('div', { className: 'i5-water-lines' }, [0, 1].map(function (n) { return h('svg', { key: n, viewBox: '0 0 1440 30', preserveAspectRatio: 'none' }, h('path', { d: 'M0 12 C120 -2 240 26 360 12 S600 -2 720 12 S960 26 1080 12 S1320 -2 1440 12 V30 H0Z' }), h('path', { className: 'i5-water-edge', d: 'M0 12 C120 -2 240 26 360 12 S600 -2 720 12 S960 26 1080 12 S1320 -2 1440 12' })) })),
          h('div', { className: 'i5-water-snow' }, Array.from({ length: 12 }, function (_, n) { return h('i', { key: n, style: { left: (7 + n * 8) + '%', animationDelay: (-n * 2.3) + 's', animationDuration: (21 + n % 4 * 3) + 's' } }) })),
          h('div', { className: 'i5-water-caustics' })),
        error ? h(Iter5Error, { error: p.result.error || L('部分数据暂不可用', 'Some data is unavailable'), retry: p.result.retry }) : null,
        h('div', { className: 'i5-water-top' },
          h('div', { className: 'i5-water-reading' }, h('strong', { className: 'i5-num' }, p.known ? p.pct + '%' : '—'),
            h('div', null, h('h2', null, L('上下文水位', 'Context water level')), h('p', null, p.known ? Number(p.water.tokens).toLocaleString() + ' / ' + Number(p.water.window).toLocaleString() + ' tokens' : '—'), h('small', null, phase))),
          h('div', { className: 'i5-water-context' }, h('strong', null, L('项目记忆', 'Project memory')), h('p', null, L('记忆文件会按当前工作区显示。', 'Memory files appear for the current workspace.')))),
        h('div', { className: 'i5-water-stations' },
          h('section', null, h('h2', null, L('当前会话', 'Current session')), h('dl', { className: 'i5-water-instruments' },
            [[L('工作区', 'Workspace'), currentWs() ? pathName(currentWs()) : '—'], [L('检索', 'Retrieval'), p.semantic ? (p.semantic.resolvedTier || 'c1').toUpperCase() : '—'], [L('自动沉淀', 'Auto memory'), p.state && p.state.autoStats && typeof p.state.autoStats.count === 'number' ? p.state.autoStats.count : '—']].map(function (r) { return h('div', { key: r[0] }, h('dt', null, r[0]), h('dd', null, r[1])) }))),
          h('section', { className: 'i5-water-calendar' }, h('h2', null, L('今日日程', "Today's schedule")), h('time', null, p.today), h('button', { onClick: function () { p.onNav('calendar') } }, p.calText))),
        h('div', { className: 'i5-water-cut' },
          h('span', null, L('接续阈值', 'Threshold'), ' ', p.band ? p.band.lo + '–' + p.band.hi + '%' : '—'),
          h('div', null, h('span', null, L('监测水位', 'Monitor level')), h('span', { 'aria-hidden': true }, '→'), h('button', { onClick: function () { p.onNav('handoff') } }, L('接续 HANDOFF', 'Handoff')), h('span', { 'aria-hidden': true }, '→'), h('span', null, L('新会话带记忆重生', 'Reborn with memory')))),
        h('section', { className: 'i5-water-core' },
          h('header', null, h('h2', null, L('最近记录', 'Recent records')), h('span', null, L('记忆构成', 'Memory mix')), h('small', null, L('合计 ', 'Total '), p.files ? p.files.length : '—', ' · ', L('近 7 日沉淀', 'Last 7 days'), ' +', p.files ? p.weekTotal : '—')),
          h('div', { className: 'i5-water-week' }, p.days.map(function (d) { return h('div', { key: d.date, 'data-today': String(d.today) }, h('strong', null, d.label), h('time', null, d.date.slice(5)), h('span', null, p.files ? d.count : '—')) })),
          p.result.loading ? h(Loading) : p.files === null ? h(Iter5Empty, { title: L('记忆暂不可用', 'Memory unavailable') }) : !p.files.length ? h(Iter5Empty, { title: L('还没有记录', 'No records yet') }) :
            h('div', { className: 'i5-water-stratigraphy' }, groups.map(function (c) {
              var rows = (p.files || []).filter(function (r) { return r.kind === c.kind }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) })
              return h('section', { className: 'i5-water-rock', key: c.kind, 'data-kind': c.kind },
                h('div', { className: 'i5-water-key' }, h('i'), h('span', null, c.label), h('strong', null, c.count), h('small', null, p.compTotal ? (c.count / p.compTotal * 100).toFixed(1) + '%' : '—')),
                h('div', { className: 'i5-water-laminae' }, rows.length ? rows.slice(0, 6).map(function (r, i) { return h('button', { className: 'i5-water-lamina', key: r.path, onClick: function () { p.onNav('library', { path: r.path }) }, style: { '--i5-layer-depth': Math.min(i, 4) } }, h('time', null, r.date ? r.date.slice(5) : '—'), h('span', null, p.previews[r.path] || r.label), h('small', null, fmtSize(r.size))) }) : h('span', { className: 'i5-water-lamina i5-muted' }, '—')),
                h('button', { className: 'i5-water-rock-link', onClick: function () { p.onNav('library', { category: c.kind }) } }, c.label))
            }))),
        h('details', { className: 'i5-secondary-details' }, h('summary', null, L('工作区概览、总结与技术详情', 'Workspace overview, summaries and technical details')), h('div', { className: 'i5-hosted' }, h(OverviewTab, { nonce: p.nonce }))))
    }
