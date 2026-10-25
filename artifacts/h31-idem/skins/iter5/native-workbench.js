    // Home instrument cluster (L2-1「浅色仪器」转正): every reading is real host data; zero states stay visible.
    // 表盘几何:270° 扫掠,0% 在左下 135°,100% 在右下 45°,viewBox 560,圆心 (280,280)。
    function i5Polar(v, r) { var a = (135 + v * 2.7) * Math.PI / 180; return [280 + Math.cos(a) * r, 280 + Math.sin(a) * r] }
    function i5ArcPath(v1, v2, r) { var p1 = i5Polar(v1, r), p2 = i5Polar(v2, r); return 'M ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' A ' + r + ' ' + r + ' 0 0 1 ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1) }
    function Iter5Home(props) {
      var skinStyle = useIter5Style()
      var result = useIter5Data(async function () {
        var settled = await Promise.allSettled([iter5MemorySnapshot(), apiGet(API.handoffState, { sessionId: currentSessionIdClient() }), apiGet(API.calendar), apiGet(API.semanticStatus)])
        // C10: 最近记录需要真实正文首行摘要——与轻面板相同的受控读取,仅前 8 条
        var previews = {}
        var mem = settled[0] && settled[0].status === 'fulfilled' ? settled[0].value : null
        if (mem) {
          var topRows = iter5MemoryRows(mem[0], mem[1]).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) }).slice(0, 8)
          var got = await Promise.allSettled(topRows.map(function (r) { return apiGet(API.file, { path: r.path, ws: currentWs() }) }))
          got.forEach(function (g, i) { if (g.status === 'fulfilled') previews[topRows[i].path] = String(g.value.content || '').split('\n').filter(function (line) { return line.trim() && !/^\s*#/.test(line) }).map(function (line) { return line.replace(/^\s*[-*]\s+/, '') }).join(' ').slice(0, 120) })
        }
        settled.push({ status: 'fulfilled', value: previews })
        return settled
      }, [props.nonce])
      var values = result.data || []
      function data(i) { return values[i] && values[i].status === 'fulfilled' ? values[i].value : null }
      var memory = data(0), state = memory && memory[1], list = memory && memory[0], handoff = data(1), calendar = data(2), previews = data(4) || {}
      var files = memory ? iter5MemoryRows(list, state) : null
      var recent = files && files.slice().sort(function (a,b) { return String(b.date || '').localeCompare(String(a.date || '')) })
      function shortKind(k) { return k === 'logs' ? L('项目日志', 'Log') : k === 'reflections' ? L('反思', 'Reflection') : k === 'user' ? L('偏好', 'Preference') : L('笔记', 'Note') }
      var water = handoff && handoff.waterLevel
      var known = water && water.window > 0 && Number.isFinite(water.ratio) && water.modelKnown !== false
      var today = iter5Date(new Date())
      var pctRaw = known ? Math.round(water.ratio * 100) : null
      var pct = pctRaw == null ? 0 : Math.max(0, Math.min(100, pctRaw))
      // 琥珀警戒带从宿主真实 threshold 动态计算;没有 threshold 就不画带(诚实)。
      var band = null
      if (water && Number.isFinite(water.threshold)) { var center = Math.max(4, Math.min(96, Math.round(water.threshold * 100))); band = { lo: center - 3, hi: center + 3 } }
      var hot = !!(known && band && pctRaw >= band.lo)
      var WD = L('周日|周一|周二|周三|周四|周五|周六', 'Sun|Mon|Tue|Wed|Thu|Fri|Sat').split('|')
      var days = []
      for (var di = 6; di >= 0; di--) { var dd = new Date(); dd.setDate(dd.getDate() - di); var dk = iter5Date(dd); days.push({ date: dk, label: WD[dd.getDay()], count: 0, today: dk === today }) }
      ;(files || []).forEach(function (r) { if (!r.date) return; for (var dj = 0; dj < days.length; dj++) if (days[dj].date === r.date) { days[dj].count++; break } })
      var maxDay = 0, weekTotal = 0
      days.forEach(function (d) { if (d.count > maxDay) maxDay = d.count; weekTotal += d.count })
      var comp = ['notes', 'logs', 'reflections', 'user'].map(function (k) { return { kind: k, label: k === 'notes' ? L('笔记', 'Notes') : k === 'logs' ? L('日志', 'Logs') : k === 'reflections' ? L('反思', 'Reflections') : L('偏好', 'Preferences'), count: (files || []).filter(function (r) { return r.kind === k }).length } })
      var compTotal = comp.reduce(function (s, x) { return s + x.count }, 0)
      var events = calendar && Array.isArray(calendar.entries) ? calendar.entries.filter(function (e) { return e.date === today }).sort(function (a,b) { return String(a.time || '').localeCompare(String(b.time || '')) }) : null
      var screws = ['tl', 'tr', 'bl', 'br'].map(function (p) { return h('i', { key: p, className: 'i5-screw i5-screw-' + p, 'aria-hidden': true }) })
      // 刻度:0–100 每 1% 一格,主/次/微三层级;行程端点收束墨点;阈值限位刻线
      var ticks = []
      for (var v = 0; v <= 100; v++) {
        var major = v % 10 === 0, mid = v % 5 === 0
        var tp1 = i5Polar(v, major ? 200 : mid ? 210 : 218), tp2 = i5Polar(v, 227)
        ticks.push(h('line', { key: 't' + v, x1: tp1[0].toFixed(2), y1: tp1[1].toFixed(2), x2: tp2[0].toFixed(2), y2: tp2[1].toFixed(2), strokeWidth: major ? 2.8 : mid ? 1.5 : 1, strokeLinecap: major ? 'round' : undefined, style: { stroke: major ? 'var(--i5-text)' : mid ? 'var(--i5-secondary)' : 'var(--i5-tick-micro)' } }))
      }
      ;[0, 100].forEach(function (v) { var p = i5Polar(v, 236); ticks.push(h('circle', { key: 'e' + v, cx: p[0].toFixed(2), cy: p[1].toFixed(2), r: 3, style: { fill: 'var(--i5-text)' } })) })
      if (band) [band.lo, band.hi].forEach(function (v, i) { var p1 = i5Polar(v, 200), p2 = i5Polar(v, 227); ticks.push(h('line', { key: 'th' + i, x1: p1[0].toFixed(2), y1: p1[1].toFixed(2), x2: p2[0].toFixed(2), y2: p2[1].toFixed(2), strokeWidth: 3, strokeLinecap: 'round', style: { stroke: 'var(--i5-orange)' } })) })
      var numerals = []
      for (var n = 0; n <= 100; n += 10) { var np = i5Polar(n, 188); numerals.push(h('text', { key: 'n' + n, x: np[0].toFixed(2), y: np[1].toFixed(2), textAnchor: 'middle', dominantBaseline: 'central', fontSize: n % 50 === 0 ? 15 : 13, style: { fill: n === 0 ? 'var(--i5-blue)' : 'var(--i5-text)', fontVariantNumeric: 'tabular-nums' } }, n)) }
      var bandPos = band ? i5Polar((band.lo + band.hi) / 2, 166) : null
      var zeroApex = i5Polar(0, 248), zeroBase = i5Polar(0, 232), zeroText = i5Polar(-3, 210)
      var dial = h('svg', { className: 'i5-dial', viewBox: '0 0 560 560', role: 'img', 'aria-label': L('上下文水位', 'Context water level') + ' ' + (pctRaw == null ? '—' : pctRaw + '%') + (band ? ' · ' + L('接续阈值', 'Threshold') + ' ' + band.lo + '–' + band.hi + '%' : '') },
        h('defs', null,
          h('radialGradient', { id: 'i5-bezel-grad', cx: '42%', cy: '34%', r: '75%' },
            h('stop', { offset: '0%', style: { stopColor: 'var(--i5-face)' } }),
            h('stop', { offset: '55%', style: { stopColor: 'var(--i5-face-edge)' } }),
            h('stop', { offset: '100%', style: { stopColor: 'var(--i5-bezel)' } })),
          h('radialGradient', { id: 'i5-dial-grad', cx: '50%', cy: '42%', r: '68%' },
            h('stop', { offset: '0%', style: { stopColor: 'var(--i5-face)' } }),
            h('stop', { offset: '70%', style: { stopColor: 'var(--i5-recess)' } }),
            h('stop', { offset: '100%', style: { stopColor: 'var(--i5-face-edge)' } })),
          h('linearGradient', { id: 'i5-glass-grad', x1: 0, y1: 0, x2: 1, y2: 1 },
            h('stop', { offset: '0%', style: { stopColor: 'var(--i5-on-accent)', stopOpacity: .55 } }),
            h('stop', { offset: '38%', style: { stopColor: 'var(--i5-on-accent)', stopOpacity: .12 } }),
            h('stop', { offset: '60%', style: { stopColor: 'var(--i5-on-accent)', stopOpacity: 0 } })),
          h('linearGradient', { id: 'i5-hub-grad', x1: 0, y1: 0, x2: 0, y2: 1 },
            h('stop', { offset: '0%', style: { stopColor: 'var(--i5-face)' } }),
            h('stop', { offset: '100%', style: { stopColor: 'var(--i5-bezel)' } })),
          h('filter', { id: 'i5-soft-drop', x: '-30%', y: '-30%', width: '160%', height: '160%' },
            h('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, floodOpacity: .18, style: { floodColor: 'var(--i5-text)' } })),
          h('filter', { id: 'i5-in-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' },
            h('feGaussianBlur', { stdDeviation: 7 })),
          h('clipPath', { id: 'i5-face-clip' }, h('circle', { cx: 280, cy: 280, r: 249 }))),
        // 表圈:拉丝浅银环 + 滚花
        h('circle', { cx: 280, cy: 280, r: 272, fill: 'url(#i5-bezel-grad)' }),
        h('circle', { cx: 280, cy: 280, r: 271, fill: 'none', strokeWidth: 1.4, style: { stroke: 'var(--i5-face)', strokeOpacity: .9 } }),
        h('circle', { cx: 280, cy: 280, r: 261, fill: 'none', strokeWidth: 9, strokeDasharray: '2.6 5.4', opacity: .8, style: { stroke: 'var(--i5-bezel-dark)' } }),
        h('circle', { cx: 280, cy: 280, r: 255.5, fill: 'none', strokeWidth: 1.2, style: { stroke: 'var(--i5-text)', strokeOpacity: .1 } }),
        h('circle', { cx: 280, cy: 280, r: 250, fill: 'url(#i5-dial-grad)' }),
        h('g', { clipPath: 'url(#i5-face-clip)' },
          h('circle', { cx: 280, cy: 280, r: 248, fill: 'none', strokeWidth: 13, filter: 'url(#i5-in-shadow)', style: { stroke: 'var(--i5-blue)', strokeOpacity: .14 } }),
          h('ellipse', { className: 'i5-dial-reflection', cx: 195, cy: 150, rx: 230, ry: 120, opacity: .22, transform: 'rotate(-24 195 150)', style: { fill: 'var(--i5-on-accent)' } }),
          h('rect', { x: 0, y: 0, width: 560, height: 560, fill: 'url(#i5-glass-grad)' })),
        h('g', null, ticks),
        h('g', null, numerals),
        band ? h('g', { className: 'i5-amber-zone' },
          h('path', { d: i5ArcPath(band.lo, band.hi, 232), fill: 'none', strokeWidth: 8, style: { stroke: 'var(--i5-orange)', strokeOpacity: .16 } }),
          h('path', { d: i5ArcPath(band.lo, band.hi, 232), fill: 'none', strokeWidth: 1.4, style: { stroke: 'var(--i5-orange)', strokeOpacity: .85 } }),
          h('text', { x: bandPos[0].toFixed(1), y: bandPos[1].toFixed(1), textAnchor: 'middle', fontSize: 12, letterSpacing: 1.5, fontWeight: 600, style: { fill: 'var(--i5-orange)' } }, L('接续阈值', 'Handoff threshold')),
          h('text', { x: bandPos[0].toFixed(1), y: (bandPos[1] + 18).toFixed(1), textAnchor: 'middle', fontSize: 12, letterSpacing: 1.5, style: { fill: 'var(--i5-orange)', fontVariantNumeric: 'tabular-nums' } }, band.lo + ' – ' + band.hi)) : null,
        // 零位旗标:嵌在刻度环外缘,指向 0%
        h('g', null,
          h('path', { d: 'M ' + zeroApex[0].toFixed(1) + ' ' + zeroApex[1].toFixed(1) + ' L ' + (zeroBase[0] - 4.24).toFixed(1) + ' ' + (zeroBase[1] - 4.24).toFixed(1) + ' L ' + (zeroBase[0] + 4.24).toFixed(1) + ' ' + (zeroBase[1] + 4.24).toFixed(1) + ' z', style: { fill: 'var(--i5-blue)' } }),
          h('text', { x: zeroText[0].toFixed(1), y: zeroText[1].toFixed(1), textAnchor: 'middle', fontSize: 12, letterSpacing: 2, style: { fill: 'var(--i5-secondary)' } }, L('ZERO · 待机', 'ZERO · IDLE'))),
        // 指针:蓝色珐琅针,外层 g 负责读数角(CSS transition),内层 g 跑游丝待机微颤
        h('g', { className: 'i5-needle', style: { transform: 'rotate(' + (-135 + pct * 2.7) + 'deg)' }, filter: 'url(#i5-soft-drop)' },
          h('g', { className: 'i5-needle-idle' },
            h('line', { x1: 280, y1: 104, x2: 280, y2: 252, strokeWidth: 6, strokeLinecap: 'round', style: { stroke: 'var(--i5-blue)' } }),
            h('line', { x1: 278.4, y1: 110, x2: 278.4, y2: 248, strokeWidth: 1.6, strokeLinecap: 'round', opacity: .85, style: { stroke: 'var(--i5-chan-1)' } }),
            h('line', { x1: 280, y1: 252, x2: 280, y2: 318, strokeWidth: 5, strokeLinecap: 'round', style: { stroke: 'var(--i5-text)' } }),
            h('circle', { cx: 280, cy: 104, r: 5.5, style: { fill: 'var(--i5-blue)' } }),
            h('circle', { cx: 280, cy: 104, r: 2.4, style: { fill: 'var(--i5-face-edge)' } }))),
        // 中心毂:拉丝银 + 蓝釉铆点
        h('circle', { cx: 280, cy: 280, r: 17, fill: 'url(#i5-hub-grad)', strokeWidth: 1.4, style: { stroke: 'var(--i5-bezel-dark)' } }),
        h('circle', { cx: 280, cy: 280, r: 17, fill: 'none', strokeWidth: 1, style: { stroke: 'var(--i5-face)', strokeOpacity: .8 } }),
        h('circle', { cx: 280, cy: 280, r: 4.5, strokeWidth: 1.2, style: { fill: 'var(--i5-blue)', stroke: 'var(--i5-chan-deep)' } }))
      var readout = h('div', { className: 'i5-readout' },
        h('div', { className: 'i5-readout-big i5-num' }, pctRaw == null ? '0' : String(pctRaw), h('small', null, '%')),
        h('div', { className: 'i5-readout-tokens i5-num' }, known ? water.tokens.toLocaleString() + ' / ' + water.window.toLocaleString() + ' TOKENS' : '—'),
        h('div', { className: 'i5-readout-state' }, !known ? L('会话未接入 · 仪表待机', 'No session · gauge idle') : hot ? L('已达接续阈值，可接续', 'Handoff threshold reached') : L('监测中 · 未达阈值', 'Monitoring · below threshold')))
      var gaugePanel = h('section', { className: 'i5-panel i5-gauge-panel' },
        screws,
        h('div', { className: 'i5-ph' }, h('h2', null, L('上下文水位', 'Context water level')), h('span', { className: 'i5-engr' }, 'CTX WATER-LEVEL'), h('span', { className: 'i5-ph-right' }, L('抵达阈值即自动接续', 'Auto-handoff at threshold'))),
        h('div', { className: 'i5-gauge-face' },
          dial,
          readout,
          [1, 2, 3, 4, 5].map(function (i) { return h('i', { key: i, className: 'i5-dust i5-dust-' + i, 'aria-hidden': true }) }),
          h('i', { className: 'i5-sheen', 'aria-hidden': true })),
        // 接续回路铭牌:02 是真实入口,达到阈值时点亮
        h('div', { className: 'i5-loop-strip' },
          h('div', { className: 'i5-loop-step' }, h('span', { className: 'i5-loop-no' }, '01'), h('span', { className: 'i5-loop-lb' }, L('监测水位', 'Monitor level'))),
          h('button', { className: 'i5-loop-step', 'data-hot': hot ? 'true' : undefined, onClick: function () { props.onNav('handoff') } }, h('span', { className: 'i5-loop-no' }, '02'), h('span', { className: 'i5-loop-lb' }, L('接续 HANDOFF', 'Handoff')), h('span', { className: 'i5-loop-arrow', 'aria-hidden': true }, '→')),
          h('div', { className: 'i5-loop-step' }, h('span', { className: 'i5-loop-no' }, '03'), h('span', { className: 'i5-loop-lb' }, L('新会话带记忆重生', 'Reborn with memory')), h('span', { className: 'i5-loop-arrow', 'aria-hidden': true }, '→'))))
      var lastWrite = recent && recent.length && recent[0].date ? recent[0].date : null
      var mixPanel = h('section', { className: 'i5-panel i5-mix-panel' },
        h('div', { className: 'i5-ph' }, h('h2', null, L('记忆构成', 'Memory mix')), h('span', { className: 'i5-engr' }, 'MEMORY MIX'), h('span', { className: 'i5-ph-right' }, L('最近写入 · ', 'Last write · '), h('b', null, lastWrite || '—'))),
        h('div', { className: 'i5-mix-body' },
          h('div', { className: 'i5-mix-total' },
            h('span', { className: 'i5-mix-n i5-num' }, files ? String(files.length) : '—'),
            h('span', { className: 'i5-mix-u' }, L(' 条记忆 · 4 通道', ' memories · 4 channels')),
            h('span', { className: 'i5-mix-w' }, L('满刻度 ', 'Full scale '), h('b', null, String(compTotal)))),
          h('div', { className: 'i5-channels', role: 'img', 'aria-label': L('记忆构成占比', 'Memory composition') }, comp.map(function (s, ci) {
            var lit = compTotal > 0 ? Math.min(14, Math.max(s.count ? 1 : 0, Math.round(s.count / compTotal * 14))) : 0
            var segs = []
            for (var si = 0; si < 14; si++) segs.push(h('i', { key: si, className: 'i5-seg', 'data-lit': si < lit ? 'true' : undefined, 'data-peak': si === lit - 1 ? 'true' : undefined, style: si === lit - 1 ? { animationDelay: (ci * 0.7) + 's' } : undefined }))
            return h('div', { key: s.kind, className: 'i5-chan', 'data-kind': s.kind },
              h('span', { className: 'i5-chan-v i5-num' }, String(s.count)),
              h('div', { className: 'i5-meter' }, segs),
              h('span', { className: 'i5-chan-l' }, s.label),
              h('span', { className: 'i5-chan-s i5-num' }, compTotal ? (Math.round(s.count / compTotal * 1000) / 10) + '%' : '—'))
          })),
          compTotal ? null : h('p', { className: 'i5-mix-note' }, files ? L('写入记忆后显示构成', 'Composition appears once memories exist') : L('记忆暂不可用', 'Memory unavailable'))))
      var sedPanel = h('section', { className: 'i5-panel i5-sed-panel' },
        h('div', { className: 'i5-ph' }, h('h2', null, L('近 7 日沉淀', 'Last 7 days')), h('span', { className: 'i5-engr' }, '7-DAY TRACE'), h('span', { className: 'i5-ph-right' }, files ? [L('合计 ', 'Total '), h('b', null, weekTotal ? '+' + weekTotal : '0'), ' ' + L('条', 'items')] : '—')),
        h('div', { className: 'i5-sed-body' },
          h('div', { className: 'i5-scope', role: 'img', 'aria-label': L('近 7 日新增记忆', 'New memories in the last 7 days') },
            h('i', { className: 'i5-scanline', 'aria-hidden': true }),
            days.map(function (d, i) {
              var ghost = d.today && d.count === 0
              return h('div', { key: d.date, className: 'i5-daycol', 'data-ghost': ghost ? 'true' : undefined, 'data-today': d.today ? 'true' : undefined, title: d.date + ' · ' + d.count + ' ' + L('条', 'items') },
                d.today ? h('span', { className: 'i5-day-now' }, L('今日', 'Today')) : null,
                h('span', { className: 'i5-day-v i5-num' }, String(d.count)),
                h('i', { className: 'i5-dbar', style: { height: d.count ? Math.max(10, Math.round(d.count / maxDay * 72)) + '%' : ghost ? '18%' : '0', transitionDelay: (0.3 + i * 0.06) + 's' } }))
            }))),
        h('div', { className: 'i5-sed-days' }, days.map(function (d) { return h('span', { key: d.date, 'data-today': d.today ? 'true' : undefined }, h('b', null, d.label), d.date.slice(5)) })))
      var calText = events === null ? L('日程暂不可用', 'Schedule unavailable') : events.length ? (events[0].time || '—') + ' · ' + events[0].title + (events.length > 1 ? ' · ' + L('共 ', 'of ') + events.length + L(' 项', ' events') : '') : L('今天没有安排 — 水面平静，整日可用于沉淀', 'Nothing scheduled — calm water, the whole day is yours')
      var calPanel = h('section', { className: 'i5-panel i5-cal-panel' },
        h('button', { className: 'i5-daily-card', onClick: function () { props.onNav('calendar') } },
          h('i', { className: 'i5-lamp', 'data-lit': events && events.length ? 'true' : undefined, 'aria-hidden': true }),
          h('div', { className: 'i5-cal-copy' },
            h('div', { className: 'i5-cal-t1' }, L('今日日程', "Today's schedule"), ' · ', h('span', { className: 'i5-num' }, today)),
            h('div', { className: 'i5-cal-t2' }, calText)),
          h('div', { className: 'i5-cal-code' }, h('span', { className: 'i5-engr' }, 'SCHEDULE'), h('span', { className: 'i5-engr i5-num' }, (events ? events.length : '—') + ' EVENTS'))))
      var recPanel = h('section', { className: 'i5-panel i5-rec-panel' },
        h('div', { className: 'i5-ph' }, h('h2', null, L('最近记录', 'Recent records')), h('span', { className: 'i5-engr' }, 'EVENT LOG'), h('span', { className: 'i5-ph-right' }, L('按写入时间', 'By write time'))),
        h('div', { className: 'i5-native-recent' },
          result.loading ? h(Loading) : recent && recent.length ? recent.slice(0, 8).map(function (r) {
            return h('button', { key: r.path, className: 'i5-rec', onClick: function () { props.onNav('library', { path: r.path }) } },
              h('span', { className: 'i5-rec-d i5-num' }, r.date ? r.date.slice(5) : '—'),
              h('span', { className: 'i5-rec-badge', 'data-kind': r.kind }, h('i', { 'aria-hidden': true }), shortKind(r.kind)),
              h('span', { className: 'i5-rec-txt' }, previews[r.path] || r.label),
              h('span', { className: 'i5-rec-sz i5-num' }, fmtSize(r.size)))
          }) : h(Iter5Empty, { title: files ? L('还没有记录', 'No records yet') : L('记忆暂不可用', 'Memory unavailable'), text: L('记忆文件会按当前工作区显示。', 'Memory files appear for the current workspace.') })))
      if (skinStyle !== 'instrument') return h(Iter5AlternateHome, { variant: skinStyle, result: result, values: values, files: files, recent: recent, previews: previews, water: water, known: known, pct: pctRaw, band: band, hot: hot, days: days, weekTotal: weekTotal, comp: comp, compTotal: compTotal, events: events, today: today, calText: calText, state: state, semantic: data(3), onNav: props.onNav, nonce: props.nonce })
      return h('div', { className: 'i5-home i5-native-home' },
        result.error || values.some(function (r) { return r.status === 'rejected' }) ? h(Iter5Error, { error: result.error || L('部分数据暂不可用', 'Some data is unavailable'), retry: result.retry }) : null,
        h('div', { className: 'i5-home-grid', 'aria-busy': result.loading },
          gaugePanel,
          h('div', { className: 'i5-col' }, mixPanel, sedPanel),
          h('div', { className: 'i5-col' }, calPanel, recPanel)),
        h('details', { className: 'i5-card i5-secondary-details' }, h('summary', null, L('工作区概览、总结与技术详情', 'Workspace overview, summaries and technical details')), h('div', { className: 'i5-hosted' }, h(OverviewTab, { nonce: props.nonce }))))
    }
