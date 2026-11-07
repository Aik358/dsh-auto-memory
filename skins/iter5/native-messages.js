    function Iter5Notice(props) {
      return h('aside', { className: 'i5-native-notice', 'data-native-dialog': props.kind, 'data-urgent': props.urgent ? 'true' : undefined, role: props.urgent ? 'alert' : 'region', 'aria-label': props.title },
        h('header', null, props.urgent ? h('i', { className: 'i5-notice-led', 'data-lit': 'true', 'aria-hidden': 'true' }) : h(Iter5Icon, { name: props.kind === 'welcomeBack' ? 'timeline' : 'note' }), h('h2', null, props.title)),
        h('p', { className: 'i5-notice-copy' }, props.message),
        h('footer', null, props.actions))
    }
    function Iter5Summary(props) {
      var sum = props.summary || {}
      return h(Iter5Dialog, { title: t('sumTitle'), onClose: props.onClose },
        h('div', { className: 'i5-native-summary-dialog' },
          sum.time ? h('p', { className: 'i5-muted' }, sum.time) : null,
          h(Iter5Document, { text: sum.summary || '' }),
          (sum.works || []).length ? h('div', { className: 'i5-summary-works' }, sum.works.map(function (work, i) {
            return h('section', { key: i }, h('h3', null, work.title || ''), (work.points || []).length ? h('ul', null, work.points.map(function (point, n) { return h('li', { key: n }, String(point)) })) : null)
          })) : null,
          h('div', { className: 'i5-dialog-footer' }, h('button', { className: 'i5-primary', onClick: props.onClose }, t('gotIt')))))
    }
    function Iter5Update(props) {
      var versions = props.versions || []
      return h(Iter5Dialog, { title: L('版本与更新说明', 'Version and release notes'), onClose: props.onClose },
        h('div', { className: 'i5-native-update' },
          h('header', null, h(Iter5Icon, { name: 'note' }), h('div', null, h('h3', null, 'dsh-auto-memory'), props.version ? h('p', null, L('当前版本 ', 'Current version ') + props.version) : null)),
          h('p', { className: 'i5-muted' }, t('updateSub')),
          versions.map(function (version, i) { return h('details', { key: version.version || i, open: i === 0 },
            h('summary', null, 'v' + version.version), h('ul', null, ((version.items && (version.items[locale] || version.items.zh)) || []).map(function (item, n) { return h('li', { key: n }, item) }))) }),
          h('div', { className: 'i5-dialog-footer' },
            h(UpgradeDetectEntryPre, { key: 'i5-upd-detect', style: { marginRight: 'auto', padding: '7px 12px', borderRadius: '9px', border: '1px solid var(--i5-line, rgba(128,128,128,.35))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '12.5px' } }),
            h('button', { className: 'i5-primary', onClick: props.onClose }, t('gotIt')))))
    }
    function Iter5AutoContinue(props) {
      var confirmation = props.confirmation
      return h('section', { 'data-dam-autocont': '', 'data-native-continuation': confirmation ? 'confirm' : props.executing ? 'progress' : 'notice', role: 'region', 'aria-label': L('会话接续', 'Session continuation') },
        h('header', { className: 'i5-continuation-heading' }, h(Iter5Icon, { name: 'handoff' }), h('h2', null, confirmation ? L('准备接续当前会话', 'Ready to continue this session') : props.executing ? L('正在接续', 'Continuing session') : L('接续状态', 'Continuation status')),
          h('button', { 'data-dam-autocont-close': '', 'aria-label': L('关闭交接提示', 'Dismiss handoff notice'), onClick: props.onDismiss }, h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M3 3l6 6M9 3l-6 6' })))),
        confirmation ? h('div', { 'data-dam-autocont-confirm': '' },
          h('p', { className: 'i5-continuation-warning' }, t('autoContConfirm').replace('{p}', String(Math.round((confirmation.ratio || 0) * 100)))),
          h('dl', { className: 'i5-continuation-facts' },
            h('dt', null, L('当前工作区', 'Current workspace')), h('dd', null, currentWs() || L('尚未定位', 'Not available')),
            h('dt', null, L('上下文用量', 'Context use')), h('dd', null, (confirmation.tokens || 0).toLocaleString() + ' / ' + (confirmation.window || 0).toLocaleString() + ' token'),
            confirmation.wall > 0 ? [h('dt', { key: 'wall-label' }, L('距硬上限', 'To hard limit')), h('dd', { key: 'wall' }, Math.max(0, confirmation.wall - confirmation.tokens).toLocaleString() + ' token')] : null,
            confirmation.ring > 0 ? [h('dt', { key: 'ring-label' }, L('官方小圈读数', 'Host ring reading')), h('dd', { key: 'ring' }, Math.round(confirmation.ring * 100) + '%')] : null),
          h('p', { className: 'i5-continuation-info' }, L('接续由宿主执行：刷新白板与账本、创建新会话，再注入交接材料。', 'The host refreshes the PLAN and ledger, creates a new session, and injects the handoff material.')),
          h('footer', null, props.countdown > 0 ? h('span', { role: 'timer' }, t('autoContTimeout').replace('{s}', String(props.countdown))) : null,
            h('button', { 'data-dam-btn': '', onClick: props.onReject }, t('autoContReject')),
            // ★#522 用户裁定（2026-11-07）：「终止进程」——**整个接续终止**，不是「跳过重试」。
            //   与左侧「拒绝」的区别（用户特意区分过，别混）：拒绝 = 只否掉这一次边界，水位再超标会重新 arm；
            //   终止 = 停掉整条接续（后端 action:'cancel'：清 armed + 中止正在跑的仪式 + 记 lastCancel）。
            //   文案用「终止进程」四个字，不写「跳过」——避免用户以为是「再试一次」的同义词。
            h('button', { 'data-dam-btn': '', 'data-dam-autocont-cancel': '', onClick: props.onCancel }, t('autoContCancel')),
            h('button', { 'data-dam-btn': '', 'data-primary': 'true', onClick: props.onAgree }, t('autoContAgree')))) : null,
        // ★#522：倒计时态也要能终止（用户裁定「终止进程」= 整个接续终止）。
        //   注意与拒绝按钮并存：拒绝=只否这一次边界；终止=停掉整条接续。
        !confirmation && props.countdown > 0 ? h('p', null, t('autoContCountdown').replace('{s}', String(props.countdown)), ' ', h('button', { 'data-dam-btn': '', onClick: props.onReject }, t('autoContReject')), ' ', h('button', { 'data-dam-btn': '', 'data-dam-autocont-cancel': '', onClick: props.onCancel }, t('autoContCancel'))) : null,
        props.executing ? h('div', { className: 'i5-continuation-progress', role: 'progressbar', 'aria-label': L('接续正在执行', 'Continuation in progress'), 'aria-busy': true }, h('span')) : null,
        props.status ? h('p', { className: 'i5-continuation-status', role: 'status' }, props.status) : null)
    }
