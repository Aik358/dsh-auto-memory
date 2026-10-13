/* ══════════════════════════════════════════════════════════════════════
   i18n.js — 技术报告中英切换（7 篇共用）
   机制与主页 / news 索引页一致：localStorage 的 am-lang 为唯一真源；
   由 theme.js 管按钮的 is-on/active 状态与点击，本文件只负责「把文案换掉」。
   字典由各页内联的 <script type="application/json" id="i18n-en"> 提供，
   键为中文内容的内容哈希 —— 改中文不会串行，未命中的条目自动回退中文。
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  var KEY = 'am-lang';
  function stored() {
    try { var v = localStorage.getItem(KEY); return (v === 'zh' || v === 'en') ? v : null; } catch (e) { return null; }
  }
  function defaultLang() {
    var s = stored();
    if (s) return s;
    try { return (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'zh'; } catch (e) { return 'zh'; }
  }
  var node = document.getElementById('i18n-en');
  var en = {};
  if (node) { try { en = JSON.parse(node.textContent || '{}') || {}; } catch (e) { en = {}; } }
  var hasDict = Object.keys(en).length > 0;

  /* 记录原始中文，切换可逆 */
  var items = [];
  function collect() {
    items = [];
    var els = document.querySelectorAll('[data-i18n-hash]');
    function unesc(s) {
      return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    for (var i = 0; i < els.length; i++) items.push({ el: els[i], zh: unesc(els[i].getAttribute('data-i18n-zh') || '') });
  }
  function apply(lang) {
    var want = (lang === 'en' && hasDict) ? 'en' : 'zh';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var key = it.el.getAttribute('data-i18n-hash');
      var text = (want === 'en' && en[key]) ? en[key] : it.zh;
      if (it.el.innerHTML !== text) it.el.innerHTML = text;
    }
    if (want === 'en' && en['__title__']) { if (!document.documentElement.dataset.zhTitle) document.documentElement.dataset.zhTitle = document.title; document.title = en['__title__']; }
    else if (want === 'zh' && document.documentElement.dataset.zhTitle) { document.title = document.documentElement.dataset.zhTitle; }
    document.documentElement.lang = want === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.lang = want;
    var btns = document.querySelectorAll('.lang-switch button[data-lang]');
    for (var j = 0; j < btns.length; j++) {
      var on = btns[j].getAttribute('data-lang') === want;
      btns[j].classList.toggle('is-on', on);
      btns[j].classList.toggle('active', on);
      btns[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  /* 复刻 theme.js 的默认口径：无存储值时以 zh 渲染，避免英文闪烁 */
  collect();
  apply(stored() || 'zh');
  window.addEventListener('am-lang-change', function (ev) {
    apply(ev && ev.detail ? ev.detail : stored() || 'zh');
  });
  /* theme.js 里的按钮点击会写 localStorage，这里监听同源变化 + 点击兜底 */
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.lang-switch button[data-lang]') : null;
    if (!b) return;
    var l = b.getAttribute('data-lang');
    setTimeout(function () { apply(l === 'en' ? 'en' : 'zh'); }, 0);
  }, true);
  window.addEventListener('storage', function (ev) { if (ev.key === KEY) apply(stored() || 'zh'); });
  /* 供外部手动触发 */
  window.__amI18n = { apply: apply, dict: en, ready: hasDict };
})();
