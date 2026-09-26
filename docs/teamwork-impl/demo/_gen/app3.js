  /* ---------- ⑤ 团队技能审批 ---------- */
  var RISK_LABEL = { high: '高风险（需人工批准）', medium: '中风险', low: '低风险' };
  function renderSkills() {
    var host = document.getElementById('skill-list'); host.innerHTML = '';
    D.skills.forEach(function (s, i) {
      var card = el('div', { 'class': 'card', 'data-dam-team-skill': '', 'data-risk': s.risk, 'data-inspect': 'sk-' + i, 'data-inspect-always': '1' });
      var top = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' });
      top.appendChild(el('b', { text: s.title }));
      top.appendChild(el('span', { 'class': 'tag ' + (s.risk === 'high' ? 'tag-err' : (s.risk === 'medium' ? 'tag-warn' : 'tag-ok')), text: RISK_LABEL[s.risk] }));
      top.appendChild(el('span', { 'class': 'faint', 'data-dam-team-skill-owner': '', text: '提交人 ' + member(s.ownerId).name }));
      card.appendChild(top);
      var ev = el('div', { 'data-dam-team-skill-evidence': '' });
      [['seen', '见过'], ['success', '成功'], ['sessions', '会话'], ['reused', '复用'], ['corrections', '纠正']].forEach(function (pair) {
        ev.appendChild(el('span', { text: pair[1] + ' ' + s.evidence[pair[0]] }));
      });
      card.appendChild(ev);
      var steps = el('div', { 'data-dam-team-skill-steps': '', 'class': 'muted', style: 'margin:8px 0' });
      steps.appendChild(el('div', { 'class': 'faint', text: '步骤' }));
      s.steps.forEach(function (t, k) { steps.appendChild(el('div', { text: (k + 1) + '. ' + t })); });
      card.appendChild(steps);
      var bar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' });
      function actBtn(label, action, cls) {
        var b = el('button', { 'class': 'btn ' + cls, type: 'button', text: label, 'data-inspect': 'sk-' + action + '-' + i, 'data-inspect-always': '1' });
        if (action === 'approve' && !s.canApprove) { b.disabled = true; b.title = s.blocked; }
        b.addEventListener('click', function () {
          if (s.risk === 'high' && action === 'approve' && b.getAttribute('data-arm') !== '1') {
            b.setAttribute('data-arm', '1'); b.textContent = '高风险 · 再点确认';
            toast('高风险技能需二次确认');
            return;
          }
          toast('POST team-skills/approve action=' + action + ' → ' + s.id);
          D.skills.splice(i, 1); renderSkills();
        });
        reg('sk-' + action + '-' + i, { el: 'data-dam-team-skill 动作按钮', contract: '§5.2', api: 'POST /api/dsh-auto-memory/team-skills/approve', field: 'body: { id: "' + s.id + '", action: "' + action + '", steps?, criteria?, reason? }', behavior: action === 'approve' ? 'risk=high 需二次确认；canApprove=false 时禁用并显示真因' : '拒绝须填原因' });
        return b;
      }
      bar.appendChild(actBtn('批准晋升', 'approve', 'btn-primary'));
      bar.appendChild(actBtn('修改后批准', 'edit', 'btn'));
      bar.appendChild(actBtn('拒绝', 'reject', 'btn-danger'));
      if (!s.canApprove) bar.appendChild(el('span', { 'class': 'tag tag-warn', text: '闸门未过：' + s.blocked }));
      card.appendChild(bar);
      host.appendChild(card);
      reg('sk-' + i, { el: 'data-dam-team-skill', contract: '§5.2', api: 'GET /api/dsh-auto-memory/team-skills', field: 'skill.{id,title,ownerId,riskLevel,steps,criteria,evidence,canApprove,approveBlockedReason}', behavior: '风险分级只改左侧色条；canApprove 由后端给，前端不推断' });
    });
    if (!D.skills.length) host.appendChild(el('div', { 'class': 'muted', text: '没有待审批技能。' }));
  }

  /* ---------- ⑥ 交接账本 ---------- */
  function renderHandoff() {
    var chain = document.getElementById('chain'); chain.innerHTML = '';
    D.chain.forEach(function (c, i) {
      var m = member(c.from);
      var node = el('button', { 'data-dam-team-chain-node': '', type: 'button', 'data-inspect': 'ch-' + i, 'data-inspect-always': '1' });
      var dot = el('span', { 'data-dam-team-avatar': '', style: 'width:18px;height:18px;font-size:10px', text: initials(m.name) });
      dot.style.setProperty('--t-hue', String(m.hue));
      node.appendChild(dot);
      node.appendChild(el('span', { text: m.name + ' → ' + member(c.to).name }));
      node.appendChild(el('span', { 'class': 'faint', text: c.at.slice(5, 16) }));
      node.addEventListener('click', function () { toast('接续会话 ' + c.sessionId + '（sessions.open → remote.session.prompt）'); });
      chain.appendChild(node);
      if (i < D.chain.length - 1) chain.appendChild(el('span', { 'data-dam-team-chain-link': '' }));
      reg('ch-' + i, { el: 'data-dam-team-chain-node', contract: '§5.3', api: 'GET /api/dsh-auto-memory/team-handoffs', field: 'chain[] = { from, to, at, sessionId }', behavior: '点击走既有宿主回程：sessions.open(:4645) + remote.session.prompt(:4591)' });
    });
    var ledger = document.getElementById('ledger'); ledger.innerHTML = '';
    D.ledger.forEach(function (g, i) {
      var m = member(g.actorId);
      var seg = el('div', { 'data-dam-team-ledger-seg': '', 'data-actor': g.actorId, 'data-inspect': 'lg-' + i, 'data-inspect-always': '1' });
      seg.style.setProperty('--dam-team-actor-hue', String(m.hue));
      var h = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' });
      var av = el('span', { 'data-dam-team-avatar': '', style: 'width:20px;height:20px;font-size:10px', text: initials(m.name) });
      av.style.setProperty('--t-hue', String(m.hue));
      h.appendChild(av);
      h.appendChild(el('b', { text: g.title }));
      h.appendChild(el('span', { 'class': 'faint', text: m.name + ' · ' + g.at }));
      seg.appendChild(h);
      seg.appendChild(el('div', { 'class': 'muted', text: g.body }));
      ledger.appendChild(seg);
      reg('lg-' + i, { el: 'data-dam-team-ledger-seg', contract: '§5.3', api: 'GET /team-handoffs', field: 'segments[] = { id, actorId, at, title, body, sessionId }', behavior: '分色 = --dam-team-actor-hue（前端按 actorId 稳定哈希），不硬编码色值' });
    });
    if (!D.ledger.length) ledger.appendChild(el('div', { 'class': 'muted', text: '账本为空。' }));
  }

  /* ---------- ⑦ 团队设置分区 ---------- */
  var cfgState = {};
  function renderSettings() {
    var host = document.getElementById('settings-rows'); host.innerHTML = '';
    D.settings.forEach(function (f) {
      var row = el('div', { 'class': 't-row', 'data-inspect': 'st-' + f.key, 'data-inspect-always': '1' });
      row.appendChild(el('div', { 'class': 't-label', text: f.label }));
      var ctl = el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' });
      var val = cfgState[f.key] !== undefined ? cfgState[f.key] : f.value;
      if (f.type === 'switch') {
        var sw = el('button', { 'data-dam-team-switch': '', 'data-on': val ? 'true' : 'false', type: 'button', 'aria-label': f.label });
        sw.addEventListener('click', function () {
          cfgState[f.key] = !(cfgState[f.key] !== undefined ? cfgState[f.key] : f.value);
          renderSettings();
          toast('已保存 ' + f.key + ' = ' + cfgState[f.key] + '（即时回显，随后 patch /config）');
        });
        ctl.appendChild(sw);
      } else if (f.type === 'select') {
        var sel = el('select', {});
        f.options.forEach(function (o) { var op = el('option', { value: o, text: o }); if (val === o) op.selected = true; sel.appendChild(op); });
        sel.addEventListener('change', function () { cfgState[f.key] = this.value; renderSettings(); toast('已保存 ' + f.key + ' = ' + this.value); });
        ctl.appendChild(sel);
      } else if (f.type === 'readonly') {
        ctl.appendChild(el('code', { style: 'font-family:var(--skin-font-mono);font-size:var(--skin-font-size-sm)', text: String(val) }));
      } else {
        var inp = el('input', { type: f.type === 'number' ? 'number' : 'text', value: String(val) });
        if (f.key === 'teamSyncIntervalSec') { inp.min = '15'; inp.max = '3600'; }
        inp.addEventListener('change', function () { cfgState[f.key] = this.value; toast('已保存 ' + f.key + ' = ' + this.value); });
        ctl.appendChild(inp);
      }
      ctl.appendChild(el('span', { 'class': 't-hint', text: f.hint }));
      row.appendChild(ctl);
      host.appendChild(row);
      reg('st-' + f.key, { el: 'data-dam-team-settings 行:' + f.label, contract: '§6.1', api: f.api, field: f.field, behavior: f.type === 'switch' ? '即时回显：先翻面再写盘（用户纪律）' : 'change 时经 saveConfigPatch 写盘' });
    });
    var test = el('button', { 'class': 'btn', type: 'button', text: '连通性自检', 'data-inspect': 'st-test', 'data-inspect-always': '1' });
    test.addEventListener('click', function () { toast('POST /team-state → 200 · 412ms · seq 18395'); });
    var leave = el('button', { 'class': 'btn btn-danger', type: 'button', text: '退出团队', 'data-inspect': 'st-leave', 'data-inspect-always': '1' });
    leave.addEventListener('click', function () {
      if (leave.getAttribute('data-arm') !== '1') { leave.setAttribute('data-arm', '1'); leave.textContent = '再点一次确认退出'; return; }
      leave.removeAttribute('data-arm'); leave.textContent = '退出团队';
      toast('demo：退出团队需要二次确认（同 removeArm 范式）');
    });
    var bar = el('div', { style: 'display:flex;gap:10px;margin-top:14px' });
    bar.appendChild(test); bar.appendChild(leave);
    host.appendChild(bar);
    reg('st-test', { el: 'data-dam-team-test', contract: '§6.1', api: 'POST /api/dsh-auto-memory/team-state', field: '—', behavior: '结果落 data-dam-team-test-result' });
    reg('st-leave', { el: 'data-dam-team-leave', contract: '§6.1', api: 'POST /team-leave', field: '—', behavior: '二次确认' });
    document.getElementById('cfg-preview').textContent = '当前改动：' + (Object.keys(cfgState).length ? JSON.stringify(cfgState) : '（无）') + ' — 实际实现走 saveConfigPatch(patch)';
  }

  /* ---------- ⑧ 同步调试面板 ---------- */
  function renderDebug() {
    var L = document.getElementById('dbg-last'); L.innerHTML = '';
    L.appendChild(el('div', { text: D.debug.last.at }));
    L.appendChild(el('div', { text: D.debug.last.ms + 'ms · ' + D.debug.last.bytes + ' B · 出 ' + D.debug.last.outbound + ' / 入 ' + D.debug.last.inbound }));
    L.appendChild(el('div', { 'class': 'tag tag-ok', text: D.debug.last.result }));
    L.setAttribute('data-inspect', 'dbg-last'); L.setAttribute('data-inspect-always', '1');
    reg('dbg-last', { el: 'data-dam-team-debug-last', contract: '§6.2', api: 'GET /api/dsh-auto-memory/team-sync-debug', field: 'last = { at, ms, bytes, outbound, inbound, result }', behavior: '只读展示' });
    var C = document.getElementById('dbg-cursor'); C.innerHTML = '';
    C.appendChild(el('div', { text: 'localSeq ' + D.state.localSeq }));
    C.appendChild(el('div', { text: 'serverSeq ' + D.state.serverSeq }));
    C.appendChild(el('div', { text: 'lag ' + (D.state.localSeq - D.state.serverSeq) }));
    C.setAttribute('data-inspect', 'dbg-cursor'); C.setAttribute('data-inspect-always', '1');
    reg('dbg-cursor', { el: 'data-dam-team-debug-cursor', contract: '§6.2', api: 'GET /team-sync-debug', field: 'localSeq / serverSeq / lag', behavior: 'lag 由前端派生' });
    var A = document.getElementById('dbg-actions'); A.innerHTML = '';
    var retry = el('button', { 'class': 'btn btn-primary', type: 'button', text: '重试失败项', 'data-inspect': 'dbg-retry', 'data-inspect-always': '1' });
    retry.addEventListener('click', function () { toast('POST team-sync-debug/retry → 重试 ' + D.queue.failed + ' 项'); });
    var reset = el('button', { 'class': 'btn btn-danger', type: 'button', text: '重置本地游标', 'data-inspect': 'dbg-reset', 'data-inspect-always': '1' });
    reset.addEventListener('click', function () {
      if (reset.getAttribute('data-arm') !== '1') { reset.setAttribute('data-arm', '1'); reset.textContent = '危险 · 再点确认'; return; }
      reset.removeAttribute('data-arm'); reset.textContent = '重置本地游标'; toast('已重置（demo）');
    });
    A.appendChild(retry); A.appendChild(reset);
    reg('dbg-retry', { el: 'data-dam-team-debug 重试按钮', contract: '§6.2', api: 'POST /team-sync-debug/retry', field: '—', behavior: '重试全部失败项' });
    reg('dbg-reset', { el: 'data-dam-team-debug 重置按钮', contract: '§6.2', api: 'POST /team-sync-debug/reset', field: '—', behavior: '危险操作，二次确认' });
    var T = document.getElementById('dbg-queue'); T.innerHTML = '';
    var head = "<thead><tr>" + ['条目', '类型', '重试次数', '最后错误', '下次重试'].map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead>';
    var rows = D.debug.items.map(function (q) {
      return '<tr><td>' + esc(q.id) + '</td><td>' + esc(q.kind) + '</td><td>' + q.attempts + '</td><td>' + esc(q.lastError) + '</td><td>' + esc(q.nextRetryAt) + '</td></tr>';
    }).join('');
    T.innerHTML = head + '<tbody>' + rows + '</tbody>';
    T.setAttribute('data-inspect', 'dbg-queue'); T.setAttribute('data-inspect-always', '1');
    reg('dbg-queue', { el: 'data-dam-team-debug-queue', contract: '§6.2', api: 'GET /team-sync-debug', field: 'queue.items[] = { id, kind, attempts, lastError, nextRetryAt }', behavior: '表格只读；重试走按钮' });
    var E = document.getElementById('dbg-errors'); E.innerHTML = '';
    D.debug.errors.forEach(function (e) { E.appendChild(el('li', { text: e.at + ' · ' + e.code + ' · ' + e.message })); });
    E.setAttribute('data-inspect', 'dbg-errors'); E.setAttribute('data-inspect-always', '1');
    reg('dbg-errors', { el: 'data-dam-team-debug-errors', contract: '§6.2', api: 'GET /team-sync-debug', field: 'errors[] = { at, code, message, retryable }', behavior: '诊断 JSON 不得含记忆正文（后端脱敏）' });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    renderStatusbar(); renderSyncCards(); renderMembers(); renderLibrary();
    renderConflicts(); renderSkills(); renderHandoff(); renderSettings(); renderDebug();
    goto('sync');
  }
  boot();
})();
</script>
</body>
</html>
