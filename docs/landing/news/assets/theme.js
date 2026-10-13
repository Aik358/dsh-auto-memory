/* ═══════════════════════════════════════════════════════════════════════
   theme.js — 主题 / 语言 / 滚动揭示。零依赖，defer 加载即自绑事件。

   契约（冻结）：
     ① 主题：读 localStorage 的 am-theme；无值则跟随 prefers-color-scheme，
        写到 document.documentElement.dataset.theme（light | dark）；
        点 #theme-toggle 在 light / dark 间切换并回写 am-theme；
        未手动选过时，跟随系统变化实时同步。
     ② 语言：读 am-lang（默认 zh），写到 html 的 data-lang；
        点 .lang-switch 内 button[data-lang] 切换、回写 am-lang，
        并把选中项加 .is-on（同时兼容主页旧的 .active）。
     ③ 不报错、不依赖任何第三方库；找不到元素就静默跳过。
     ④ 可选增强：给 <html> 加 .js-reveal，使 .reveal 元素滚动入场；
        脚本缺席时页面只是没有入场动效，内容不隐藏。
     ⑤ 可重入：页面若自带同款内联脚本（老页面），本脚本只做初始同步，
        不重复绑事件、不重复切换 —— 一次点击永远只翻一次。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var THEME_KEY = 'am-theme';
  var LANG_KEY = 'am-lang';
  var root = document.documentElement;

  /* ── 存储：localStorage 不可用时（隐私模式 / file://）静默降级 ── */
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
  }

  /* ── 同一事件内只允许一个处理器生效（防页面内联脚本 + 本脚本双翻） ── */
  function claim(ev) {
    if (ev.__amClaimed) return false;
    ev.__amClaimed = true;
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    return true;
  }

  /* ══ ① 主题 ══════════════════════════════════════════════════════ */
  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }
  function storedTheme() {
    var v = readStore(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  }
  function applyTheme(theme) {
    root.dataset.theme = theme;
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }
  function currentTheme() {
    var t = root.dataset.theme || root.getAttribute('data-theme');
    return t === 'dark' || t === 'light' ? t : systemTheme();
  }
  function initTheme() {
    /* 与主页对齐：主页主题默认硬编码 light、不跟随系统（docs/landing/index.html setTheme 调用点）。
       此处必须同为 light，否则系统为深色时 news 全黑、主页全白，两页肤色相反。 */
    applyTheme(storedTheme() || 'light');

    var btn = document.getElementById('theme-toggle');
    if (btn && !btn.__amThemeBound) {
      btn.__amThemeBound = true;
      btn.addEventListener('click', function (ev) {
        if (!claim(ev)) return;
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        writeStore(THEME_KEY, next);
        applyTheme(next);
      });
    }

    /* 不监听系统主题变化：与主页一致，只有用户点按钮才切 */
  }

  /* ══ ② 语言 ══════════════════════════════════════════════════════ */
  function storedLang() {
    var v = readStore(LANG_KEY);
    return v === 'zh' || v === 'en' ? v : 'zh';
  }
  function syncLangButtons(lang) {
    var btns = document.querySelectorAll('.lang-switch button[data-lang]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-lang') === lang;
      btns[i].classList.toggle('is-on', on);
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function applyLang(lang) {
    root.dataset.lang = lang;
    root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    syncLangButtons(lang);
  }
  function initLang() {
    applyLang(storedLang());
    var btns = document.querySelectorAll('.lang-switch button[data-lang]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.__amLangBound) continue;
      b.__amLangBound = true;
      b.addEventListener('click', function (ev) {
        if (!claim(ev)) return;
        var lang = this.getAttribute('data-lang');
        if (lang !== 'zh' && lang !== 'en') return;
        writeStore(LANG_KEY, lang);
        applyLang(lang);
      });
    }
  }

  /* ══ ④ 滚动揭示（可选增强） ══════════════════════════════════════ */
  function initReveal() {
    var items = document.querySelectorAll('.reveal:not(.visible)');
    if (!items.length) return;
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* 忽略 */ }
    if (reduce || !('IntersectionObserver' in window)) {
      for (var j = 0; j < items.length; j++) items[j].classList.add('visible');
      return;
    }
    root.classList.add('js-reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    for (var k = 0; k < items.length; k++) io.observe(items[k]);
  }

  /* ══ 启动 ════════════════════════════════════════════════════════ */
  function boot() {
    initTheme();
    initLang();
    initReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
