  /* ---------- ③ 记忆库 ---------- */
  var libFilter = { author: 'all', scope: 'all', sync: 'all' };
  function renderLibrary() {
    var bar = $('[data-dam-team-filterbar]'); bar.innerHTML = '';
    function mkSelect(key, label, opts, inspectKey, field) {
      var wrap = el('label', { style: 'display:inline-flex;align-items:center;gap:6px', 'data-inspect': inspectKey, 'data-inspect-always': '1' });
      wrap.appendChild(el('span', { 'class': 'faint', text: label }));
      var s = el('select', {});
      opts.forEach(function (o) {
        var op = el('option', { value: o[0], text: o[1] });
        if (libFilter[key] === o[0]) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', function () { libFilter[key] = this.value; renderLibrary(); toast('筛选：' + label + ' = ' + this.value); });
      wrap.appendChild(s);
      reg(inspectKey, { el: 'data-dam-team-filter-' + key, contract: '§4', api: 'GET /api/dsh-auto-memory/team-attribution', field: field, behavior: '前端本地筛选（记忆库已一次拉全），不触发二次全量请求' });
      return wrap;
    }
    var authorOpts = [['all', '全部作者']].concat(D.members.map(function (m) { return [m.id, m.name]; }));
    bar.appendChild(mkSelect('author', '作者', authorOpts, 'fb-author', 'view.filterAuthors[] ← memory.actor.id'));
    bar.appendChild(mkSelect('scope', '来源', [['all', '全部来源'], ['local', '本机'], ['team', '团队'], ['imported', '外部导入']], 'fb-scope', 'view.filterScope ← memory.scope'));
    bar.appendChild(mkSelect('sync', '同步状态', [['all', '全部状态'], ['synced', '已同步'], ['pending', '待同步'], ['conflicted', '有冲突']], 'fb-sync', 'view.filterSync ← memory.syncState'));
    var cnt = el('span', { 'class': 'faint' });
    var host = $('#lib-list'); host.innerHTML = '';
    var rows = D.memories.filter(function (m) {
      return (libFilter.author === 'all' || m.actorId === libFilter.author) &&
             (libFilter.scope === 'all' || m.scope === libFilter.scope) &&
             (libFilter.sync === 'all' || m.sync === libFilter.sync);
    });
    cnt.textContent = '命中 ' + rows.length + ' / ' + D.memories.length + ' 条';
    bar.appendChild(cnt);
    rows.forEach(function (m, i) {
      var m2 = member(m.actorId);
      var row = el('div', { 'data-dam-team-libitem': '', 'data-inspect': 'lib-' + i, 'data-inspect-always': '1' });
      var av = el('div', { 'data-dam-team-avatar': '', text: initials(m2.name) });
      av.style.setProperty('--t-hue', String(m2.hue));
      var body = el('div', { style: 'flex:1;min-width:0' });
      body.appendChild(el('div', { style: 'font-weight:600', text: m.title }));
      var meta = el('div', { 'class': 'faint', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px' });
      meta.appendChild(el('span', { text: m.at }));
      meta.appendChild(el('span', { text: '· ' + m2.name }));
      meta.appendChild(el('span', { style: 'font-family:var(--skin-font-mono)', text: m.id }));
      meta.appendChild(el('span', { 'data-dam-team-badge': '', 'data-scope': m.scope, text: m.scope === 'team' ? '团队' : (m.scope === 'local' ? '本机' : '外部导入') }));
      meta.appendChild(el('span', { 'class': 'tag ' + (m.sync === 'conflicted' ? 'tag-warn' : (m.sync === 'pending' ? 'tag-info' : 'tag-ok')), text: m.sync }));
      m.tags.forEach(function (t) { meta.appendChild(el('span', { 'class': 'faint', text: '#' + t })); });
      body.appendChild(meta);
      row.appendChild(av); row.appendChild(body);
      host.appendChild(row);
      reg('lib-' + i, { el: 'data-dam-team-libitem + data-dam-team-badge', contract: '§4', api: 'GET /memory-hub（既有） + GET /team-attribution', field: 'memory.{id,title,scope,actor,syncState,updatedAt} + memory.teamId', behavior: '徽标是追加在记忆卡尾部的子节点，不改既有 data-dam-card 结构' });
    });
    if (!rows.length) host.appendChild(el('div', { 'class': 'muted', text: '没有命中条目 —— 把筛选调回「全部」试试。' }));
  }

  /* ---------- ④ 冲突中心 ---------- */
  var selConflict = 0, verdictArmed = null;
  function renderConflicts() {
    var list = $('#conflict-list'); list.innerHTML = '';
    D.conflictsData.forEach(function (c, i) {
      var b = el('button', { 'data-dam-team-conflict': '', type: 'button', 'aria-selected': i === selConflict ? 'true' : 'false', 'data-inspect': 'cf-' + i, 'data-inspect-always': '1' });
      b.appendChild(el('div', { style: 'font-weight:650', text: c.title }));
      b.appendChild(el('div', { 'class': 'faint', text: c.detectedAt + ' · ' + c.kind }));
      b.addEventListener('click', function () { selConflict = i; verdictArmed = null; renderConflicts(); });
      list.appendChild(b);
      reg('cf-' + i, { el: 'data-dam-team-conflict', contract: '§5.1', api: 'GET /api/dsh-auto-memory/team-conflicts', field: 'conflict.{id,memoryId,kind,title,detectedAt}', behavior: '选中后右侧渲染双栏差异' });
    });
    var detail = $('#conflict-detail'); detail.innerHTML = '';
    if (!D.conflictsData.length) {
      detail.appendChild(el('div', { 'class': 'muted', text: '没有待裁决冲突 —— 状态条会回到「已同步」。' }));
      return;
    }
    var c = D.conflictsData[selConflict];
    var head = el('div', { 'data-dam-team-conflict-head': '', 'data-inspect': 'cf-head', 'data-inspect-always': '1' });
    head.appendChild(el('b', { text: c.title }));
    head.appendChild(el('div', { 'class': 'faint', text: '冲突 ' + c.id + ' · 记忆 ' + c.memoryId + ' · 检出 ' + c.detectedAt }));
    detail.appendChild(head);
    reg('cf-head', { el: 'data-dam-team-conflict-head', contract: '§5.1', api: 'GET /team-conflicts', field: 'conflict.{id,memoryId,title,detectedAt}', behavior: '只读展示' });
    var diff = el('div', { 'data-dam-team-diff': '', 'data-inspect': 'cf-diff', 'data-inspect-always': '1' });
    var left = el('div', { 'data-dam-team-diff-local': '' });
    left.appendChild(el('header', { text: '本机版本 · ' + member('u-01').name }));
    var right = el('div', { 'data-dam-team-diff-remote': '' });
    right.appendChild(el('header', { text: '团队版本 · 由 ' + member('u-02').name + ' 写入' }));
    c.diff.forEach(function (d) {
      if (d.op !== 'add') left.appendChild(el('div', { 'data-dam-team-diff-line': '', 'data-op': d.op, text: (d.op === 'del' ? '- ' : '  ') + d.text }));
      if (d.op !== 'del') right.appendChild(el('div', { 'data-dam-team-diff-line': '', 'data-op': d.op === 'add' ? 'add' : 'same', text: (d.op === 'add' ? '+ ' : '  ') + d.text }));
    });
    diff.appendChild(left); diff.appendChild(right);
    detail.appendChild(diff);
    reg('cf-diff', { el: 'data-dam-team-diff', contract: '§5.1', api: 'GET /team-conflicts', field: 'conflict.diff[] = { op: same|add|del, text }', behavior: '左右两栏由同一份 diff 渲染；配色只用 --skin-color-ok/err' });
    var verdict = el('div', { 'data-dam-team-verdict': '', 'data-inspect': 'cf-verdict', 'data-inspect-always': '1' });
    function verdictBtn(label, choiceKey, danger, note) {
      var b = el('button', { 'class': 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', text: label, 'data-inspect': 'cf-' + choiceKey, 'data-inspect-always': '1' });
      b.addEventListener('click', function () {
        var token = c.id + ':' + choiceKey;
        if (verdictArmed !== token) { verdictArmed = token; renderConflicts(); toast('确认态：再点一次才提交「' + label + '」'); return; }
        D.conflicts.open = Math.max(0, D.conflicts.open - 1);
        D.conflictsData.splice(selConflict, 1);
        if (selConflict >= D.conflictsData.length) selConflict = 0;
        verdictArmed = null;
        renderConflicts(); renderStatusbar();
        toast('已裁决（POST team-conflicts/resolve choice=' + choiceKey + '）');
      });
      reg('cf-' + choiceKey, { el: 'data-dam-team-verdict ' + label, contract: '§5.1', api: 'POST /api/dsh-auto-memory/team-conflicts/resolve', field: 'body: { id, choice: "' + choiceKey + '", content?, assignee? }', behavior: note });
      return b;
    }
    verdict.appendChild(verdictBtn('采用本机', 'keep-local', false, '二次确认后提交；团队侧内容会丢失'));
    verdict.appendChild(verdictBtn('采用团队', 'keep-remote', true, '二次确认后提交；本机内容会丢失'));
    var merge = el('button', { 'class': 'btn', type: 'button', text: '手工合并', 'data-inspect': 'cf-merge', 'data-inspect-always': '1' });
    merge.addEventListener('click', function () { toast('进入编辑态（demo 不实现正文编辑）'); });
    verdict.appendChild(merge);
    reg('cf-merge', { el: 'data-dam-team-verdict 手工合并', contract: '§5.1', api: 'POST /team-conflicts/resolve', field: 'body: { id, choice: "merge", content }', behavior: '需人工编辑后提交' });
    var ask = el('button', { 'class': 'btn btn-ghost', type: 'button', text: '指派他人', 'data-inspect': 'cf-ask', 'data-inspect-always': '1' });
    ask.addEventListener('click', function () { toast('已指派给 ' + member('u-03').name + '（demo）'); });
    verdict.appendChild(ask);
    reg('cf-ask', { el: 'data-dam-team-verdict 指派他人', contract: '§5.1', api: 'POST /team-conflicts/delegate', field: 'body: { id, assignee }', behavior: '皮肤插槽 conflict.actions 也挂这一行，只允许追加按钮' });
    verdict.appendChild(el('span', { 'class': verdictArmed ? 'tag tag-warn' : 'faint', text: verdictArmed ? '再次点击确认' : '采纳不可逆：首次点击只进入确认态' }));
    detail.appendChild(verdict);
  }
