/* dsh-auto-memory landing — lang · in-view gating · copy · archive terminal · seq player */
(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;
  function reduced() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* ── language toggle: zh is the source text, data-en holds the swap ── */
  var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-en]"));
  nodes.forEach(function (n) {
    if (!n.hasAttribute("data-zh")) n.setAttribute("data-zh", n.textContent);
  });
  function lang() { return body.getAttribute("data-lang") === "en" ? "en" : "zh"; }
  function applyLang(l) {
    body.setAttribute("data-lang", l);
    root.setAttribute("lang", l === "en" ? "en" : "zh-CN");
    nodes.forEach(function (n) {
      var t = n.getAttribute(l === "en" ? "data-en" : "data-zh");
      if (t !== null) n.textContent = t;
    });
    var btn = document.getElementById("langBtn");
    if (btn) btn.textContent = l === "en" ? "中文" : "EN";
    try { localStorage.setItem("am-lang", l); } catch (e) { /* session-only */ }
    document.dispatchEvent(new CustomEvent("am:lang"));
  }
  var saved = "zh";
  try { saved = localStorage.getItem("am-lang") || "zh"; } catch (e) { /* default zh */ }
  applyLang(saved === "en" ? "en" : "zh");
  var langBtn = document.getElementById("langBtn");
  if (langBtn) langBtn.addEventListener("click", function () {
    applyLang(lang() === "en" ? "zh" : "en");
  });

  /* ── reveal + start animations only in viewport ── */
  var targets = Array.prototype.slice.call(document.querySelectorAll(".reveal, .sheet"));
  if (reduced() || !("IntersectionObserver" in window)) {
    targets.forEach(function (t) { t.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) en.target.classList.add("in");
        else if (en.target.classList.contains("sheet")) en.target.classList.remove("in");
      });
    }, { threshold: 0.15 });
    targets.forEach(function (t) { io.observe(t); });
  }

  /* ── copy install command ── */
  var copyBtn = document.getElementById("copyBtn");
  if (copyBtn) copyBtn.addEventListener("click", function () {
    var text = (document.getElementById("cmdText") || {}).textContent || "";
    function done() {
      var zh = copyBtn.getAttribute("data-zh") || "复制";
      copyBtn.textContent = "✓";
      setTimeout(function () { copyBtn.textContent = lang() === "en" ? "COPY" : zh; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) { /* unavailable */ }
      document.body.removeChild(ta); done();
    }
  });

  /* ══ SHEET 05 · ARCHIVE TERMINAL ════════════════════════════════
     RhineLabUI patterns (array / lift / decrypt-lines / wave / boot),
     translated to ink-wireframe on paper. Canvas 2D only, zero deps. */
  (function () {
    var sec = document.getElementById("terminal");
    if (!sec) return;
    var canvas = document.getElementById("termCanvas");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var out = document.getElementById("termOut");
    var reduce = reduced();

    var INK = "hsla(0,0%,100%,.9)", INK2 = "hsla(0,0%,100%,.56)", SOFT = "hsla(0,0%,100%,.10)",
        ACC = "#6799fe", ACCI = "#8fb4ff", PAPER = "#15171c";

    var ARCH = [
      { t: ["无问自忆", "PROACTIVE RECALL"], w: ["注入面 · 固定边界", "injection · fixed boundary"], d: ["宿主盯着上下文，在固定边界自动注入召回，零指令、前缀缓存友好。", "The host injects recalls at a fixed boundary — zero instructions, cache-friendly."] },
      { t: ["三层记忆", "THREE-LAYER MEMORY"], w: ["注入面 · 三层", "injection · three layers"], d: ["用户级规则 → 项目级笔记 → 每日日志，常驻注入 + 按需检索。", "User rules → project notes → daily logs; always-on + on-demand."] },
      { t: ["记忆自己写自己", "MEMORY WRITES ITSELF"], w: ["后台 · 子代理", "background · subagent"], d: ["子代理逐轮静默评估对话，把值得留的按主题归档成条目。", "A subagent quietly evaluates every turn and files topic-grouped entries."] },
      { t: ["唤起可审计", "AUDITABLE ACTIVATIONS"], w: ["唤起回顾页签", "Recall review tab"], d: ["每次召回都带完整证据链，可逐条评分、可查、可改、可删。", "Every recall carries evidence — gradeable, editable, deletable."] },
      { t: ["主动提醒", "PROACTIVE REMINDERS"], w: ["日历页签", "Calendar tab"], d: ["从对话里识别截止日期与承诺，写入日历，到点提醒。", "Deadlines and promises are filed to the calendar and surfaced on time."] },
      { t: ["一切皆开关", "EVERYTHING IS A SWITCH"], w: ["设置页 · 向导", "Settings · tour"], d: ["首启向导 + 设置页，每个功能单独可开关，含无人值守模式。", "Tour + settings; every feature individually toggleable."] },
      { t: ["外部记忆继承", "EXT. INHERITANCE"], w: ["连接页签", "Connect tab"], d: ["WorkBuddy / CodeBuddy / Claude Code / Codex 的记忆可扫描、可导入、分源管理。", "Memories from other AI tools are scanned, importable, per-source."] },
      { t: ["生产级卫生", "PRODUCTION HYGIENE"], w: ["引擎 · 写入侧", "engine · write side"], d: ["乱码、卡顿、JSON 注入在写入侧被拦截；凭据永不进入提示词。", "Mojibake, stutter and JSON-injection blocked at write time."] },
      { t: ["上下文管理", "CONTEXT MANAGEMENT"], w: ["接续页签", "Handoff tab"], d: ["四段式交接笔记跨窗口续命，全程历史保持可检索；水位感知（实验）。", "Four-part handoff notes carry work across windows, searchable."] },
      { t: ["工作区隔离", "WORKSPACE ISOLATION"], w: ["工作区页签", "Workspace tab"], d: ["多工作区/多会话并行，各自召回决策与索引缓存互不打扰。", "Parallel sessions keep their own recall decisions and caches."] },
      { t: ["模型无关", "MODEL-AGNOSTIC"], w: ["设置 · 引擎", "Settings · engine"], d: ["词法 0GB 起步；内置 ~130MB 语义档；Python int8 ~563MB 进阶。", "Lexical 0GB floor; ~130MB semantic tier; ~563MB advanced."] },
      { t: ["记忆可携带", "PORTABLE MEMORY"], w: ["数据面 · 磁盘", "data · your disk"], d: ["一切都在你自己的磁盘上，每条记忆可查、可改、可删。", "Everything on your own disk; every entry auditable and deletable."] }
    ];
    var COLS = 3, ROWS = 4, CW = 196, CH = 100, GX = 224, GY = 112;

    var yaw = -0.34, pitch = 0.15, tYaw = yaw, tPitch = pitch;
    var sel = { c: 1, r: 1 }, lastSel = null, decrypt = 1, lastInput = 0;
    var raf = 0, running = false, booted = false, t0 = 0;

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);

    function proj(x, y, z, cx, cy) {
      var x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
      var z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
      var y1 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
      var z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
      var s = 920 / (920 + z2);
      return { x: cx + x1 * s, y: cy + y1 * s, s: s, z: z2 };
    }

    function cardCenter(c, r, t) {
      var lift = (sel.c === c && sel.r === r) ? 40 : 0;
      var wave = reduce ? 0 : Math.sin(t * 2.2 + c * 0.9 + r * 0.55) * 6;
      return { x: (c - 1) * GX, y: (r - 1.5) * GY + wave, z: (c - 1) * 18 + lift };
    }

    function drawCard(c, r, t, cx, cy) {
      var p = cardCenter(c, r, t);
      var active = sel.c === c && sel.r === r;
      var pts = [
        proj(p.x - CW / 2, p.y - CH / 2, p.z, cx, cy),
        proj(p.x + CW / 2, p.y - CH / 2, p.z, cx, cy),
        proj(p.x + CW / 2, p.y + CH / 2, p.z, cx, cy),
        proj(p.x - CW / 2, p.y + CH / 2, p.z, cx, cy)
      ];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = PAPER; ctx.fill();
      ctx.strokeStyle = active ? ACC : INK;
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      /* two redacted field lines */
      ctx.strokeStyle = SOFT; ctx.lineWidth = 0.75;
      var l1a = proj(p.x - CW / 2 + 20, p.y + 16, p.z, cx, cy), l1b = proj(p.x + CW / 2 - 20, p.y + 16, p.z, cx, cy);
      var l2a = proj(p.x - CW / 2 + 20, p.y + 32, p.z, cx, cy), l2b = proj(p.x + CW / 2 - 56, p.y + 32, p.z, cx, cy);
      ctx.beginPath(); ctx.moveTo(l1a.x, l1a.y); ctx.lineTo(l1b.x, l1b.y);
      ctx.moveTo(l2a.x, l2a.y); ctx.lineTo(l2b.x, l2b.y); ctx.stroke();
      /* index number */
      var n = proj(p.x - CW / 2 + 16, p.y - CH / 2 + 22, p.z, cx, cy);
      ctx.fillStyle = active ? ACCI : INK2;
      ctx.font = "700 12px ui-monospace, Consolas, monospace";
      var idx = String(c * ROWS + r + 1);
      ctx.fillText(idx, n.x - 6, n.y + 4);
      /* decrypt lines converge on selection */
      if (active && decrypt < 1) {
        var q = Math.floor(decrypt * 12) / 12;
        var a1 = proj(p.x - CW / 2, p.y - CH / 2, p.z, cx, cy);
        var a2 = proj(p.x - CW / 2 + CW * q, p.y - CH / 2 + CH * q, p.z, cx, cy);
        var b1 = proj(p.x + CW / 2, p.y + CH / 2, p.z, cx, cy);
        var b2 = proj(p.x + CW / 2 - CW * q, p.y + CH / 2 - CH * q, p.z, cx, cy);
        ctx.strokeStyle = ACCI; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
        ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      }
      /* corner brackets on selection */
      if (active) {
        var m = 9, L = 14;
        ctx.strokeStyle = ACC; ctx.lineWidth = 1.5;
        [[pts[0], 1, 1], [pts[1], -1, 1], [pts[2], -1, -1], [pts[3], 1, -1]].forEach(function (k) {
          ctx.beginPath();
          ctx.moveTo(k[0].x + m * k[1], k[0].y + m * k[2]);
          ctx.lineTo(k[0].x + (m - L) * k[1], k[0].y + m * k[2]);
          ctx.moveTo(k[0].x + m * k[1], k[0].y + m * k[2]);
          ctx.lineTo(k[0].x + m * k[1], k[0].y + (m - L) * k[2]);
          ctx.stroke();
        });
      }
    }

    function drawGround(cx, cy, t) {
      ctx.strokeStyle = SOFT; ctx.lineWidth = 0.75;
      var y0 = (ROWS / 2) * GY + 78;
      for (var i = -3; i <= 3; i++) {
        var a = proj(-390, y0, i * 42, cx, cy), b = proj(390, y0, i * 42, cx, cy);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (var j = -5; j <= 5; j++) {
        var c1 = proj(j * 84, y0, -130, cx, cy), c2 = proj(j * 84, y0, 130, cx, cy);
        ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
      }
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      /* background register: smooth 60fps (follows refresh rate) */
      if (!t0) t0 = now;
      var t = (now - t0) / 1000;
      if (now - lastInput > 3500 && !reduce) tYaw += 0.0011;
      yaw += (tYaw - yaw) * 0.08;
      pitch += (tPitch - pitch) * 0.08;
      /* decrypt-lines keep the 12fps stepped hand-drawn feel */
      if (decrypt < 1) decrypt = Math.min(1, decrypt + 1 / 12);
      var w = canvas.clientWidth, h = canvas.clientHeight, cx = w / 2, cy = h / 2 - 6;
      ctx.clearRect(0, 0, w, h);
      drawGround(cx, cy, t);
      var order = [];
      for (var c = 0; c < COLS; c++) for (var r = 0; r < ROWS; r++) order.push({ c: c, r: r, z: cardCenter(c, r, t).z });
      order.sort(function (a, b) { return b.z - a.z; });
      order.forEach(function (o) { drawCard(o.c, o.r, t, cx, cy); });
    }

    /* ── boot typing (RhineLabUI pattern, wireframe-ized) ── */
    var BOOT = [
      "MEM-OS/3.0 · ARCHIVE TERMINAL",
      "> mount ~/.dsh/memory ............... OK",
      "> stores: fact / episodic / procedure OK",
      "> files: 12 · evidence: VERIFIED",
      "> ready — arrows select · drag orbits"
    ];
    function typeBoot() {
      if (!out) { booted = true; return; }
      if (reduce) {
        out.textContent = BOOT.join("\n");
        booted = true; return;
      }
      var li = 0, ci = 0, buf = [];
      var iv = setInterval(function () {
        if (li >= BOOT.length) { clearInterval(iv); booted = true; return; }
        ci += 3;
        var line = BOOT[li];
        var done = ci >= line.length;
        var part = done ? line : line.slice(0, ci);
        var html = part.replace(/OK$/, '<span class="ok">OK</span>')
                       .replace(/VERIFIED$/, '<span class="ok">VERIFIED</span>');
        out.innerHTML = buf.concat(html).join("\n");
        if (done) { buf.push(line.replace(/OK$/, '<span class="ok">OK</span>').replace(/VERIFIED$/, '<span class="ok">VERIFIED</span>')); li++; ci = 0; }
      }, 1000 / 24);
    }

    /* ── side panel: rolling number + typed fields ── */
    var tpNo = document.getElementById("tpNo"), tpTitle = document.getElementById("tpTitle"),
        tpWhere = document.getElementById("tpWhere"), tpDesc = document.getElementById("tpDesc");
    var typeTimer = 0;
    function stopType() { if (typeTimer) { clearInterval(typeTimer); typeTimer = 0; } }
    function paintPanel(instant) {
      if (!tpNo) return;
      var a = ARCH[sel.c * ROWS + sel.r];
      var L = lang() === "en" ? 1 : 0;
      stopType();
      if (instant || reduce) {
        tpNo.textContent = String(sel.c * ROWS + sel.r + 1).padStart(2, "0");
        tpTitle.textContent = a.t[L]; tpWhere.textContent = a.w[L]; tpDesc.textContent = a.d[L];
        return;
      }
      var from = parseInt(tpNo.textContent, 10) || 1, to = sel.c * ROWS + sel.r + 1, step = 0;
      var iv = setInterval(function () {
        step++;
        tpNo.textContent = String(Math.round(from + (to - from) * step / 8)).padStart(2, "0");
        if (step >= 8) clearInterval(iv);
      }, 1000 / 24);
      var s1 = a.t[L], s2 = a.w[L], s3 = a.d[L], k = 0;
      typeTimer = setInterval(function () {
        k += 2;
        tpTitle.textContent = s1.slice(0, Math.min(k, s1.length));
        tpWhere.textContent = s2.slice(0, Math.max(0, Math.min(k - s1.length, s2.length)));
        tpDesc.textContent = s3.slice(0, Math.max(0, Math.min(k - s1.length - s2.length, s3.length)));
        if (k >= s1.length + s2.length + s3.length) { stopType(); }
      }, 1000 / 12);
    }

    function setSel(c, r) {
      sel = { c: (c + COLS) % COLS, r: (r + ROWS) % ROWS };
      decrypt = 0; lastInput = performance.now();
      paintPanel(false);
    }
    paintPanel(true);

    document.addEventListener("am:lang", function () { paintPanel(true); });

    /* arrows work while the canvas is focused (page scrolling stays free) */
    canvas.addEventListener("keydown", function (e) {
      var h = true;
      if (e.key === "ArrowUp") setSel(sel.c, sel.r - 1);
      else if (e.key === "ArrowDown") setSel(sel.c, sel.r + 1);
      else if (e.key === "ArrowLeft") setSel(sel.c - 1, sel.r);
      else if (e.key === "ArrowRight") setSel(sel.c + 1, sel.r);
      else h = false;
      if (h) e.preventDefault();
    });

    /* pointer: drag to orbit; tap to select nearest card */
    var drag = null;
    canvas.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      tYaw += dx * 0.0042;
      tPitch = Math.max(-0.1, Math.min(0.46, tPitch + dy * 0.0028));
      drag.x = e.clientX; drag.y = e.clientY;
      lastInput = performance.now();
    });
    canvas.addEventListener("pointerup", function (e) {
      var wasTap = drag && drag.moved < 6;
      drag = null;
      if (!wasTap) return;
      var rect = canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var best = -1, bd = 1e9, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2 - 6;
      for (var c = 0; c < COLS; c++) for (var r = 0; r < ROWS; r++) {
        var p = cardCenter(c, r, performance.now() / 1000);
        var s = proj(p.x, p.y, p.z, cx, cy);
        var d = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py);
        if (d < bd) { bd = d; best = c * ROWS + r; }
      }
      if (best >= 0 && bd < 160 * 160) setSel(Math.floor(best / ROWS), best % ROWS);
    });

    /* in-view gating */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            resize();
            if (!booted) typeBoot();
            if (!running) { running = true; raf = requestAnimationFrame(frame); }
          } else {
            running = false;
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
          }
        });
      }, { threshold: 0.25 }).observe(sec);
    } else {
      resize(); booted = true; running = true; raf = requestAnimationFrame(frame);
    }
  })();

  /* ══ 24fps sequence-frame player contract (for Astra delivery) ══
     Mount: <div data-dam-anim="hero"
                data-dir="assets/anim/hero" data-prefix="hero_"
                data-count="36" data-fps="24" data-mode="once"></div>
     Frames: <dir>/<prefix>0000.png … (4-digit, from 0000, PNG-24 + alpha).
     Pre-decodes first 12 frames, then streams; IntersectionObserver-gated;
     reduced-motion → static first frame. No mount on this page yet:
     the hero character ships as inline SVG line-art until delivery. */
  (function () {
    var mounts = document.querySelectorAll("[data-dam-anim]");
    if (!mounts.length) return;
    var reduce = reduced();
    Array.prototype.forEach.call(mounts, function (m) {
      var dir = m.getAttribute("data-dir"), pre = m.getAttribute("data-prefix") || "",
          n = parseInt(m.getAttribute("data-count") || "0", 10),
          fps = parseInt(m.getAttribute("data-fps") || "24", 10),
          mode = m.getAttribute("data-mode") || "once";
      if (!dir || !n) return;
      var img = document.createElement("img");
      img.alt = m.getAttribute("aria-label") || "";
      m.appendChild(img);
      var frames = [];
      for (var i = 0; i < n; i++) {
        var im = new Image();
        im.src = dir + "/" + pre + String(i).padStart(4, "0") + ".png";
        frames.push(im);
      }
      if (reduce) { frames[0].onload = function () { img.src = frames[0].src; }; return; }
      var i2 = 0, playing = false, last = 0;
      function tick(now) {
        if (!playing) return;
        requestAnimationFrame(tick);
        if (now - last < 1000 / fps) return;
        last = now;
        img.src = frames[i2].src;
        i2++;
        if (i2 >= 12) i2 = mode === "loop" ? 0 : 11;
      }
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !playing) { playing = true; requestAnimationFrame(tick); }
          else if (!en.isIntersecting) playing = false;
        });
      }).observe(m);
    });
  })();
})();
