/* ══════════════════════════════════════════════════════════════════════
   step5-motion.js — Step5 修改版 · 文章页浮现动效（署名：Step5 · 2026-10-13）
   无依赖。DOM ready 后：
     1) hero 元素挂 .s5-hero-r（载入依次浮现，顺序 = DOM 顺序，自上而下）；
     2) 正文元素挂 .s5-r + IntersectionObserver，进入视口加 .s5-vis；
        左侧索引栏 .ptoc 不参与浮现（常驻可见，避免 IO 阈值未达时永久 opacity:0）；
        同一批进入视口的元素按「页面位置自上而下」错峰 —— 永远先上后下；
     3) 嵌套元素只动画最外层（figure 里的 .figbox、afterword 里的 .sign 不再重复挂载）；
     4) 浮现结束后清除内联 transition-delay，不影响 hover 过渡；
     5) 不支持 IO 或 reduced-motion → 全部直接可见（内容永不因动效隐藏）。
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(function () {
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    /* 1) hero 载入浮现（DOM 顺序 = 从上到下） */
    var hero = [].slice.call(document.querySelectorAll(
      '.phero .badge-pill, .phero .ptitle, .phero .psub, .phero .pmeta, .phero .tagline, .phero .cta-row'
    ));
    hero.forEach(function (el, i) {
      el.classList.add('s5-hero-r');
      if (i > 0) el.classList.add('d' + Math.min(i, 5));
    });

    /* 2) 正文滚动浮现 */
    var raw = [].slice.call(document.querySelectorAll(
      '.pabstract, .prose > h2, .prose > h3, .prose > p, .prose > ul, .prose > ol, .prose > blockquote,' +
      ' .prose figure, .figbox, .tbl, .pcard, .relgrid > a, .afterword, .sign'
    ));
    /* 只保留最外层：任何祖先也在名单里的元素，交给自己祖先统一动画 */
    var nodes = raw.filter(function (n) {
      var p = n.parentElement;
      while (p && p !== document.body) {
        if (raw.indexOf(p) >= 0) return false;
        p = p.parentElement;
      }
      return true;
    });

    if (reduce || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('s5-vis'); });
      hero.forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; el.style.animation = 'none'; });
      return;
    }

    nodes.forEach(function (n) { n.classList.add('s5-r'); });

    var io = new IntersectionObserver(function (es) {
      /* 同一批进入视口的元素，按页面位置自上而下排序后错峰 */
      var batch = es
        .filter(function (e) { return e.isIntersecting; })
        .map(function (e) { return e.target; })
        .sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
      batch.forEach(function (n, k) {
        var d = Math.min(k, 5) * 50;          /* 每批最多 6 档 × 50ms */
        n.style.transitionDelay = d + 'ms';
        n.classList.add('s5-vis');
        io.unobserve(n);
        /* 浮现结束后清掉内联延迟，避免拖累 hover 过渡 */
        window.setTimeout(function () { n.style.transitionDelay = ''; }, d + 900);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

    nodes.forEach(function (n) { io.observe(n); });
  });
})();
