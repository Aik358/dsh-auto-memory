/* dsh-auto-memory homepage interactions — zero dependencies
   1. bilingual toggle: zh text is the DOM source, data-en holds the swap;
      textContent replacement only — every [data-en] element must stay childless.
   2. scroll reveal via IntersectionObserver (threshold 0.15 → .in)
   3. copy buttons with clipboard API + textarea fallback
   4. prefers-reduced-motion: skip reveal animation entirely            */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var LANG_KEY = "dsh-am-lang";
  var currentLang = "zh";

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }

  function reduced() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { return false; }
  }

  /* ── language ─────────────────────────────────────────────── */

  function captureZh() {
    each(doc.querySelectorAll("[data-en]"), function (el) {
      if (!el.getAttribute("data-zh")) el.setAttribute("data-zh", el.textContent);
    });
    each(doc.querySelectorAll("[data-aria-en]"), function (el) {
      if (!el.getAttribute("data-aria-zh")) {
        el.setAttribute("data-aria-zh", el.getAttribute("aria-label") || "");
      }
    });
  }

  function applyLang(lang) {
    currentLang = lang;
    root.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    root.classList.toggle("lang-en", lang === "en");
    each(doc.querySelectorAll("[data-en]"), function (el) {
      var swap = el.getAttribute(lang === "en" ? "data-en" : "data-zh");
      if (swap !== null) el.textContent = swap;
    });
    each(doc.querySelectorAll("[data-aria-en]"), function (el) {
      var label = el.getAttribute(lang === "en" ? "data-aria-en" : "data-aria-zh");
      if (label !== null && label !== "") el.setAttribute("aria-label", label);
    });
    var t = doc.querySelector("title");
    if (t && t.getAttribute("data-en")) {
      doc.title = t.getAttribute(lang === "en" ? "data-en" : "data-zh") || t.textContent;
    }
    var btn = doc.getElementById("lang-toggle");
    if (btn) {
      btn.textContent = lang === "en" ? "中文" : "EN";
      btn.setAttribute("aria-pressed", String(lang === "en"));
    }
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
  }

  /* ── copy buttons ─────────────────────────────────────────── */

  function legacyCopy(text) {
    var ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
    doc.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function flashDone(btn) {
    var span = btn.querySelector("span") || btn;
    var restore = function () {
      span.textContent = currentLang === "en"
        ? (span.getAttribute("data-en") || "Copy")
        : (span.getAttribute("data-zh") || span.getAttribute("data-en") || "复制");
      btn.classList.remove("ok");
    };
    btn.classList.add("ok");
    span.textContent = currentLang === "en" ? "Copied" : "已复制";
    window.setTimeout(restore, 1600);
  }

  function bindCopy() {
    each(doc.querySelectorAll("[data-copy]"), function (btn) {
      btn.addEventListener("click", function () {
        copyText(btn.getAttribute("data-copy") || "").then(function (ok) {
          if (ok) flashDone(btn);
        });
      });
    });
  }

  /* ── scroll reveal ────────────────────────────────────────── */

  function bindReveal() {
    var items = doc.querySelectorAll(".rv");
    if (reduced() || !("IntersectionObserver" in window)) {
      each(items, function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      each(entries, function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    each(items, function (el) { io.observe(el); });
  }

  /* ── nav active-section highlight ─────────────────────────── */

  function bindNav() {
    var links = doc.querySelectorAll('.nav-links a[href^="#"]');
    if (!links.length || !("IntersectionObserver" in window)) return;
    var byId = {};
    each(links, function (a) {
      var id = a.getAttribute("href").slice(1);
      (byId[id] = byId[id] || []).push(a);
    });
    var watched = [];
    each(Object.keys(byId), function (id) {
      var sec = doc.getElementById(id);
      if (sec) watched.push(sec);
    });
    if (!watched.length) return;
    var nio = new IntersectionObserver(function (entries) {
      each(entries, function (entry) {
        if (!entry.isIntersecting) return;
        each(links, function (a) { a.classList.remove("on"); });
        var group = byId[entry.target.id];
        if (group) each(group, function (a) { a.classList.add("on"); });
      });
    }, { rootMargin: "-38% 0px -55% 0px" });
    each(watched, function (sec) { nio.observe(sec); });
  }

  /* ── init ─────────────────────────────────────────────────── */

  function init() {
    captureZh();
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* private mode */ }
    applyLang(saved === "en" ? "en" : "zh");
    var btn = doc.getElementById("lang-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        applyLang(currentLang === "en" ? "zh" : "en");
      });
    }
    bindCopy();
    bindReveal();
    bindNav();
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
