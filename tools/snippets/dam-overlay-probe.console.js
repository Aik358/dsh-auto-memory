(async () => {
  var L = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var sheet = function () { return document.getElementById('dam-skin-v4-style'); };
  var snap = function (tag) {
    var pn = document.querySelector('[data-dam-panel]');
    var th = document.querySelector('[data-dam-theme="panel"]');
    var o = {
      step: tag,
      panelPos: L('dsh-auto-memory.panel.pos'),
      skin: L('dam-skin'),
      skinStyle: L('dam-skin-style'),
      skinTheme: L('dam-skin-theme'),
      hasPanel: !!pn,
      hasPanelShell: !!th,
      shellDeep: th ? th.getAttribute('data-deep') : null,
      sheetExists: !!sheet(),
      sheetHasH35: !!(sheet() && sheet().textContent.indexOf('H35-LEGACY-OVERLAY-GLASS') >= 0),
      sheetFlavor: sheet() ? sheet().getAttribute('data-dam-skin-css') : null,
      hostBodyDark: document.body.hasAttribute('data-ds-dark-theme'),
      hostColorScheme: document.documentElement.style.colorScheme || null,
      hostThemeSource: document.documentElement.getAttribute('data-ds-theme-source') || null,
      sysPrefersDark: matchMedia('(prefers-color-scheme: dark)').matches
    };
    if (pn) {
      var c = getComputedStyle(pn);
      o.panelStyle = {
        bg: c.backgroundColor,
        blur: c.backdropFilter || c.webkitBackdropFilter || 'none',
        radius: c.borderRadius,
        solid: pn.getAttribute('data-solid'),
        inlineBg: pn.style.background || null
      };
    }
    return o;
  };
  var out = [snap('A_before')];
  if (!document.querySelector('[data-dam-panel]')) {
    var btn = document.querySelector('[data-dam-sidebar-btn]');
    out.push({ step: 'open_attempt', sidebarBtnFound: !!btn });
    if (btn) {
      btn.click();
      await new Promise(function (r) { setTimeout(r, 900); });
      out.push(snap('B_after_sidebar_click'));
    }
    if (!document.querySelector('[data-dam-panel]')) {
      var cands = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
        return /\u8bb0\u5fc6|Memory/.test(b.textContent || '');
      });
      out.push({ step: 'fallback', memoryButtons: cands.length });
      if (cands.length) {
        cands[0].click();
        await new Promise(function (r) { setTimeout(r, 900); });
        out.push(snap('C_after_fallback_click'));
      }
    }
  }
  console.log('=== DAM OVERLAY PROBE ===');
  console.log(JSON.stringify(out, null, 1));
})()