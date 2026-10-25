export const CSS = String.raw`/* ============================================================================
   wb-event-preview v4 — 视觉系统
   ----------------------------------------------------------------------------
   设计依据（会话内已加载的 skill）：
   · apple-design  —— 弹簧(阻尼/响应)、可中断、1:1 跟手、材质重量、reduced-motion、
                     Dynamic Type(rem)、tracking 随字号变化、层级=权重+字号+行高
   · transitions-motion —— 复用项目既有 token（--dur-quick/fast/medium/slow +
                     --ease-smooth-out），不新造时长数字；参考 panel-reveal /
                     tabs-sliding / accordion / skeleton-reveal 四个成品
   · emil-design-eng —— :active 反馈、hover 能力查询、进入/退出不对称、错开 40ms
   · mobile-native  —— tap highlight / 100dvh / 16px 输入框 / 安全区 / overscroll
   ========================================================================== */

/* ---------- 1. 设计 token ---------- */
:root{
  /* 表面与墨色（浅色）。正文对比度实测见 VERIFY.md「对比度」表 */
  --bg:#f4f6f9; --bg2:#eceff4; --card:#ffffff; --card2:#fbfcfe; --card3:#f7f9fc;
  --ink:#12161d; --ink2:#3f4855; --ink3:#59636f; --muted:#6b7482;
  --line:#e2e7ee; --line2:#edf0f5; --line3:#f5f7fa;
  --accent:#2563eb; --accent-ink:#1d4ed8; --accent-soft:#eef4ff; --accent-line:#d3e0fb;
  --done:#0b6b47; --done-soft:#e8f5ef; --done-line:#cbe8db;
  --active:#96480a; --active-soft:#fdf2e4; --active-line:#f2ddbe;
  --unknown:#55606e; --unknown-soft:#f0f3f7; --unknown-line:#e3e7ed;
  --paused:#4f3cb3; --paused-soft:#f1eefc; --paused-line:#ddd5f7;
  --demo:#a2560c; --demo-soft:#fff8ec; --demo-line:#f0d6a8;
  /* 层叠阴影：接触 + 环境 */
  --sh1:0 1px 1px rgba(16,24,40,.04), 0 1px 2px rgba(16,24,40,.05);
  --sh2:0 1px 2px rgba(16,24,40,.05), 0 4px 10px -2px rgba(16,24,40,.08);
  --sh3:0 2px 4px rgba(16,24,40,.05), 0 12px 28px -6px rgba(16,24,40,.14);
  /* 暗色用「描边 + 提亮表面」替代阴影；浅色下这条边不可见 */
  --edge:transparent; --edge2:transparent;
  --scrim:rgba(12,16,24,.42);
  /* 动效 token（沿用 v2，禁止新造时长数字） */
  --dur-quick:150ms; --dur-fast:250ms; --dur-medium:350ms; --dur-slow:400ms;
  --dur-stagger:40ms;
  --ease-smooth-out:cubic-bezier(0.22,1,0.36,1);
  --ease-in-out:cubic-bezier(0.77,0,0.175,1);
  --ease-bounce:cubic-bezier(0.34,1.36,0.64,1);
  --dist-base:8px; --blur-small:2px;
  --scale-large:.96;
  /* 字号刻度（全部 rem，跟用户/系统字号走；最小档用 max() 兜住 11px 可读下限） */
  --fs-body:.9375rem;          /* 15px */
  --fs-sm:.875rem;             /* 14px */
  --fs-xs:.8125rem;            /* 13px */
  --fs-2xs:max(11px,.6875rem); /* ≥11px */
  --fs-title:1.0625rem;        /* 17px */
  --fs-h:1.1875rem;            /* 19px */
  --lh-tight:1.32; --lh-body:1.62;
  --tr-title:-.015em; --tr-body:0em; --tr-small:.015em;
  /* 布局 */
  --rail-w:336px; --mid-w:392px; --topbar-h:auto;
  --r1:7px; --r2:10px; --r3:14px;
  --pad:16px;
}
/* 字号三档：只改 html 根字号，全站 rem 联动（apple-design Dynamic Type） */
html{font-size:16px}
html[data-fs="0"]{font-size:15px}
html[data-fs="2"]{font-size:17.5px}

/* ---------- 2. 暗色（分层中性灰，非反色） ---------- */
html[data-theme="dark"]{
  --bg:#0a0d14; --bg2:#0c111a; --card:#151b26; --card2:#1a212e; --card3:#111722;
  --ink:#e6eaf1; --ink2:#b6c0cf; --ink3:#929dae; --muted:#8794a6;
  --line:#232b39; --line2:#1b2230; --line3:#161d29;
  --accent:#8aaeff; --accent-ink:#a9c2ff; --accent-soft:rgba(138,174,255,.13); --accent-line:rgba(138,174,255,.28);
  --done:#5ee0a0; --done-soft:rgba(94,224,160,.13); --done-line:rgba(94,224,160,.26);
  --active:#f7c05a; --active-soft:rgba(247,192,90,.13); --active-line:rgba(247,192,90,.26);
  --unknown:#a3b0c2; --unknown-soft:rgba(163,176,194,.10); --unknown-line:rgba(163,176,194,.22);
  --paused:#b6a2ff; --paused-soft:rgba(182,162,255,.13); --paused-line:rgba(182,162,255,.26);
  --demo:#f0b45a; --demo-soft:rgba(240,180,90,.12); --demo-line:rgba(240,180,90,.28);
  --sh1:none; --sh2:none; --sh3:none;
  --edge:rgba(255,255,255,.07); --edge2:rgba(255,255,255,.045);
  --scrim:rgba(2,4,8,.62);
}
html[data-theme="dark"]{color-scheme:dark}
html[data-theme="light"]{color-scheme:light}

/* ---------- 3. 基础 ---------- */
*{box-sizing:border-box}
html,body{height:100%}
html{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
body{
  margin:0;height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  background:var(--bg);color:var(--ink);
  font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Segoe UI",system-ui,-apple-system,sans-serif;
  font-size:var(--fs-body);line-height:var(--lh-body);letter-spacing:var(--tr-body);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  font-variant-numeric:tabular-nums;
  transition:background-color var(--dur-fast) var(--ease-smooth-out),color var(--dur-fast) var(--ease-smooth-out);
}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-feature-settings:"liga" 0}
button{font:inherit;color:inherit}
input{font:inherit}
::selection{background:var(--accent-soft);color:var(--accent-ink)}

/* ---------- 4. 顶栏 ---------- */
.topbar{
  flex:none;display:flex;align-items:center;gap:14px;padding:0 18px;min-height:54px;
  padding-top:env(safe-area-inset-top,0px);
  background:color-mix(in srgb,var(--card) 82%,transparent);
  border-bottom:1px solid var(--line);
  backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);
  position:sticky;top:0;z-index:40;
}
.brand{display:flex;align-items:baseline;gap:9px;min-width:0;flex:none}
.brand b{font-size:var(--fs-title);font-weight:680;letter-spacing:var(--tr-title);white-space:nowrap}
.brand span{color:var(--muted);font-size:var(--fs-2xs);letter-spacing:var(--tr-small);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:32ch}
.controls{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.chips{display:flex;gap:5px;flex-wrap:nowrap;overflow:hidden}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-size:var(--fs-2xs);color:var(--ink3);white-space:nowrap;box-shadow:var(--sh1)}
.chip b{color:var(--ink);font-weight:660;margin-left:3px}

/* 分段控件（视图切换）：滑动药丸 = transitions-motion「tabs-sliding」 */
.vswitch{position:relative;display:inline-flex;align-items:center;gap:2px;background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:2px;flex:none}
.vswitch .pill{position:absolute;top:2px;left:0;height:calc(100% - 4px);width:0;border-radius:7px;background:var(--card);
  box-shadow:0 1px 2px rgba(16,24,40,.12),inset 0 1px 0 var(--edge);
  transition:transform var(--dur-fast) var(--ease-smooth-out),width var(--dur-fast) var(--ease-smooth-out);
  pointer-events:none;z-index:0}
.vswitch button{position:relative;z-index:1;appearance:none;border:0;background:none;font-size:var(--fs-2xs);color:var(--ink3);
  padding:4px 10px;border-radius:7px;cursor:pointer;white-space:nowrap;touch-action:manipulation;user-select:none;
  transition:color var(--dur-quick) var(--ease-smooth-out)}
.vswitch button:hover{color:var(--ink)}
.vswitch button.on{color:var(--accent-ink);font-weight:640}
.vswitch button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* 字号三档 */
.fsctl{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:9px;background:var(--card);overflow:hidden;flex:none;box-shadow:var(--sh1)}
.fsctl button{appearance:none;border:0;background:none;cursor:pointer;color:var(--ink3);padding:5px 8px;line-height:1;touch-action:manipulation;
  transition:background-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out)}
.fsctl button+button{border-left:1px solid var(--line2)}
.fsctl button:hover{color:var(--ink);background:var(--card3)}
.fsctl button.on{color:var(--accent-ink);background:var(--accent-soft);font-weight:660}
.fsctl button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.fsctl .a0{font-size:var(--fs-2xs);font-weight:600}
.fsctl .a1{font-size:var(--fs-xs);font-weight:600}
.fsctl .a2{font-size:var(--fs-body);font-weight:600}

/* 主题三态 */
.themebtn{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:999px;
  padding:4px 10px;font-size:var(--fs-2xs);color:var(--ink3);cursor:pointer;white-space:nowrap;touch-action:manipulation;flex:none;box-shadow:var(--sh1);
  transition:border-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out),background-color var(--dur-quick) var(--ease-smooth-out)}
.themebtn:hover{border-color:var(--accent-line);color:var(--ink)}
.themebtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.themebtn .tico{font-size:var(--fs-xs);line-height:1;display:inline-block;transition:transform var(--dur-fast) var(--ease-bounce)}
.themebtn:active .tico{transform:rotate(-18deg) scale(.94)}

.dtoggle{appearance:none;border:1px solid var(--line);background:var(--card);border-radius:999px;font-size:var(--fs-2xs);color:var(--ink2);
  padding:4px 11px;cursor:pointer;white-space:nowrap;box-shadow:var(--sh1);touch-action:manipulation;
  transition:border-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out)}
.dtoggle:hover{border-color:var(--accent-line);color:var(--ink)}
.dtoggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* 合成演示开关 */
.demo-switch{display:inline-flex;align-items:center;gap:7px;font-size:var(--fs-2xs);color:var(--ink3);cursor:pointer;white-space:nowrap;
  padding:3px 9px 3px 6px;border:1px solid var(--line);border-radius:999px;background:var(--card);flex:none;
  transition:color var(--dur-quick) var(--ease-smooth-out),border-color var(--dur-quick) var(--ease-smooth-out),background-color var(--dur-quick) var(--ease-smooth-out)}
.demo-switch input{appearance:none;width:26px;height:15px;border-radius:999px;background:var(--line);position:relative;cursor:pointer;margin:0;flex:none;
  transition:background-color var(--dur-fast) var(--ease-smooth-out)}
.demo-switch input:before{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.24);
  transition:transform var(--dur-fast) var(--ease-smooth-out)}
.demo-switch input:checked{background:var(--demo)}
.demo-switch input:checked:before{transform:translateX(11px)}
.demo-switch input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.demo-switch.on{color:var(--demo);border-color:var(--demo-line);background:var(--demo-soft)}

/* 窄屏专用按钮（默认隐藏） */
.navbtn{display:none;appearance:none;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:5px 10px;font-size:var(--fs-2xs);
  color:var(--ink2);cursor:pointer;touch-action:manipulation}
.navbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* ---------- 5. 三栏骨架 ---------- */
.layout{
  flex:1;min-height:0;min-width:0;display:grid;
  grid-template-columns:var(--rail-w) var(--mid-w) minmax(0,1fr);
}
.col{overflow:auto;min-width:0;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.col::-webkit-scrollbar{width:9px;height:9px}
.col::-webkit-scrollbar-thumb{background:var(--line);border-radius:9px;border:2px solid transparent;background-clip:content-box}
.col::-webkit-scrollbar-thumb:hover{background:var(--muted);background-clip:content-box}
.col::-webkit-scrollbar-track{background:transparent}

/* ---------- 6. 左轨：时间轴（v4 重做） ---------- */
.rail{
  border-right:1px solid var(--line);position:relative;
  background:linear-gradient(180deg,var(--card2) 0%,var(--bg2) 100%);
  scroll-behavior:auto;
}
.rail-top{
  position:sticky;top:0;z-index:9;min-height:56px;display:flex;align-items:center;gap:8px;padding:6px 12px;flex-wrap:wrap;
  background:var(--card2);
  border-bottom:1px solid var(--line2);
}
.rail-h{margin:0;font-size:var(--fs-2xs);color:var(--muted);letter-spacing:.10em;text-transform:uppercase;font-weight:680;white-space:nowrap}
.rail-hint{margin-left:auto;font-size:var(--fs-2xs);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.scalectl{display:inline-flex;border:1px solid var(--line);border-radius:7px;background:var(--card);overflow:hidden;flex:none}
.scalectl button{appearance:none;border:0;background:none;font-size:var(--fs-2xs);color:var(--ink3);padding:2px 6px;cursor:pointer;white-space:nowrap;touch-action:manipulation;
  transition:background-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out)}
.scalectl button+button{border-left:1px solid var(--line2)}
.scalectl button.on{background:var(--accent-soft);color:var(--accent-ink);font-weight:640}
.scalectl button:hover{color:var(--ink)}
.scalectl button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}

.rail-body{padding:6px 10px 88px 14px;position:relative}
.axis{position:relative;padding-left:15px}
/* 主轴：从「最早」那条开始，到「今天」锚点结束 */
.axis:before{content:"";position:absolute;left:4px;top:6px;bottom:0;width:2px;border-radius:2px;
  background:linear-gradient(180deg,var(--line) 0%,var(--line) calc(100% - 70px),var(--accent-line) 100%)}

/* 月份 sticky 分隔：整月概览 + 日密度迷你柱状 */
.msep{
  position:sticky;top:56px;z-index:8;margin:10px 0 6px;padding:7px 8px 8px;border-radius:var(--r1);
  background:var(--card2);
  border:1px solid var(--line2);box-shadow:var(--sh1);
  display:flex;align-items:center;gap:8px;flex-wrap:nowrap;
}
.msep .mlabel{font-size:var(--fs-2xs);font-weight:700;color:var(--ink2);letter-spacing:.02em;white-space:nowrap}
.msep .mcount{font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap}
/* 日密度柱：31 根细柱，高度 ∝ 当天事件数 */
.mdens{display:flex;align-items:flex-end;gap:1px;height:14px;margin-left:auto;flex:none}
.mdens i{display:block;flex:none;width:3px;border-radius:1px;background:var(--accent);opacity:.34;min-height:1px}
.mdens i.hi{opacity:.85}
.mdens i.empty{background:var(--line);opacity:1}

/* 天分隔 */
.dsep{position:relative;display:flex;align-items:center;gap:6px;margin:9px 0 3px;padding:0 4px;font-size:var(--fs-2xs);color:var(--muted)}
.dsep .dl{font-weight:680;color:var(--ink3);letter-spacing:.02em;font-variant-numeric:tabular-nums}
.dsep .dw{color:var(--muted)}
.dsep .dc{color:var(--muted);font-variant-numeric:tabular-nums}
.dsep .dbar{display:block;height:3px;border-radius:2px;background:var(--accent);opacity:.30;max-width:96px;flex:none}
.dsep .dline{flex:1;height:1px;background:var(--line2)}

/* 事件刻度 */
.tick{
  position:relative;display:flex;align-items:flex-start;gap:7px;width:100%;text-align:left;
  border:0;background:none;color:inherit;cursor:pointer;border-radius:var(--r1);
  padding:5px 6px 5px 2px;margin:0 0 1px;
  transition:background-color var(--dur-quick) var(--ease-smooth-out);
}
.tick .tdot{position:absolute;left:-15px;top:11px;width:9px;height:9px;border-radius:50%;background:var(--card);border:1.5px solid var(--line);
  transition:border-color var(--dur-quick) var(--ease-smooth-out),box-shadow var(--dur-quick) var(--ease-smooth-out),transform var(--dur-quick) var(--ease-smooth-out)}
.tick.s-done .tdot{border-color:var(--done)}
.tick.s-active .tdot{border-color:var(--active);background:var(--active)}
.tick.s-paused .tdot{border-color:var(--paused)}
.tick.s-unknown .tdot{border-color:var(--line)}
.tick .ttime{flex:none;font-size:var(--fs-2xs);color:var(--muted);font-variant-numeric:tabular-nums;padding-top:1px;width:3.1em}
.tick .tlabel{min-width:0;flex:1;display:block}
.tick .tlabel b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  font-size:var(--fs-xs);font-weight:520;line-height:1.4;color:var(--ink2);letter-spacing:var(--tr-small);
  transition:color var(--dur-quick) var(--ease-smooth-out)}
.tick .tlabel i{display:block;font-style:normal;font-size:var(--fs-2xs);color:var(--muted);margin-top:1px;line-height:1.3}
.tick .tgap{flex:none;font-size:var(--fs-2xs);color:var(--active);opacity:0;transition:opacity var(--dur-quick) var(--ease-smooth-out)}
.tick:hover{background:var(--card)}
.tick:hover .tlabel b{color:var(--ink)}
.tick:hover .tdot{border-color:var(--accent);transform:scale(1.15)}
.tick.on{background:var(--accent-soft)}
.tick.on .tlabel b{color:var(--accent-ink);font-weight:640}
.tick.on .tdot{background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.tick.in-view{background:color-mix(in srgb,var(--accent) 6%,transparent)}
.tick:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.tick.demo-rail .tdot{border-color:var(--demo);background:var(--demo)}

/* 空档断开：>2h 在轨道上真断开（不只右栏提示） */
.rbreak{position:relative;display:flex;align-items:center;gap:6px;margin:2px 0 2px 0;padding:0 2px;height:15px}
.rbreak:before{content:"";position:absolute;left:-11px;top:0;bottom:0;width:0;border-left:1px dashed var(--active-line)}
.rbreak span{font-size:var(--fs-2xs);color:var(--active);background:var(--active-soft);border:1px dashed var(--active-line);
  border-radius:5px;padding:0 5px;white-space:nowrap;line-height:1.5;letter-spacing:.01em}
.rbreak .rline{flex:1;border-top:1px dashed var(--line)}

/* 今天锚点：贴在轨道底部 */
.rail-today{
  position:sticky;bottom:0;z-index:8;margin-top:10px;padding:7px 10px 9px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--bg2) 0%,transparent),color-mix(in srgb,var(--bg2) 92%,transparent) 30%);
  display:flex;align-items:center;gap:7px;font-size:var(--fs-2xs);color:var(--ink3);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
}
.rail-today .tdot2{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent);flex:none;margin-left:-4px}
.rail-today b{color:var(--ink2);font-weight:660}
.rail-today .tl{flex:1;height:1px;background:linear-gradient(90deg,var(--accent-line),transparent)}

/* ---------- 7. 中栏 ---------- */
.mid{border-right:1px solid var(--line);background:var(--bg);overflow-anchor:none}
/* sticky 头必须是不透明底：半透明渐变会让卡片文字从头部下方透出来（真实浏览器实测） */
.mid-top{
  position:sticky;top:0;z-index:12;padding:12px 16px 9px;
  background:var(--bg);
  border-bottom:1px solid var(--line);
  box-shadow:0 8px 14px -12px rgba(16,24,40,.20);
}
/* 不再用半透明渐隐：它会露出下面 10px 的卡片内容；改用一条实线收边 */
/* 表头压到两行：标题行带懒加载状态，工具行带搜索与图例（154px → ~96px） */
.mid-h{display:flex;align-items:center;gap:8px;margin:0 0 6px}
.mid-h h2{font-size:var(--fs-title);margin:0;font-weight:680;letter-spacing:var(--tr-title);flex:none}
.mid-h em{font-style:normal;font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.mid-h em b{color:var(--ink2);font-weight:640}
.mid-h .lm-slot{margin-left:auto;flex:none;display:flex;align-items:center;gap:6px}
.toolbar{display:flex;gap:8px;align-items:center;margin:0}
.toolbar input{flex:1;min-width:0;height:32px;border:1px solid var(--line);border-radius:var(--r1);padding:0 10px;
  font:inherit;font-size:var(--fs-xs);background:var(--card);color:var(--ink);outline:none;box-shadow:var(--sh1);
  transition:border-color var(--dur-quick) var(--ease-smooth-out),box-shadow var(--dur-quick) var(--ease-smooth-out)}
.toolbar input::placeholder{color:var(--muted)}
.toolbar input:focus{border-color:var(--accent-line);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
.toolbar .cnt{font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;min-width:56px;text-align:right;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:8px;flex-wrap:wrap;margin:0;font-size:var(--fs-2xs);color:var(--muted);line-height:1.5}
.legend .lg{display:inline-flex;align-items:center;gap:4px}
.legend .lg.rule{color:var(--muted);opacity:.85}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block}

/* 懒加载控制条 */
.lm-slot{display:block}
.lm-slot:empty{display:none}
.loadmore{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;margin:0;padding:0;border:0;background:none;min-height:0;overflow:visible}
.loadmore .lm-btn{white-space:nowrap}
.loadmore .lm-grow{flex:1;min-width:0}
.lm-btn{appearance:none;border:1px solid var(--line);background:var(--card);border-radius:var(--r1);padding:4px 11px;font-size:var(--fs-2xs);
  color:var(--ink2);cursor:pointer;display:inline-flex;align-items:center;gap:5px;touch-action:manipulation;
  transition:border-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out),background-color var(--dur-quick) var(--ease-smooth-out)}
.lm-btn:hover{border-color:var(--accent-line);color:var(--accent-ink);background:var(--accent-soft)}
.lm-btn:active{transform:scale(.98)}
.lm-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lm-btn[disabled]{opacity:.55;cursor:default;transform:none}
.lm-cnt{font-size:var(--fs-2xs);color:var(--muted);font-variant-numeric:tabular-nums}
.lm-cnt b{color:var(--ink2);font-weight:660}
.lm-done{font-size:var(--fs-2xs);color:var(--done);display:inline-flex;align-items:center;gap:5px}
.lm-spin{width:11px;height:11px;border-radius:50%;border:1.5px solid var(--line);border-top-color:var(--accent);animation:lm-spin 800ms var(--ease-linear,linear) infinite;flex:none}
@keyframes lm-spin{to{transform:rotate(360deg)}}

/* 卡片 */
.card{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
  box-shadow:var(--sh1),inset 0 1px 0 var(--edge);
  scroll-margin-top:130px;scroll-margin-bottom:24px;margin-bottom:8px;cursor:pointer;
  transition:border-color var(--dur-quick) var(--ease-smooth-out),box-shadow var(--dur-fast) var(--ease-smooth-out),transform var(--dur-fast) var(--ease-smooth-out)}
@media (hover:hover) and (pointer:fine){
  .card:hover{border-color:var(--accent-line);box-shadow:var(--sh2),inset 0 1px 0 var(--edge)}
}
.card:active{transform:scale(.998)}
.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card.on{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent),var(--sh2),inset 0 1px 0 var(--edge)}
.card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent}
.card.s-done:before{background:var(--done)}
.card.s-active:before{background:var(--active)}
.card.s-paused:before{background:var(--paused)}
.card.s-unknown:before{background:var(--line)}
.card.narrow{padding:9px 12px;background:var(--card2)}
.card.medium{padding:11px 13px}
.card.wide{padding:13px 15px}
.card .row1{display:flex;align-items:flex-start;gap:10px}
.card .ttl{font-size:var(--fs-sm);font-weight:620;color:var(--ink);flex:1;min-width:0;line-height:var(--lh-tight);letter-spacing:var(--tr-title)}
.card.narrow .ttl{font-weight:540;font-size:var(--fs-xs);color:var(--ink2)}
.card.narrow:hover .ttl{color:var(--ink)}
.card .dt{font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;margin-top:2px;letter-spacing:var(--tr-small);font-variant-numeric:tabular-nums}
.card .meta{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:7px}
.badge{border-radius:5px;padding:1px 6px;font-size:var(--fs-2xs);font-weight:560;letter-spacing:var(--tr-small);border:1px solid transparent;white-space:nowrap;line-height:1.6}
.b-done{background:var(--done-soft);color:var(--done);border-color:var(--done-line)}
.b-active{background:var(--active-soft);color:var(--active);border-color:var(--active-line)}
.b-unknown{background:var(--unknown-soft);color:var(--unknown);border-color:var(--unknown-line)}
.b-paused{background:var(--paused-soft);color:var(--paused);border-color:var(--paused-line)}
.b-high{background:var(--accent-soft);color:var(--accent-ink);border-color:var(--accent-line)}
.b-medium{background:var(--active-soft);color:var(--active);border-color:var(--active-line)}
.b-low{background:var(--paused-soft);color:var(--paused);border-color:var(--paused-line)}
.b-kind{background:var(--card3);color:var(--ink3);border-color:var(--line)}
.card .summary{margin-top:7px;color:var(--ink2);font-size:var(--fs-xs);line-height:var(--lh-body);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .sec{margin-top:8px}
.card .sec h4{margin:0 0 3px;font-size:var(--fs-2xs);color:var(--muted);font-weight:680;letter-spacing:.08em;text-transform:uppercase}
.card ul.li{margin:0;padding-left:0;list-style:none;color:var(--ink2);font-size:var(--fs-xs)}
.card ul.li li{position:relative;padding-left:10px;margin:1px 0;line-height:1.55;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card ul.li li:before{content:"";position:absolute;left:0;top:8px;width:3px;height:3px;border-radius:50%;background:var(--muted);opacity:.6}
.card .why{margin-top:8px;font-size:var(--fs-2xs);color:var(--muted);line-height:1.6;border-left:2px solid var(--line);padding-left:8px}
.card .expand{margin-top:8px;font-size:var(--fs-2xs);color:var(--accent);font-weight:560}
.card.narrow{max-width:82%}
.card.medium{max-width:94%}
.card.wide{max-width:100%}
/* 卡片入场：不位移，避免顶部溢出 sticky 头（透明+极小缩放同样有"出现感"） */
@keyframes card-in{from{opacity:0;transform:scale(.995)}to{opacity:1;transform:scale(1)}}
.card.fresh{animation:card-in var(--dur-fast) var(--ease-smooth-out) both}

/* ---------- 8. 右栏详情 ---------- */
/* 抽屉收起态：宽→0 且 padding/border 一起归零，否则 grid 轨道会留下 40px 空壳 */
.layout{grid-template-columns:var(--rail-w) var(--mid-w) minmax(0,1fr)}
.layout.detail-off .detail{padding:0!important;border:0!important;overflow:hidden;opacity:0;pointer-events:none}
.detail{transition:opacity var(--dur-quick) var(--ease-smooth-out)}
.detail{padding:16px 20px calc(96px + env(safe-area-inset-bottom,0px));background:var(--card2);min-width:0;position:relative}
.sheet-close{display:none}
.detail .empty{color:var(--muted);font-size:var(--fs-xs);border:1px dashed var(--line);border-radius:var(--r2);padding:28px;text-align:center;margin-top:44px;background:var(--card)}
.dh{margin-bottom:14px}
.dh h2{font-size:var(--fs-h);margin:0 0 7px;letter-spacing:var(--tr-title);font-weight:680;line-height:1.3}
.dh .sub{display:flex;gap:7px;flex-wrap:wrap;align-items:center;color:var(--muted);font-size:var(--fs-2xs)}
.dh .sum{margin-top:10px;background:var(--card);border:1px solid var(--line);border-radius:var(--r2);padding:11px 13px;
  color:var(--ink2);box-shadow:var(--sh1),inset 0 1px 0 var(--edge);font-size:var(--fs-xs);line-height:var(--lh-body)}
.percept{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px}
.percept .pc{background:var(--card);border:1px dashed var(--line);border-radius:var(--r1);padding:7px 9px;min-height:44px}
.percept .pc b{display:block;font-size:var(--fs-2xs);color:var(--ink3);font-weight:660;letter-spacing:.05em;margin-bottom:3px;text-transform:uppercase}
.percept .pc span{font-size:var(--fs-2xs);color:var(--muted)}
.dtl{margin-top:16px;position:relative;padding-left:20px}
.dtl:before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:2px;border-radius:2px;
  background:linear-gradient(180deg,var(--line),var(--line) 70%,transparent)}
.cp{position:relative;margin-bottom:14px}
.cp:before{content:"";position:absolute;left:-16.5px;top:7px;width:9px;height:9px;border-radius:50%;background:var(--card);border:1.5px solid var(--muted);box-sizing:border-box}
.cp.newest:before{border-color:var(--accent);background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.cp-h{appearance:none;background:none;border:0;padding:0;margin:0 0 7px;width:100%;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
  font:inherit;text-align:left;color:inherit;cursor:pointer;border-radius:4px;touch-action:manipulation}
.cp.closed .cp-h{margin-bottom:0}
.cp-h:hover .at{color:var(--ink)}
.cp-h:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.cp-h .idx{font-size:var(--fs-2xs);color:var(--ink3);border:1px solid var(--line);border-radius:4px;padding:0 4px;background:var(--card);font-weight:600;font-variant-numeric:tabular-nums}
.cp-h .at{font-size:var(--fs-2xs);color:var(--ink2);font-weight:560;letter-spacing:var(--tr-small);font-variant-numeric:tabular-nums}
.cp-h .src{font-size:var(--fs-2xs);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%}
.cp-h .caret{font-size:var(--fs-2xs);color:var(--muted);line-height:1;transform:rotate(0deg);transition:transform var(--dur-quick) var(--ease-smooth-out)}
.cp.closed .cp-h .caret{transform:rotate(-90deg)}
.cp-counts{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
.cp-counts span{font-size:var(--fs-2xs);color:var(--ink3);background:var(--card3);border:1px solid var(--line2);border-radius:4px;padding:0 5px;white-space:nowrap}
.cp-counts span b{color:var(--ink2);font-weight:660;margin-left:2px}
.cp-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows var(--dur-fast) var(--ease-smooth-out)}
.cp.closed .cp-body{grid-template-rows:0fr}
.cp-body>.cp-inner{overflow:hidden;min-height:0}
.cp-body>.cp-inner>.panels{padding-top:1px}
.panels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;align-items:stretch}
.panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r1);box-shadow:var(--sh1),inset 0 1px 0 var(--edge);
  padding:6px 8px;min-height:58px;min-width:0;display:flex;flex-direction:column;
  transition:border-color var(--dur-quick) var(--ease-smooth-out)}
.panel:hover{border-color:var(--accent-line)}
.panel .ph{font-size:var(--fs-2xs);color:var(--ink3);font-weight:660;letter-spacing:.05em;display:flex;justify-content:space-between;gap:6px;margin-bottom:4px;text-transform:uppercase}
.panel .ph i{font-style:normal;color:var(--muted);font-weight:520;font-size:var(--fs-2xs);letter-spacing:0}
.panel .pb{font-size:var(--fs-xs);color:var(--ink2);line-height:1.55;word-break:break-word;min-width:0;flex:1}
.panel .pb div{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
.panel.k-log{background:var(--card3)}
.panel.k-log .pb{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs-2xs);color:var(--ink2);line-height:1.55}
.panel.k-log .pb div{white-space:normal;-webkit-line-clamp:7}
.panel.k-dead{background:color-mix(in srgb,var(--active) 5%,var(--card));border-color:var(--active-line)}
.panel.k-next{background:color-mix(in srgb,var(--done) 5%,var(--card));border-color:var(--done-line)}
.panel.k-userPercept,.panel.k-commitment{background:color-mix(in srgb,var(--active) 4%,var(--card2))}
.panel .empty-v{color:var(--muted);font-size:var(--fs-2xs)}
.panel .more{color:var(--muted);font-size:var(--fs-2xs);margin-top:2px}
.dtools{display:flex;gap:6px;align-items:center;margin:8px 0 4px;flex-wrap:wrap}
.dbtn{appearance:none;border:1px solid var(--line);background:var(--card);border-radius:6px;font-size:var(--fs-2xs);color:var(--ink3);padding:2px 8px;cursor:pointer;touch-action:manipulation;
  transition:border-color var(--dur-quick) var(--ease-smooth-out),color var(--dur-quick) var(--ease-smooth-out)}
.dbtn:hover{border-color:var(--accent-line);color:var(--accent-ink)}
.dstats{margin-left:auto;font-size:var(--fs-2xs);color:var(--muted)}
.dstats b{color:var(--ink2);font-weight:660}
.gap{display:flex;align-items:center;gap:8px;margin:2px 0 12px;font-size:var(--fs-2xs);line-height:1.4;position:relative}
.gap .gtext{border:1px dashed var(--active-line);background:var(--active-soft);border-radius:6px;padding:2px 8px;color:var(--active);white-space:nowrap}
.gap .gtext b{font-weight:660}
.gap .gline{flex:1;border-top:1px dashed var(--line)}
.gap.demo .gtext{border-color:var(--demo-line);background:var(--demo-soft);color:var(--demo)}
.srcs{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:var(--r2);box-shadow:var(--sh1),inset 0 1px 0 var(--edge);padding:10px 12px}
.srcs h4{margin:0 0 6px;font-size:var(--fs-2xs);color:var(--ink3);font-weight:660;letter-spacing:.08em;text-transform:uppercase}
.srcs .row{display:flex;gap:8px;align-items:baseline;font-size:var(--fs-2xs);color:var(--ink2);padding:2px 0;border-top:1px solid var(--line3)}
.srcs .row:first-of-type{border-top:0}
.srcs .row .n{color:var(--muted);min-width:26px}
.srcs .row .p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srcs .row .t{color:var(--muted);white-space:nowrap}
.srcs .more{color:var(--muted);font-size:var(--fs-2xs);margin-top:4px}
.foot{margin-top:22px;color:var(--muted);font-size:var(--fs-2xs);line-height:1.75;border-top:1px solid var(--line2);padding-top:11px}
.foot div+div{margin-top:2px}

/* 详情进入：panel-reveal（位移+透明度+交叉模糊，400ms 开） */
.detail-reveal{animation:detail-in var(--dur-slow) var(--ease-smooth-out) both}
@keyframes detail-in{from{opacity:0;transform:translateY(var(--dist-base));filter:blur(var(--blur-small))}to{opacity:1;transform:translateY(0);filter:blur(0)}}
.cp{animation:cp-in var(--dur-fast) var(--ease-smooth-out) both}
.cp:nth-child(1){animation-delay:0ms}
.cp:nth-child(2){animation-delay:calc(var(--dur-stagger)*1)}
.cp:nth-child(3){animation-delay:calc(var(--dur-stagger)*2)}
.cp:nth-child(4){animation-delay:calc(var(--dur-stagger)*3)}
.cp:nth-child(5){animation-delay:calc(var(--dur-stagger)*4)}
.cp:nth-child(6){animation-delay:calc(var(--dur-stagger)*5)}
@keyframes cp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

/* ---------- 9. 泳道 / 甘特 ---------- */
.lanes{padding:0 0 64px}
.lanes-bar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:2px 0 9px;font-size:var(--fs-2xs);color:var(--muted);line-height:1.5}
.lanes-bar b{color:var(--ink2);font-weight:660;font-size:var(--fs-xs)}
.lanes-bar .sl{color:var(--muted)}
.lgrid{position:relative;max-width:none}
.axis-row{display:grid;grid-template-columns:13rem minmax(0,1fr);gap:10px;padding:4px 0 6px;position:sticky;top:0;z-index:6;
  background:linear-gradient(180deg,var(--bg) 78%,color-mix(in srgb,var(--bg) 0%,transparent))}
.axis-ticks{position:relative;height:16px}
.axis-tick{position:absolute;top:0;font-size:var(--fs-2xs);color:var(--muted);transform:translateX(-50%);white-space:nowrap;letter-spacing:var(--tr-small)}
/* 首尾刻度贴边对齐，避免被中栏裁掉（真实浏览器实测 10/… 曾溢出） */
.axis-tick:first-child{transform:none}
.axis-tick:last-of-type{transform:translateX(-100%)}
.axis-rule{position:absolute;left:0;right:0;top:15px;border-top:1px solid var(--line)}
.lrow{display:grid;grid-template-columns:13rem minmax(0,1fr);gap:10px;align-items:center;height:28px;border-radius:6px;cursor:pointer;touch-action:manipulation;
  transition:background-color var(--dur-quick) var(--ease-smooth-out)}
.lrow:hover{background:var(--card3)}
.lrow.on{background:var(--accent-soft)}
.lrow:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.lname{font-size:var(--fs-2xs);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:2px}
.lname i{font-style:normal;color:var(--muted);font-size:var(--fs-2xs);margin-left:5px}
.ltrack{position:relative;height:28px;border-left:1px solid var(--line2)}
.ltrack:after{content:"";position:absolute;right:0;top:0;bottom:0;border-right:1px solid var(--line3)}
.lvline{position:absolute;top:0;bottom:0;border-left:1px dashed var(--line2);pointer-events:none}
.lline{position:absolute;top:15px;height:1px;background:var(--line)}
.lseg{position:absolute;top:10px;height:8px;border-radius:4px;background:var(--unknown);min-width:10px;
  transition:filter var(--dur-quick) var(--ease-smooth-out)}
.lrow:hover .lseg{filter:saturate(1.15) brightness(.98)}
.lrow.s-done .lseg{background:linear-gradient(90deg,var(--done),color-mix(in srgb,var(--done) 60%,var(--card)))}
.lrow.s-active .lseg{background:linear-gradient(90deg,var(--active),color-mix(in srgb,var(--active) 60%,var(--card)))}
.lrow.s-unknown .lseg{background:var(--unknown)}
.lrow.s-paused .lseg{background:linear-gradient(90deg,var(--paused),color-mix(in srgb,var(--paused) 60%,var(--card)))}
.lpt{position:absolute;top:12.5px;width:3px;height:3px;border-radius:50%;background:var(--card);box-shadow:0 0 0 1px var(--muted);transform:translateX(-1.5px)}
.lpt-single{position:absolute;top:10px;width:7px;height:7px;margin-left:-3.5px;background:var(--card);box-shadow:0 0 0 1.5px var(--unknown);border-radius:50%}
.lrow.s-done .lpt-single{box-shadow:0 0 0 1.5px var(--done)}
.lrow.s-active .lpt-single{box-shadow:0 0 0 1.5px var(--active)}
.lrow.s-paused .lpt-single{box-shadow:0 0 0 1.5px var(--paused)}
.lbrk{position:absolute;top:6px;height:16px;border-left:1px dashed var(--active)}
.lanes-hint{margin:6px 0 0;font-size:var(--fs-2xs);color:var(--muted);line-height:1.55}
.lane-today{position:absolute;top:0;bottom:0;border-left:1px dashed var(--accent);opacity:.55;pointer-events:none}
.lane-today b{position:absolute;top:-2px;left:3px;font-size:var(--fs-2xs);color:var(--accent-ink);background:var(--accent-soft);border-radius:4px;padding:0 4px;white-space:nowrap;font-weight:660}

/* ---------- 10. 工作流线索 ---------- */
.wf{padding:0 0 64px}
.wfg{border:1px solid var(--line);background:var(--card);border-radius:var(--r2);box-shadow:var(--sh1),inset 0 1px 0 var(--edge);margin:0 0 8px;overflow:hidden}
.wfh{appearance:none;display:flex;align-items:center;gap:9px;padding:8px 11px;cursor:pointer;user-select:none;background:var(--card2);border:0;width:100%;font:inherit;text-align:left;touch-action:manipulation;
  transition:background-color var(--dur-quick) var(--ease-smooth-out)}
.wfh:hover{background:var(--card3)}
.wfh:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.wfh .caret{font-size:var(--fs-2xs);color:var(--muted);transform:rotate(0deg);transition:transform var(--dur-quick) var(--ease-smooth-out)}
.wfg.closed .wfh .caret{transform:rotate(-90deg)}
.wfh .lane{font-size:var(--fs-sm);font-weight:680;color:var(--ink);letter-spacing:var(--tr-title)}
.wfh .meta{margin-left:auto;display:flex;gap:9px;font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap}
.wfh .meta b{color:var(--ink2);font-weight:660}
.wfg.closed .wfbody{display:none}
.wfbody{padding:0 9px 7px}
.wfrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:baseline;padding:5px 7px;border-top:1px solid var(--line3);cursor:pointer;border-radius:5px;touch-action:manipulation;
  transition:background-color var(--dur-quick) var(--ease-smooth-out)}
.wfrow:hover{background:var(--card3)}
.wfrow.on{background:var(--accent-soft)}
.wfrow .t{font-size:var(--fs-xs);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wfrow .m{font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.wf-empty{font-size:var(--fs-xs);color:var(--muted);padding:5px 7px}
.wf-note{font-size:var(--fs-2xs);color:var(--muted);margin:2px 0 10px;line-height:1.6}

/* ---------- 11. 合成 fixture 分区 ---------- */
.demo{padding:0 0 48px}
.demo-banner{border:1px solid var(--demo-line);background:linear-gradient(180deg,var(--demo-soft),color-mix(in srgb,var(--demo) 3%,var(--card)));border-radius:var(--r2);padding:11px 13px;margin:0 0 13px;box-shadow:var(--sh1)}
.demo-banner h3{margin:0 0 5px;font-size:var(--fs-xs);color:var(--demo);display:flex;align-items:center;gap:8px;line-height:1.45}
.demo-banner p{margin:0;font-size:var(--fs-2xs);color:var(--ink3);line-height:1.65}
.demo-tag{font-size:var(--fs-2xs);background:var(--demo);color:#fff;border-radius:4px;padding:1px 6px;font-weight:660;letter-spacing:.04em;white-space:nowrap}
.demo-stat{display:flex;gap:7px;margin:9px 0 0;flex-wrap:wrap}
.demo-stat span{font-size:var(--fs-2xs);color:var(--demo);background:var(--card);border:1px solid var(--demo-line);border-radius:5px;padding:1px 8px}
.demo-stat span b{font-weight:660}
.demo .lseg{background:linear-gradient(90deg,var(--demo),color-mix(in srgb,var(--demo) 55%,var(--card)))!important}
.demo .lrow.on{background:var(--demo-soft)}
.demo .lname{color:var(--demo)}
.demo .lpt-single{box-shadow:0 0 0 1.5px var(--demo)}

/* ---------- 12. 窄屏遮罩 / 抽屉 / sheet ---------- */
.scrim{position:fixed;inset:0;background:var(--scrim);z-index:55;opacity:0;pointer-events:none;
  transition:opacity var(--dur-fast) var(--ease-smooth-out);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
body.rail-open .scrim,body.detail-sheet .scrim{opacity:1;pointer-events:auto}

/* ---------- 13. 响应式三档 ---------- */
/* 中屏：rail 收窄 + 卡片列收窄，详情仍可收起 */
@media (max-width:1439px){
  :root{--rail-w:288px;--mid-w:352px}
  .percept{grid-template-columns:repeat(2,minmax(0,1fr))}
  .brand span{max-width:20ch}
}
@media (max-width:1199px){
  :root{--rail-w:272px;--mid-w:320px;--pad:12px}
  .chips{display:none}
  .panels{grid-template-columns:repeat(2,minmax(0,1fr))}
}
/* 窄屏：单栏堆叠 —— rail 变抽屉，详情变全屏 sheet，卡片全宽 */
@media (max-width:1023px){
  body{height:100dvh}
  .layout{display:block;position:relative;flex:1;min-height:0}
  .mid{height:100%;border-right:0;padding:0 12px 64px}
  .mid-top{padding:10px 4px 8px}
  .rail{
    position:fixed;top:0;bottom:0;left:0;width:min(86vw,344px);z-index:60;
    transform:translateX(-102%);will-change:transform;
    border-right:1px solid var(--line);box-shadow:var(--sh3);
    background:linear-gradient(180deg,var(--card2),var(--bg2));
  }
  body.rail-open .rail{transform:none}
  .rail-top{height:56px}
  /* 窄屏：详情 = 全屏 sheet（从下往上，与抽屉同向） */
  .detail{
    position:fixed;inset:0;z-index:70;width:auto!important;padding:16px 16px calc(88px + env(safe-area-inset-bottom,0px));
    translate:0 101%;will-change:translate;
    background:var(--bg);overflow:auto;
    box-shadow:var(--sh3);
    border:0;
    transition:translate var(--dur-fast) var(--ease-smooth-out);
  }
  body.detail-sheet .detail{translate:0 0}
  /* sheet 自带位移，关掉卡片级入场动画，避免 transform 与 translate 打架 */
  .detail-reveal{animation:none!important}
  .navbtn{display:inline-flex}
  .brand span{display:none}
  .chips{display:none}
  .fsctl,.themebtn{flex:none}
  .topbar{gap:6px;padding:0 10px;flex-wrap:wrap;row-gap:6px;min-height:48px;padding-top:max(6px,env(safe-area-inset-top,0px));padding-bottom:6px;align-content:center}
  .brand{flex:1 1 auto;order:0}
  .brand b{font-size:var(--fs-sm);white-space:nowrap}
  .controls{order:2;width:100%;flex-wrap:nowrap;overflow-x:auto;max-width:100%;scrollbar-width:none;
    justify-content:flex-start;gap:6px;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  .controls::-webkit-scrollbar{display:none}
  .navbtn{order:1}
  .vswitch button{padding:4px 8px}
  .fsctl button{padding:5px 7px}
  .themebtn{padding:4px 8px}
  .dtoggle{padding:4px 9px}
  .demo-switch{padding:3px 8px 3px 5px}
  .card.narrow,.card.medium{max-width:100%}
  .panels{grid-template-columns:repeat(2,minmax(0,1fr))}
  .percept{grid-template-columns:repeat(2,minmax(0,1fr))}
  .axis-row,.lrow{grid-template-columns:7.5rem minmax(0,1fr)}
  .detail .dh h2{font-size:1.25rem}
  .sheet-close{display:inline-flex;align-items:center;gap:5px;position:sticky;top:0;margin:0 0 10px auto;padding:5px 11px;
    border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:var(--fs-2xs);color:var(--ink2);cursor:pointer;z-index:5;
    box-shadow:var(--sh1);touch-action:manipulation;float:right}
  .sheet-close:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  /* 触屏：输入框 ≥16px 防 iOS 缩放 */
  .toolbar input{font-size:16px}
}
@media (max-width:560px){
  .panels{grid-template-columns:minmax(0,1fr)}
  .mid{padding:0 10px 64px}
  .fstxt,.ttxt{display:none}
  .brand{display:none}
  .detail{padding:12px 12px calc(80px + env(safe-area-inset-bottom,0px))}
  .axis-row,.lrow{grid-template-columns:5.5rem minmax(0,1fr)}
  .lane-today b{display:none}
}
/* 触屏：hover 态只在真 hover 设备启用（mobile-native §1） */
@media (hover:none){
  .card:active{transform:scale(.995)}
  .tick:hover{background:none}
}

/* ---------- 14. 无障碍降级 ---------- */
@media (prefers-reduced-motion:reduce){
  *{transition-duration:1ms!important;animation-duration:1ms!important;animation-delay:0ms!important;scroll-behavior:auto!important}
  .detail-reveal,.cp,.card.fresh{animation:none!important}
  .vswitch .pill{transition:none!important}
}
/* 降低透明度：材质变实，取消 backdrop blur */
@media (prefers-reduced-transparency:reduce){
  .topbar,.rail-top,.mid-top,.msep,.rail-today{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
  .topbar{background:var(--card)}
  .rail-top,.msep{background:var(--card2)}
  .mid-top{background:var(--bg)}
  .rail-today{background:var(--bg2)}
}
/* 高对比：实底 + 明确描边 */
@media (prefers-contrast:more){
  :root{--line:#8a93a3;--line2:#9aa3b1;--muted:#4a5361;--ink2:#252c37}
  html[data-theme="dark"]{--line:#5b6a80;--line2:#6b7a90;--muted:#b9c4d4;--ink2:#dbe2ec}
  .card,.panel,.wfg,.srcs{border-color:var(--line)}
  .badge{border-width:1.5px}
}
`;

/* SCRIPT — 运行时字符串数组（每行一个元素，便于逐行 diff） */
export const SCRIPT = [
  "",
  "/* ============================================================================",
  "   wb-event-preview v4 — 运行时",
  "   ----------------------------------------------------------------------------",
  "   阅读模型（2026-10-23 用户裁定）：倒叙 = 「最新在底部，向上回溯历史」。",
  "   · DOM 顺序仍是 早 → 新（升序），因为「最下面 = 最新」；",
  "   · 改变的是【阅读锚点】：进场即锚到底部（最新），向上滚 = 更早；",
  "   · 懒加载只作用在时间流的旧端（顶部），初始窗口 36 个事件；",
  "   · 键盘 ↑ = 更早（idx-1）、↓ = 更新（idx+1）；",
  "   · 三视图共用同一「时间方向」定义：竖排列表 = 上早下新，横排时间轴 = 左早右新。",
  "   ========================================================================== */",
  "(function () {",
  "  \"use strict\";",
  "",
  "  var DATA = JSON.parse(document.getElementById(\"payload\").textContent);",
  "  var DEMO_SRC = document.getElementById(\"demo-payload\");",
  "  var DEMO_DATA = DEMO_SRC ? JSON.parse(DEMO_SRC.textContent) : { events: [] };",
  "",
  "  /* EV 升序：EV[0] 最早、EV[N-1] 最新。倒叙由「锚点 + 窗口」实现，不改数组。 */",
  "  var EV = DATA.events;",
  "  var N = EV.length;",
  "  var byId = {}, byIdAll = {}, realIdx = {};",
  "  for (var i0 = 0; i0 < N; i0++) { byId[EV[i0].id] = EV[i0]; byIdAll[EV[i0].id] = EV[i0]; realIdx[EV[i0].id] = i0; }",
  "",
  "  var LS_VIEW = \"wbEvt.viewMode\", LS_DETAIL = \"wbEvt.detailOpen\", LS_THEME = \"wbEvt.theme\";",
  "  var LS_FS = \"wbEvt.fontScale\", LS_SCALE = \"wbEvt.railScale\", LS_LAZY = \"wbEvt.lazy\";",
  "  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }",
  "  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }",
  "",
  "  /* ---------- 窗口参数 ---------- */",
  "  var INIT_WINDOW = 36;   /* 初始 36 个：≈4 屏卡片 + 两个月的轴长；30–50 区间取中偏小，首屏最快 */",
  "  var CHUNK = 24;         /* 每次向上加载 24 个：约 2.5 屏，滚一次够看一阵 */",
  "",
  "  var viewMode = (function () { var s = lsGet(LS_VIEW); return (s === \"lanes\" || s === \"workflow\") ? s : \"stream\"; })();",
  "  var detailOpen = lsGet(LS_DETAIL) !== \"false\";",
  "  var lazyOn = lsGet(LS_LAZY) !== \"0\";",
  "  var loadedStart = lazyOn ? Math.max(0, N - INIT_WINDOW) : 0;",
  "  var filterMode = false;",
  "  var demoOn = false;",
  "  var cpOpen = {};",
  "  var curId = null;",
  "  var cardEls = {}, tickEls = {};",
  "  var itemOrder = [];",
  "  var loading = false, armed = false, userScrolled = false;",
  "  var lastQ = \"\";",
  "  var railScale = lsGet(LS_SCALE) === \"real\" ? \"real\" : \"even\";",
  "",
  "  function el(tag, cls, text) {",
  "    var n = document.createElement(tag);",
  "    if (cls) n.className = cls;",
  "    if (text != null) n.textContent = text;",
  "    return n;",
  "  }",
  "  function statusLabel(s) { return s === \"done\" ? \"已完成\" : s === \"active\" ? \"进行中\" : s === \"paused\" ? \"搁置\" : \"未判定\"; }",
  "  function statusCls(s) { return s === \"done\" ? \"b-done\" : s === \"active\" ? \"b-active\" : s === \"paused\" ? \"b-paused\" : \"b-unknown\"; }",
  "  function confLabel(s) { return s === \"high\" ? \"高置信\" : s === \"medium\" ? \"中置信\" : \"待人工\"; }",
  "  function confCls(s) { return s === \"high\" ? \"b-high\" : s === \"medium\" ? \"b-medium\" : \"b-low\"; }",
  "  function kindLabel(k) { return k === \"planSnapshot\" ? \"白板快照\" : k === \"sessionTranscript\" ? \"会话转写\" : k === \"note\" ? \"说明\" : k === \"unplanned\" ? \"待归并\" : k === \"demo\" ? \"合成\" : \"账本事件\"; }",
  "  function pad2(n) { return n < 10 ? \"0\" + n : \"\" + n; }",
  "  function isoToMs(s) { return Date.parse(s); }",
  "  function isoToLocal(ms) {",
  "    var d = new Date(ms);",
  "    return d.getFullYear() + \"-\" + pad2(d.getMonth() + 1) + \"-\" + pad2(d.getDate()) + \" \" + pad2(d.getHours()) + \":\" + pad2(d.getMinutes());",
  "  }",
  "  function fmtHours(h) { return (Math.round(h * 10) / 10).toFixed(1); }",
  "  var WEEK = [\"周日\", \"周一\", \"周二\", \"周三\", \"周四\", \"周五\", \"周六\"];",
  "",
  "  /* ---------- 合成 fixture：独立数据集，绝不混入 EV ---------- */",
  "  var DEMO = (DEMO_DATA.events || []).map(function (d, di) {",
  "    var cps = d.checkpoints.map(function (c, j) {",
  "      var ms = isoToMs(c.at);",
  "      return {",
  "        id: \"cp-\" + d.id + \"-\" + j, at: isoToLocal(ms), date: isoToLocal(ms).slice(0, 10),",
  "        time: isoToLocal(ms).slice(11), ms: ms, rel: \"fixtures/concurrent-demo.json\",",
  "        bytes: 0, sha256: \"synthetic\", goal: [c.note], state: [c.note], dead: [], next: [c.note],",
  "        quoteRef: c.note, quoteLine: 0, userPercept: [], commitments: [], synthetic: true",
  "      };",
  "    });",
  "    for (var q = 0; q < cps.length; q++) cps[q].panels = [",
  "      { kind: \"state\", label: \"现状\", source: \"state\" },",
  "      { kind: \"log\", label: \"log\", source: \"quote\", items: [cps[q].quoteRef], file: cps[q].rel, line: 0 },",
  "      { kind: \"dead\", label: \"失败\", source: \"dead\" },",
  "      { kind: \"next\", label: \"下一步\", source: \"next\" },",
  "      { kind: \"userPercept\", label: \"userPercept\", source: \"userPercept\", items: [] },",
  "      { kind: \"commitment\", label: \"约定\", source: \"commitments\", items: [] }",
  "    ];",
  "    return {",
  "      id: d.id, kind: \"demo\", title: d.title, lane: d.lane, summary: d.summary, status: d.status,",
  "      confidence: \"low\", rationale: \"合成 fixture（fixtures/concurrent-demo.json）：\" + d.summary,",
  "      date: cps[0].date, start: cps[0].at, end: cps[cps.length - 1].at,",
  "      startMs: cps[0].ms, endMs: cps[cps.length - 1].ms,",
  "      checkpoints: cps, members: [], outcomes: [], skills: { hitCount: 0, names: [], touched: false },",
  "      userPercept: [], agentTrace: [], sharedGround: [], commitments: [], sourceCount: cps.length",
  "    };",
  "  });",
  "  for (var bi = 0; bi < N; bi++) byIdAll[EV[bi].id] = EV[bi];",
  "  for (var bj = 0; bj < DEMO.length; bj++) byIdAll[DEMO[bj].id] = DEMO[bj];",
  "",
  "  /* ---------- lane 提取（集合成员关系） ---------- */",
  "  var LANE_RE = /(?:^|[^A-Za-z0-9])(P\\d{1,2}|R\\d{1,2}|G\\d{1,2})(?![0-9A-Za-z])|([EF])\\s*线/g;",
  "  function tokensOf(text) {",
  "    var out = [], m;",
  "    LANE_RE.lastIndex = 0;",
  "    while ((m = LANE_RE.exec(text))) {",
  "      var t = m[1] || (m[2] + \"线\");",
  "      if (out.indexOf(t) < 0) out.push(t);",
  "    }",
  "    return out;",
  "  }",
  "  function lanesOf(ev) {",
  "    if (ev.kind === \"demo\") return [ev.lane];",
  "    var out = tokensOf(ev.title || \"\");",
  "    var more = tokensOf(ev.summary || \"\");",
  "    for (var i = 0; i < more.length; i++) if (out.indexOf(more[i]) < 0) out.push(more[i]);",
  "    return out;",
  "  }",
  "  function laneKeys(ev) { var ls = lanesOf(ev); return ls.length ? ls : [\"(主线)\"]; }",
  "  function laneKey(ev) { return laneKeys(ev)[0]; }",
  "  function laneNum(k) { var m = k.match(/^([PRG])(\\d+)$/); return m ? Number(m[2]) : 9999; }",
  "",
  "  /* ---------- 空档 / 分段 ---------- */",
  "  var GAP_H = 2;",
  "  var GAP_MS = GAP_H * 3600000;",
  "  function gapsOf(ev) {",
  "    var out = [];",
  "    for (var i = 1; i < ev.checkpoints.length; i++) {",
  "      var d = ev.checkpoints[i].ms - ev.checkpoints[i - 1].ms;",
  "      if (d > GAP_MS) out.push({ afterIdx: i - 1, hours: d / 3600000, from: ev.checkpoints[i - 1].at, to: ev.checkpoints[i].at });",
  "    }",
  "    return out;",
  "  }",
  "  function segmentsOf(ev) {",
  "    var segs = [], cur = [ev.checkpoints[0]];",
  "    for (var i = 1; i < ev.checkpoints.length; i++) {",
  "      if (ev.checkpoints[i].ms - ev.checkpoints[i - 1].ms > GAP_MS) { segs.push(cur); cur = []; }",
  "      cur.push(ev.checkpoints[i]);",
  "    }",
  "    segs.push(cur);",
  "    return segs;",
  "  }",
  "  /* 事件之间的空档（用于 rail 上把时间「断开」） */",
  "  function idleBefore(i) {",
  "    if (i <= 0) return 0;",
  "    var gap = EV[i].startMs - EV[i - 1].endMs;",
  "    return gap > 0 ? gap : 0;",
  "  }",
  "",
  "  /* ---------- 三态卡 ---------- */",
  "  function ticketOf(ev) {",
  "    if (ev.kind === \"demo\" || ev.kind !== \"ledger\") return \"narrow\";",
  "    var n = ev.checkpoints.length;",
  "    if (n <= 1) return \"narrow\";",
  "    if (n >= 4) return \"wide\";",
  "    return \"medium\";",
  "  }",
  "",
  "  /* ---------- 相对时间（运行时算，构建产物体内不含时间戳） ---------- */",
  "  function relLabel(ev) {",
  "    var now = Date.now();",
  "    var d = now - ev.startMs;",
  "    var H = 3600000, D = 24 * H;",
  "    if (d < 0) return ev.start.slice(5, 16);",
  "    if (d < H) return Math.max(1, Math.round(d / 60000)) + \" 分钟前\";",
  "    if (d < D) return Math.round(d / H) + \" 小时前\";",
  "    if (d < 2 * D) return \"昨天 \" + ev.start.slice(11, 16);",
  "    if (d < 7 * D) return Math.round(d / D) + \" 天前\";",
  "    return ev.start.slice(0, 10);",
  "  }",
  "",
  "  /* ==========================================================================",
  "     左轨：时间轴 v4",
  "     · 宽度 336px（v3 的 200px → 1.68 倍），标题两行不截成一行省略号",
  "     · 月份 sticky 分隔 + 当月「日密度」微柱状（31 根，高度 ∝ 当天事件数）",
  "     · 日分隔：日期 + 周几 + 当日事件数 + 密度条",
  "     · 等距 / 真实比例 两档（真实比例用 log 压缩间隔，40.9h 的洞才看得出来）",
  "     · 空档 >2h 在轨道上真断开（虚线 + 文字），不只在右栏提示",
  "     · 今天/最新锚点贴在底部",
  "     ========================================================================== */",
  "  function monthDensity(mk) {",
  "    var days = {}, dim = new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0).getDate();",
  "    /* dim = 该月真实天数（2026-09 → 30 / 2026-10 → 31），密度柱按真实天数画 */",
  "    for (var i = 0; i < N; i++) {",
  "      if (EV[i].start.slice(0, 7) === mk) {",
  "        var dd = Number(EV[i].start.slice(8, 10));",
  "        days[dd] = (days[dd] || 0) + 1;",
  "      }",
  "    }",
  "    var max = 0;",
  "    for (var k in days) if (days[k] > max) max = days[k];",
  "    return { days: days, max: max, dim: dim };",
  "  }",
  "  function monthLabel(mk) { return mk.slice(0, 4) + \" 年 \" + Number(mk.slice(5, 7)) + \" 月\"; }",
  "",
  "  function renderRail() {",
  "    var box = document.getElementById(\"rail-axis\");",
  "    if (!box) return;",
  "    box.innerHTML = \"\";",
  "    tickEls = {};",
  "    var items = demoOn ? DEMO : EV;",
  "    var lastMonth = \"\", lastDay = \"\";",
  "    var prevTick = null;",
  "",
  "    for (var i = 0; i < items.length; i++) {",
  "      var ev = items[i];",
  "      var mk = ev.start.slice(0, 7), dk = ev.start.slice(0, 10);",
  "",
  "      if (mk !== lastMonth) {",
  "        lastMonth = mk; lastDay = \"\";",
  "        var md = monthDensity(mk);",
  "        var sep = el(\"div\", \"msep\");",
  "        sep.appendChild(el(\"span\", \"mlabel\", monthLabel(mk)));",
  "        var cntM = 0;",
  "        for (var dk2 in md.days) cntM += md.days[dk2];",
  "        sep.appendChild(el(\"span\", \"mcount\", cntM + \" 事件\"));",
  "        var dens = el(\"div\", \"mdens\");",
  "        dens.title = monthLabel(mk) + \" 每日事件数（柱高 ∝ 当天事件数）\";",
  "        for (var d = 1; d <= md.dim; d++) {",
  "          var c = md.days[d] || 0;",
  "          var bar = el(\"i\", c ? (c >= Math.max(2, md.max * 0.6) ? \"hi\" : \"\") : \"empty\");",
  "          bar.style.height = c ? Math.max(3, Math.round(14 * c / md.max)) + \"px\" : \"1px\";",
  "          dens.appendChild(bar);",
  "        }",
  "        sep.appendChild(dens);",
  "        box.appendChild(sep);",
  "      }",
  "",
  "      /* 事件间空档 > 2h：轨道断开 */",
  "      var idle = idleBefore(i);",
  "      if (idle > GAP_MS) {",
  "        var br = el(\"div\", \"rbreak\");",
  "        br.appendChild(el(\"span\", null, \"空档 \" + fmtHours(idle / 3600000) + \"h\"));",
  "        br.appendChild(el(\"span\", \"rline\"));",
  "        box.appendChild(br);",
  "        lastDay = \"\";",
  "      } else if (railScale === \"real\" && i > 0) {",
  "        var h = Math.log(1 + idle / 60000) / Math.log(2);",
  "        var pad = Math.min(64, Math.max(0, Math.round(h * 7)));",
  "        if (pad > 0) box.appendChild(el(\"div\", null)).style.height = pad + \"px\";",
  "      }",
  "",
  "      if (dk !== lastDay) {",
  "        lastDay = dk;",
  "        var sep2 = el(\"div\", \"dsep\");",
  "        var sameDay = 0;",
  "        for (var j = i; j < items.length && items[j].start.slice(0, 10) === dk; j++) sameDay++;",
  "        var dbar = el(\"span\", \"dbar\");",
  "        dbar.style.width = Math.min(96, 8 + sameDay * 12) + \"px\";",
  "        sep2.appendChild(dbar);",
  "        sep2.appendChild(el(\"span\", \"dl\", dk.slice(5)));",
  "        sep2.appendChild(el(\"span\", \"dw\", WEEK[new Date(ev.startMs).getDay()]));",
  "        sep2.appendChild(el(\"span\", \"dc\", sameDay + \" 个\"));",
  "        sep2.appendChild(el(\"span\", \"dline\"));",
  "        box.appendChild(sep2);",
  "      }",
  "",
  "      var b = el(\"button\", \"tick s-\" + (ev.status || \"unknown\"));",
  "      b.type = \"button\";",
  "      b.setAttribute(\"data-id\", ev.id);",
  "      b.setAttribute(\"data-idx\", String(i));",
  "      if (ev.kind === \"demo\") b.className = \"tick demo-rail s-\" + (ev.status || \"unknown\");",
  "      var dot = el(\"span\", \"tdot\");",
  "      b.appendChild(dot);",
  "      b.appendChild(el(\"span\", \"ttime\", ev.start.slice(11, 16)));",
  "      var lab = el(\"span\", \"tlabel\");",
  "      lab.appendChild(el(\"b\", null, ev.title));",
  "      var sub = relLabel(ev) + \" · \" + ev.checkpoints.length + \" 点\";",
  "      lab.appendChild(el(\"i\", null, sub));",
  "      b.appendChild(lab);",
  "      var gcount = gapsOf(ev).length;",
  "      if (gcount) b.appendChild(el(\"span\", \"tgap\", \"⏸\"));",
  "      b.title = ev.title + \" · \" + ev.start + (ev.end !== ev.start ? \" → \" + ev.end : \"\") + \" · \" + ev.checkpoints.length + \" 检查点\" + (gcount ? \" · 空档 \" + gcount : \"\");",
  "      b.addEventListener(\"click\", (function (id) { return function () { select(id, { scroll: true, openDetail: true }); }; })(ev.id));",
  "      box.appendChild(b);",
  "      tickEls[ev.id] = b;",
  "      prevTick = b;",
  "    }",
  "",
  "    /* 今天 / 最新 锚点 */",
  "    var last = items[items.length - 1];",
  "    if (last) {",
  "      var today = el(\"div\", \"rail-today\");",
  "      today.appendChild(el(\"span\", \"tdot2\"));",
  "      var same = last.start.slice(0, 10) === isoToLocal(Date.now()).slice(0, 10);",
  "      var tb = el(\"b\", null, same ? \"今天\" : \"最新\");",
  "      today.appendChild(tb);",
  "      today.appendChild(el(\"span\", null, last.start.slice(5, 16)));",
  "      today.appendChild(el(\"span\", \"tl\"));",
  "      box.appendChild(today);",
  "    }",
  "    var hint = document.getElementById(\"rail-hint\");",
  "    if (hint) hint.textContent = demoOn ? DEMO.length + \" 个合成事件\" : N + \" 个事件 · 早 ↑ 新 ↓\";",
  "    /* 倒叙：时间轴同样贴底（最新在下方），向上滚 = 回溯历史 */",
  "    if (!demoOn) scrollRailToNewest();",
  "  }",
  "  /** 时间轴贴底 = 倒叙在左轨上的同一语义 */",
  "  function scrollRailToNewest() {",
  "    var rail = document.getElementById(\"rail\");",
  "    if (!rail) return;",
  "    rail.scrollTop = rail.scrollHeight;",
  "    requestAnimationFrame(function () { rail.scrollTop = rail.scrollHeight; });",
  "  }",
  "  /** 让某个 tick 在 rail 内可见（只滚 rail，不动主文档） */",
  "  function railEnsureVisible(id) {",
  "    var rail = document.getElementById(\"rail\");",
  "    var t = tickEls[id];",
  "    if (!rail || !t) return;",
  "    var rt = rail.getBoundingClientRect(), tt = t.getBoundingClientRect();",
  "    var padT = 70, padB = 76;",
  "    if (tt.top < rt.top + padT) rail.scrollTop -= (rt.top + padT - tt.top);",
  "    else if (tt.bottom > rt.bottom - padB) rail.scrollTop += (tt.bottom - (rt.bottom - padB));",
  "  }",
  "",
  "",
  "  /* ==========================================================================",
  "     中栏：时间流（懒加载窗口）",
  "     ========================================================================== */",
  "  function renderCard(ev, idxInList) {",
  "    var ticket = ticketOf(ev);",
  "    var c = el(\"div\", \"card \" + ticket + \" s-\" + (ev.status || \"unknown\"));",
  "    c.setAttribute(\"data-id\", ev.id);",
  "    if (idxInList >= 0) c.setAttribute(\"data-idx\", String(idxInList));",
  "    c.setAttribute(\"role\", \"button\");",
  "    c.setAttribute(\"tabindex\", \"0\");",
  "    c.addEventListener(\"keydown\", function (e) {",
  "      if (e.key === \"Enter\" || e.key === \" \") { e.preventDefault(); select(ev.id, { scroll: true, openDetail: true }); }",
  "    });",
  "    var r1 = el(\"div\", \"row1\");",
  "    r1.appendChild(el(\"div\", \"ttl\", ev.title));",
  "    r1.appendChild(el(\"div\", \"dt\", ev.start.slice(0, 16)));",
  "    c.appendChild(r1);",
  "    if (ticket === \"narrow\") {",
  "      cardEls[ev.id] = c;",
  "      c.addEventListener(\"click\", function () { select(ev.id, { scroll: true, openDetail: true }); });",
  "      return c;",
  "    }",
  "    var meta = el(\"div\", \"meta\");",
  "    meta.appendChild(el(\"span\", \"badge \" + statusCls(ev.status), statusLabel(ev.status)));",
  "    if (ticket === \"wide\") {",
  "      meta.appendChild(el(\"span\", \"badge b-kind\", kindLabel(ev.kind)));",
  "      meta.appendChild(el(\"span\", \"badge \" + confCls(ev.confidence), confLabel(ev.confidence)));",
  "    }",
  "    meta.appendChild(el(\"span\", \"badge b-kind\", ev.checkpoints.length + \" 检查点\"));",
  "    var gs = gapsOf(ev);",
  "    if (gs.length) {",
  "      var mx = 0;",
  "      for (var gi = 0; gi < gs.length; gi++) if (gs[gi].hours > mx) mx = gs[gi].hours;",
  "      meta.appendChild(el(\"span\", \"badge b-active\", \"空档 \" + fmtHours(mx) + \"h\"));",
  "    }",
  "    c.appendChild(meta);",
  "    if (ticket === \"wide\") {",
  "      if (ev.summary) c.appendChild(el(\"div\", \"summary\", ev.summary));",
  "      if (ev.outcomes.length) {",
  "        var sec = el(\"div\", \"sec\");",
  "        sec.appendChild(el(\"h4\", null, \"成果\"));",
  "        var ul = el(\"ul\", \"li\");",
  "        var oc = ev.outcomes.slice(0, 2);",
  "        for (var i = 0; i < oc.length; i++) ul.appendChild(el(\"li\", null, oc[i]));",
  "        if (ev.outcomes.length > oc.length) ul.appendChild(el(\"li\", \"more\", \"还有 \" + (ev.outcomes.length - oc.length) + \" 项成果\"));",
  "        sec.appendChild(ul);",
  "        c.appendChild(sec);",
  "      }",
  "      if (ev.kind === \"ledger\") {",
  "        var sk = el(\"div\", \"sec\");",
  "        sk.appendChild(el(\"h4\", null, \"skill 状态\"));",
  "        var skt = ev.skills.touched ? (ev.skills.names.length ? \"命中 \" + ev.skills.names.join(\" / \") : \"本轮提到技能库（未点名条目）\") : \"本事件未涉及技能库\";",
  "        sk.appendChild(el(\"div\", \"summary\", skt));",
  "        c.appendChild(sk);",
  "      }",
  "      c.appendChild(el(\"div\", \"why\", ev.rationale));",
  "    }",
  "    c.appendChild(el(\"div\", \"expand\", \"点开 → 右侧时间轴\"));",
  "    c.addEventListener(\"click\", function () { select(ev.id, { scroll: true, openDetail: true }); });",
  "    cardEls[ev.id] = c;",
  "    return c;",
  "  }",
  "",
  "  function streamStartIdx() { return (lazyOn && !filterMode && !demoOn) ? loadedStart : 0; }",
  "",
  "  /** 懒加载状态条：常驻在 sticky 头里，任何时候都看得到「已载 X / 总 Y」 */",
  "  function loadBar() {",
  "    var bar = el(\"div\", \"loadmore\");",
  "    bar.id = \"loadmore\";",
  "    var start = loadedStart, total = N;",
  "    var btn = el(\"button\", \"lm-btn\");",
  "    btn.type = \"button\";",
  "    btn.id = \"lm-more\";",
  "    if (demoOn) { btn.textContent = \"合成演示：无更早\"; btn.disabled = true; }",
  "    else if (!lazyOn) { btn.textContent = \"已全量渲染\"; btn.disabled = true; }",
  "    else if (start <= 0) { btn.textContent = \"已到最早\"; btn.disabled = true; }",
  "    else { btn.textContent = \"↑ 加载更早 \" + Math.min(CHUNK, start) + \" 个\"; }",
  "    btn.addEventListener(\"click\", function () { loadEarlier(); });",
  "    bar.appendChild(btn);",
  "",
  "    var cnt = el(\"span\", \"lm-cnt\");",
  "    cnt.id = \"lm-cnt\";",
  "    cnt.appendChild(document.createTextNode(\"已载 \"));",
  "    cnt.appendChild(el(\"b\", null, String(demoOn ? DEMO.length : N - start)));",
  "    cnt.appendChild(document.createTextNode(\" / \" + (demoOn ? DEMO.length : total)));",
  "    bar.appendChild(cnt);",
  "",
  "    if (!demoOn) {",
  "      var all = el(\"button\", \"lm-btn\");",
  "      all.type = \"button\";",
  "      all.id = \"lm-all\";",
  "      all.textContent = lazyOn ? \"全量渲染（关懒加载）\" : \"回到分段（开懒加载）\";",
  "      all.title = lazyOn ? \"负路径：关掉懒加载后 184 个事件全部渲染\" : \"回到初始窗口 + 向上加载\";",
  "      all.addEventListener(\"click\", function () {",
  "        lazyOn = !lazyOn;",
  "        lsSet(LS_LAZY, lazyOn ? \"1\" : \"0\");",
  "        loadedStart = lazyOn ? Math.max(0, N - INIT_WINDOW) : 0;",
  "        filterMode = false;",
  "        qEl.value = \"\";",
  "        rebuildStream(true);",
  "      });",
  "      bar.appendChild(all);",
  "    }",
  "    var sp = el(\"span\", \"lm-spin\");",
  "    sp.id = \"lm-spin\";",
  "    sp.style.display = \"none\";",
  "    bar.appendChild(sp);",
  "    return bar;",
  "  }",
  "",
  "  /** 把懒加载条挂进 sticky 头（每次重建成同一条，保证常驻可见） */",
  "  function mountLoadBar() {",
  "    var slot = document.getElementById(\"lm-slot\");",
  "    if (!slot) return;",
  "    slot.innerHTML = \"\";",
  "    slot.appendChild(loadBar());",
  "  }",
  "  function updateLmBar() {",
  "    var bar = document.getElementById(\"loadmore\");",
  "    if (!bar) return;",
  "    var start = loadedStart;",
  "    var btn = document.getElementById(\"lm-more\");",
  "    var cnt = document.getElementById(\"lm-cnt\");",
  "    var all = document.getElementById(\"lm-all\");",
  "    if (btn) {",
  "      if (demoOn) { btn.textContent = \"合成演示：无更早\"; btn.disabled = true; }",
  "      else if (!lazyOn) { btn.textContent = \"已全量渲染\"; btn.disabled = true; }",
  "      else if (start <= 0) { btn.textContent = \"已到最早\"; btn.disabled = true; }",
  "      else { btn.textContent = \"↑ 加载更早 \" + Math.min(CHUNK, start) + \" 个\"; btn.disabled = false; }",
  "    }",
  "    if (cnt) {",
  "      cnt.innerHTML = \"\";",
  "      cnt.appendChild(document.createTextNode(\"已载 \"));",
  "      cnt.appendChild(el(\"b\", null, String(demoOn ? DEMO.length : N - start)));",
  "      cnt.appendChild(document.createTextNode(\" / \" + (demoOn ? DEMO.length : N)));",
  "    }",
  "    if (all) all.textContent = lazyOn ? \"全量渲染（关懒加载）\" : \"回到分段（开懒加载）\";",
  "    var top = document.getElementById(\"lm-top\");",
  "    if (top) top.textContent = (demoOn ? DEMO.length : N) - start;",
  "  }",
  "",
  "  function rebuildStream(keepScroll) {",
  "    var mid = document.querySelector(\".mid\");",
  "    var prevBottom = mid ? (mid.scrollHeight - mid.scrollTop - mid.clientHeight) : 0;",
  "    var box = document.getElementById(\"mid-body\");",
  "    if (!box) return;",
  "    box.innerHTML = \"\";",
  "    cardEls = {}; itemOrder = [];",
  "    if (viewMode !== \"stream\") return;",
  "    var wrap = el(\"div\");",
  "    wrap.id = \"cards\";",
  "    mountLoadBar();",
  "    var start = streamStartIdx();",
  "    var items = demoOn ? DEMO : EV;",
  "    if (demoOn) start = 0;",
  "    for (var i = start; i < items.length; i++) {",
  "      var card = renderCard(items[i], demoOn ? -1 : i);",
  "      if (!demoOn && i === items.length - 1) card.classList.add(\"fresh\");",
  "      wrap.appendChild(card);",
  "      itemOrder.push(items[i].id);",
  "    }",
  "    if (!demoOn) {",
  "      var end = el(\"div\", \"end-mark\");",
  "      end.appendChild(el(\"span\", \"em-dot\"));",
  "      end.appendChild(el(\"span\", null, \"最新 · \" + items[items.length - 1].start.slice(0, 16) + \" · 共 \" + items.length + \" 个事件\"));",
  "      wrap.appendChild(end);",
  "    }",
  "    box.appendChild(wrap);",
  "    if (curId && cardEls[curId]) cardEls[curId].classList.add(\"on\");",
  "    updateLmBar();",
  "    if (!keepScroll) anchorToNewest();",
  "    else if (mid) mid.scrollTop = mid.scrollHeight - mid.clientHeight - prevBottom;",
  "    if (!keepScroll && !demoOn) scrollRailToNewest();",
  "    applyFilterVisibility();",
  "  }",
  "",
  "  /** 加载更早的一批。基线要求：加载前后「视口锚定元素」位移 < 2px。 */",
  "  function loadEarlier() {",
  "    if (loading) return;",
  "    if (demoOn || !lazyOn || filterMode) return;",
  "    if (loadedStart <= 0) return;",
  "    var mid = document.querySelector(\".mid\");",
  "    var wrap = document.getElementById(\"cards\");",
  "    if (!mid || !wrap) return;",
  "    loading = true;",
  "    var sp = document.getElementById(\"lm-spin\");",
  "    if (sp) sp.style.display = \"\";",
  "    var btn = document.getElementById(\"lm-more\");",
  "    if (btn) btn.disabled = true;",
  "",
  "    /* 记录锚点：视口内第一个卡片（或任意可见块），以及它到视口顶部的距离 */",
  "    var anchor = null, anchorTop = 0;",
  "    var cands = wrap.querySelectorAll(\".card\");",
  "    var vpTop = mid.getBoundingClientRect().top;",
  "    for (var i = 0; i < cands.length; i++) {",
  "      var r = cands[i].getBoundingClientRect();",
  "      if (r.bottom > vpTop + 4) { anchor = cands[i]; anchorTop = r.top; break; }",
  "    }",
  "    var prevScrollH = mid.scrollHeight;",
  "",
  "    var start = loadedStart;",
  "    var end = Math.max(0, start - CHUNK);",
  "",
  "    /* rAF 让「加载中」状态先画一帧，再插入（真实异步加载的那一帧） */",
  "    requestAnimationFrame(function () {",
  "      for (var k = start - 1; k >= end; k--) {",
  "        var c = renderCard(EV[k], k);",
  "        if (curId === EV[k].id) c.classList.add(\"on\");",
  "        wrap.insertBefore(c, wrap.firstChild);",
  "      }",
  "      loadedStart = end;",
  "",
  "      /* —— 滚动补偿：加了多少高度就补多少 scrollTop —— */",
  "      var delta = mid.scrollHeight - prevScrollH;",
  "      if (delta) mid.scrollTop = mid.scrollTop + delta;",
  "      /* 二次校正：以锚点元素的实际位置为准（布局亚像素、边框取整都能吃掉） */",
  "      if (anchor) {",
  "        var drift = anchor.getBoundingClientRect().top - anchorTop;",
  "        if (drift) mid.scrollTop = mid.scrollTop + drift;",
  "      }",
  "",
  "      /* rail 同步向前扩展 */",
  "      renderRail();",
  "      reapplyRailState();",
  "      updateLmBar();",
  "      loading = false;",
  "      if (sp) sp.style.display = \"none\";",
  "      /* 按钮可用性交给 updateLmBar 判断（到最早时保持 disabled） */",
  "      if (btn && loadedStart > 0) btn.disabled = false;",
  "      if (typeof window.__wbOnLoad === \"function\") window.__wbOnLoad(loadedStart);",
  "    });",
  "  }",
  "",
  "  function anchorToNewest() {",
  "    var mid = document.querySelector(\".mid\");",
  "    if (!mid) return;",
  "    mid.scrollTop = mid.scrollHeight;",
  "    requestAnimationFrame(function () { mid.scrollTop = mid.scrollHeight; });",
  "    setTimeout(function () { if (!userScrolled) mid.scrollTop = mid.scrollHeight; }, 140);",
  "  }",
  "",
  "  function renderStream(mid) {",
  "    var box = document.getElementById(\"mid-body\");",
  "    box.innerHTML = \"\";",
  "    cardEls = {}; itemOrder = [];",
  "    var wrap = el(\"div\");",
  "    wrap.id = \"cards\";",
  "    mountLoadBar();",
  "    var start = streamStartIdx();",
  "    var items = demoOn ? DEMO : EV;",
  "    for (var i = start; i < items.length; i++) {",
  "      wrap.appendChild(renderCard(items[i], demoOn ? -1 : i));",
  "      itemOrder.push(items[i].id);",
  "    }",
  "    if (!demoOn && items.length) {",
  "      var end = el(\"div\", \"end-mark\");",
  "      end.appendChild(el(\"span\", \"em-dot\"));",
  "      end.appendChild(el(\"span\", null, \"最新 · \" + items[items.length - 1].start.slice(0, 16) + \" · 共 \" + items.length + \" 个事件\"));",
  "      wrap.appendChild(end);",
  "    }",
  "    box.appendChild(wrap);",
  "    if (curId && cardEls[curId]) cardEls[curId].classList.add(\"on\");",
  "    updateLmBar();",
  "  }",
  "",
  "",
  "  /* ==========================================================================",
  "     右栏：六格面板 + 检查点折叠 + 空档",
  "     ========================================================================== */",
  "  function panelItems(cp, p) {",
  "    if (p.items && p.items.length) return p.items;",
  "    var arr = cp[p.source];",
  "    return Array.isArray(arr) ? arr : [];",
  "  }",
  "  function countsOf(cp) {",
  "    var out = [];",
  "    for (var i = 0; i < cp.panels.length; i++) {",
  "      var p = cp.panels[i];",
  "      if (p.kind !== \"state\" && p.kind !== \"log\" && p.kind !== \"dead\" && p.kind !== \"next\") continue;",
  "      out.push({ label: p.label, n: panelItems(cp, p).length });",
  "    }",
  "    return out;",
  "  }",
  "  function renderPanels(cp) {",
  "    var wrap = el(\"div\", \"panels\");",
  "    for (var i = 0; i < cp.panels.length; i++) {",
  "      var p = cp.panels[i];",
  "      var pn = el(\"div\", \"panel k-\" + p.kind);",
  "      var h = el(\"div\", \"ph\");",
  "      h.appendChild(el(\"span\", null, p.label));",
  "      var items = panelItems(cp, p);",
  "      h.appendChild(el(\"i\", null, items.length ? String(items.length) : \"—\"));",
  "      pn.appendChild(h);",
  "      var body = el(\"div\", \"pb\");",
  "      if (!items.length) { body.appendChild(el(\"span\", \"empty-v\", cp.synthetic ? \"（合成数据未填）\" : \"（本期未填）\")); }",
  "      else {",
  "        var shown = items.slice(0, 3);",
  "        for (var k = 0; k < shown.length; k++) body.appendChild(el(\"div\", null, (k ? \"· \" : \"\") + shown[k]));",
  "        if (items.length > 3) body.appendChild(el(\"div\", \"more\", \"还有 \" + (items.length - 3) + \" 条\"));",
  "      }",
  "      pn.appendChild(body);",
  "      wrap.appendChild(pn);",
  "    }",
  "    return wrap;",
  "  }",
  "  function cpRow(ev, cp, idx, isNewest) {",
  "    var row = el(\"div\", \"cp\");",
  "    row.setAttribute(\"data-cp\", cp.id);",
  "    var closed = cpOpen[cp.id] !== true;",
  "    var h = el(\"button\", \"cp-h\");",
  "    h.type = \"button\";",
  "    h.appendChild(el(\"span\", \"caret\", \"▼\"));",
  "    h.appendChild(el(\"span\", \"idx\", \"#\" + (idx + 1)));",
  "    h.appendChild(el(\"span\", \"at\", cp.at));",
  "    h.appendChild(el(\"span\", \"src\", cp.rel));",
  "    var cnt = el(\"div\", \"cp-counts\");",
  "    var cs = countsOf(cp);",
  "    for (var ci = 0; ci < cs.length; ci++) {",
  "      var sp = el(\"span\", null, cs[ci].label);",
  "      sp.appendChild(el(\"b\", null, String(cs[ci].n)));",
  "      cnt.appendChild(sp);",
  "    }",
  "    h.appendChild(cnt);",
  "    if (isNewest) row.className += \" newest\";",
  "    if (closed) { row.className += \" closed\"; h.setAttribute(\"aria-expanded\", \"false\"); }",
  "    else h.setAttribute(\"aria-expanded\", \"true\");",
  "    h.addEventListener(\"click\", function () {",
  "      var isClosed = row.className.indexOf(\"closed\") >= 0;",
  "      if (isClosed) { row.className = row.className.replace(\" closed\", \"\"); cpOpen[cp.id] = true; }",
  "      else { row.className += \" closed\"; cpOpen[cp.id] = false; }",
  "      h.setAttribute(\"aria-expanded\", isClosed ? \"true\" : \"false\");",
  "    });",
  "    row.appendChild(h);",
  "    var body = el(\"div\", \"cp-body\");",
  "    var inner = el(\"div\", \"cp-inner\");",
  "    inner.appendChild(renderPanels(cp));",
  "    body.appendChild(inner);",
  "    row.appendChild(body);",
  "    return row;",
  "  }",
  "",
  "  function renderDetail(ev) {",
  "    var box = document.getElementById(\"detail\");",
  "    box.innerHTML = \"\";",
  "    box.classList.remove(\"detail-reveal\");",
  "    void box.offsetWidth;",
  "    box.classList.add(\"detail-reveal\");",
  "    var head = el(\"div\", \"dh\");",
  "    head.appendChild(el(\"h2\", null, ev.title));",
  "    var sub = el(\"div\", \"sub\");",
  "    sub.appendChild(el(\"span\", null, ev.start + (ev.end !== ev.start ? \" → \" + ev.end : \"\")));",
  "    sub.appendChild(el(\"span\", \"badge \" + statusCls(ev.status), statusLabel(ev.status)));",
  "    sub.appendChild(el(\"span\", \"badge \" + confCls(ev.confidence), confLabel(ev.confidence)));",
  "    sub.appendChild(el(\"span\", null, ev.checkpoints.length + \" 个检查点 · \" + kindLabel(ev.kind)));",
  "    if (ev.kind === \"demo\") sub.appendChild(el(\"span\", \"demo-tag\", \"合成数据\"));",
  "    head.appendChild(sub);",
  "    if (ev.summary) head.appendChild(el(\"div\", \"sum\", ev.summary));",
  "    box.appendChild(head);",
  "",
  "    var pc = el(\"div\", \"percept\");",
  "    var pdefs = [[\"userPercept\", \"userPercept · 用户感知\"], [\"agentTrace\", \"agentTrace · Agent 轨迹\"], [\"sharedGround\", \"sharedGround · 共识\"], [\"commitments\", \"commitments · 约定\"]];",
  "    for (var pi = 0; pi < pdefs.length; pi++) {",
  "      var pbox = el(\"div\", \"pc\");",
  "      pbox.appendChild(el(\"b\", null, pdefs[pi][1]));",
  "      var arr2 = ev[pdefs[pi][0]];",
  "      pbox.appendChild(el(\"span\", null, (arr2 && arr2.length) ? arr2.length + \" 条\" : \"本期未填\"));",
  "      pc.appendChild(pbox);",
  "    }",
  "    box.appendChild(pc);",
  "",
  "    var gaps = gapsOf(ev);",
  "    var tools = el(\"div\", \"dtools\");",
  "    var bAll = el(\"button\", \"dbtn\", \"全部展开\");",
  "    bAll.type = \"button\";",
  "    bAll.addEventListener(\"click\", function () {",
  "      for (var i = 0; i < ev.checkpoints.length; i++) cpOpen[ev.checkpoints[i].id] = true;",
  "      renderDetail(ev);",
  "    });",
  "    var bNone = el(\"button\", \"dbtn\", \"全部折叠\");",
  "    bNone.type = \"button\";",
  "    bNone.addEventListener(\"click\", function () {",
  "      for (var i = 0; i < ev.checkpoints.length; i++) cpOpen[ev.checkpoints[i].id] = false;",
  "      renderDetail(ev);",
  "    });",
  "    tools.appendChild(bAll);",
  "    tools.appendChild(bNone);",
  "    var ds = el(\"div\", \"dstats\");",
  "    ds.appendChild(document.createTextNode(\"空档 >2h \"));",
  "    ds.appendChild(el(\"b\", null, String(gaps.length)));",
  "    if (gaps.length) {",
  "      var maxG = 0;",
  "      for (var gi = 0; gi < gaps.length; gi++) if (gaps[gi].hours > maxG) maxG = gaps[gi].hours;",
  "      ds.appendChild(document.createTextNode(\" · 最长 \"));",
  "      ds.appendChild(el(\"b\", null, fmtHours(maxG) + \"h\"));",
  "    }",
  "    tools.appendChild(ds);",
  "    box.appendChild(tools);",
  "",
  "    var tl = el(\"div\", \"dtl\");",
  "    for (var i = 0; i < ev.checkpoints.length; i++) {",
  "      var cp = ev.checkpoints[i];",
  "      if (i > 0) {",
  "        var g = ev.checkpoints[i].ms - ev.checkpoints[i - 1].ms;",
  "        if (g > GAP_MS) {",
  "          var gm = el(\"div\", \"gap\" + (ev.kind === \"demo\" ? \" demo\" : \"\"));",
  "          gm.setAttribute(\"data-hours\", fmtHours(g / 3600000));",
  "          var gt = el(\"span\", \"gtext\");",
  "          gt.appendChild(document.createTextNode(\"⏸ 搁置 \" + fmtHours(g / 3600000) + \" 小时 —— \"));",
  "          gt.appendChild(el(\"b\", null, ev.checkpoints[i - 1].at + \" → \" + cp.at));",
  "          gm.appendChild(gt);",
  "          gm.appendChild(el(\"span\", \"gline\"));",
  "          tl.appendChild(gm);",
  "        }",
  "      }",
  "      tl.appendChild(cpRow(ev, cp, i, i === ev.checkpoints.length - 1));",
  "    }",
  "    box.appendChild(tl);",
  "",
  "    if (ev.kind === \"demo\") {",
  "      var foot0 = el(\"div\", \"foot\");",
  "      foot0.appendChild(el(\"div\", null, \"合成 fixture：本事件来自 fixtures/concurrent-demo.json，与真实账本无对应关系，仅用于演示「多个事件同时 active」。\"));",
  "      box.appendChild(foot0);",
  "      return;",
  "    }",
  "",
  "    var srcs = el(\"div\", \"srcs\");",
  "    srcs.appendChild(el(\"h4\", null, \"本事件来源 · \" + ev.members.length + \" 篇原始账本\"));",
  "    var lim = Math.min(ev.members.length, 8);",
  "    for (var mi = 0; mi < lim; mi++) {",
  "      var cp2 = ev.checkpoints[mi];",
  "      var row = el(\"div\", \"row\");",
  "      row.appendChild(el(\"span\", \"n\", \"#\" + (mi + 1)));",
  "      row.appendChild(el(\"span\", \"p\", cp2.rel));",
  "      row.appendChild(el(\"span\", \"t\", cp2.at));",
  "      srcs.appendChild(row);",
  "    }",
  "    if (ev.members.length > lim) srcs.appendChild(el(\"div\", \"more\", \"… 还有 \" + (ev.members.length - lim) + \" 篇（events.json → members[]）\"));",
  "    box.appendChild(srcs);",
  "",
  "    var foot = el(\"div\", \"foot\");",
  "    foot.appendChild(el(\"div\", null, \"理由：\" + ev.rationale));",
  "    foot.appendChild(el(\"div\", null, \"可追溯：每个检查点对应一篇原始 .md（sha256 前缀 \" + (ev.checkpoints[0] ? ev.checkpoints[0].sha256.slice(0, 12) : \"\") + \"）\"));",
  "    foot.appendChild(el(\"div\", null, \"四个 percept 字段（userPercept / agentTrace / sharedGround / commitments）本期只建结构，未填充。\"));",
  "    box.appendChild(foot);",
  "  }",
  "",
  "  /* ==========================================================================",
  "     泳道 / 甘特（横轴：左早 → 右新，与竖排列表同向）",
  "     ========================================================================== */",
  "  var MIN_BAR = 10;",
  "  function timeScale(items) {",
  "    var min = Infinity, max = -Infinity;",
  "    for (var i = 0; i < items.length; i++) for (var j = 0; j < items[i].checkpoints.length; j++) {",
  "      var ms = items[i].checkpoints[j].ms;",
  "      if (ms < min) min = ms;",
  "      if (ms > max) max = ms;",
  "    }",
  "    if (!isFinite(min)) { min = 0; max = 1; }",
  "    if (max - min < 6 * 3600000) max = min + 6 * 3600000;",
  "    return { min: min, max: max };",
  "  }",
  "  function pctOf(scale, ms) { return ((ms - scale.min) / (scale.max - scale.min)) * 100; }",
  "  function fmtAxis(ms, span) {",
  "    var d = new Date(ms), p = function (n) { return n < 10 ? \"0\" + n : \"\" + n; };",
  "    if (span > 3 * 86400000) return (d.getMonth() + 1) + \"/\" + d.getDate();",
  "    return (d.getMonth() + 1) + \"/\" + d.getDate() + \" \" + p(d.getHours()) + \":\" + p(d.getMinutes());",
  "  }",
  "  function overlapPairs(items) {",
  "    var sorted = items.slice().sort(function (a, b) { return a.startMs - b.startMs; }), n = 0;",
  "    for (var i = 0; i < sorted.length; i++) for (var j = i + 1; j < sorted.length; j++) {",
  "      if (sorted[j].startMs >= sorted[i].endMs) break;",
  "      n++;",
  "    }",
  "    return n;",
  "  }",
  "  function laneCanvas(items, scale) {",
  "    var wrap = el(\"div\", \"lgrid\");",
  "    var ticks = 4;",
  "    var head = el(\"div\", \"axis-row\");",
  "    head.appendChild(el(\"div\", null, \"\"));",
  "    var tk = el(\"div\", \"axis-ticks\");",
  "    for (var t = 0; t <= ticks; t++) {",
  "      var ms = scale.min + (scale.max - scale.min) * (t / ticks);",
  "      var lab = el(\"div\", \"axis-tick\", fmtAxis(ms, scale.max - scale.min));",
  "      lab.style.left = (100 * t / ticks) + \"%\";",
  "      tk.appendChild(lab);",
  "    }",
  "    tk.appendChild(el(\"div\", \"axis-rule\"));",
  "    head.appendChild(tk);",
  "    wrap.appendChild(head);",
  "    for (var i = 0; i < items.length; i++) {",
  "      var ev = items[i];",
  "      var row = el(\"div\", \"lrow s-\" + (ev.status || \"unknown\"));",
  "      row.setAttribute(\"data-id\", ev.id);",
  "      row.setAttribute(\"role\", \"button\");",
  "      row.setAttribute(\"tabindex\", \"0\");",
  "      row.title = ev.title + \" · \" + ev.start + (ev.end !== ev.start ? \" → \" + ev.end : \"\") + \" · \" + ev.checkpoints.length + \" 检查点\";",
  "      var nm = el(\"div\", \"lname\", ev.title);",
  "      nm.appendChild(el(\"i\", null, ev.checkpoints.length + \" 点\"));",
  "      row.appendChild(nm);",
  "      var track = el(\"div\", \"ltrack\");",
  "      for (var v = 1; v < ticks; v++) {",
  "        var vl = el(\"div\", \"lvline\");",
  "        vl.style.left = (100 * v / ticks) + \"%\";",
  "        track.appendChild(vl);",
  "      }",
  "      var single = ev.checkpoints.length === 1;",
  "      if (single) {",
  "        var dot = el(\"div\", \"lpt-single\");",
  "        dot.style.left = pctOf(scale, ev.checkpoints[0].ms) + \"%\";",
  "        track.appendChild(dot);",
  "      } else {",
  "        var segs = segmentsOf(ev);",
  "        var line = el(\"div\", \"lline\");",
  "        line.style.left = pctOf(scale, segs[0][0].ms) + \"%\";",
  "        line.style.width = Math.max(0.4, pctOf(scale, segs[segs.length - 1][segs[segs.length - 1].length - 1].ms) - pctOf(scale, segs[0][0].ms)) + \"%\";",
  "        track.appendChild(line);",
  "        for (var s = 0; s < segs.length; s++) {",
  "          var a2 = pctOf(scale, segs[s][0].ms), b2 = pctOf(scale, segs[s][segs[s].length - 1].ms);",
  "          var bar = el(\"div\", \"lseg\");",
  "          bar.style.left = a2 + \"%\";",
  "          bar.style.width = Math.max(0, b2 - a2) + \"%\";",
  "          bar.style.minWidth = MIN_BAR + \"px\";",
  "          track.appendChild(bar);",
  "          for (var k = 0; k < segs[s].length; k++) {",
  "            var pt = el(\"div\", \"lpt\");",
  "            pt.style.left = pctOf(scale, segs[s][k].ms) + \"%\";",
  "            track.appendChild(pt);",
  "          }",
  "        }",
  "      }",
  "      var gaps = gapsOf(ev);",
  "      for (var g = 0; g < gaps.length; g++) {",
  "        var brk = el(\"div\", \"lbrk\");",
  "        brk.style.left = pctOf(scale, ev.checkpoints[gaps[g].afterIdx + 1].ms) + \"%\";",
  "        track.appendChild(brk);",
  "      }",
  "      row.appendChild(track);",
  "      row.addEventListener(\"click\", (function (id) { return function () { select(id, { openDetail: true }); }; })(ev.id));",
  "      row.addEventListener(\"keydown\", (function (id) { return function (e) { if (e.key === \"Enter\" || e.key === \" \") { e.preventDefault(); select(id, { openDetail: true }); } }; })(ev.id));",
  "      cardEls[ev.id] = row;",
  "      itemOrder.push(ev.id);",
  "      wrap.appendChild(row);",
  "    }",
  "    return wrap;",
  "  }",
  "",
  "  function renderLanes(mid) {",
  "    if (demoOn) return renderDemo(mid, \"lanes\");",
  "    var box = el(\"div\", \"lanes\");",
  "    var items = EV.filter(function (e) { return e.kind === \"ledger\"; });",
  "    var scale = timeScale(items);",
  "    var bar = el(\"div\", \"lanes-bar\");",
  "    bar.appendChild(el(\"b\", null, \"泳道 / 甘特 · \" + items.length + \" 个事件\"));",
  "    bar.appendChild(el(\"span\", \"sl\", \"时间横向流动（左 = 早，右 = 新）· 每行一个事件 · 点行 → 右侧时间轴\"));",
  "    bar.appendChild(el(\"span\", null, \"真实数据里事件区间重叠 \" + overlapPairs(items) + \" 对\"));",
  "    box.appendChild(bar);",
  "    box.appendChild(laneCanvas(items, scale));",
  "    var hint = el(\"div\", \"lanes-hint\");",
  "    hint.textContent = \"每段横条 = 一次连续推进；横条断口 = 事件内部 > 2 小时的搁置（段与段之间留白，不掩盖断点）。历史数据里事件与事件不重叠，是旧流水账格式的产物；换成合成 fixture 可看到真正并发的样子。\";",
  "    box.appendChild(hint);",
  "    mid.appendChild(box);",
  "  }",
  "",
  "  function renderWorkflow(mid) {",
  "    if (demoOn) return renderDemo(mid, \"workflow\");",
  "    var box = el(\"div\", \"wf\");",
  "    var note = el(\"div\", \"wf-note\");",
  "    note.textContent = \"按 title 里出现的 Pn / Rn / Gn / E线 / F线 标号分组（title 无标号时退回 summary）。这是历史数据上「补偿并发表达缺失」的辅助视图——旧账本一次交接只写一篇，线只能靠文字标号找回。主线默认折叠。\";",
  "    box.appendChild(note);",
  "    var groups = {}, order = [];",
  "    var ledgers = EV.filter(function (e) { return e.kind === \"ledger\"; });",
  "    for (var i = 0; i < ledgers.length; i++) {",
  "      var ks = laneKeys(ledgers[i]);",
  "      for (var ki = 0; ki < ks.length; ki++) {",
  "        if (!groups[ks[ki]]) { groups[ks[ki]] = []; order.push(ks[ki]); }",
  "        groups[ks[ki]].push(ledgers[i]);",
  "      }",
  "    }",
  "    order.sort(function (a, b) {",
  "      if (a === \"(主线)\") return 1;",
  "      if (b === \"(主线)\") return -1;",
  "      return laneNum(a) - laneNum(b) || (a < b ? -1 : 1);",
  "    });",
  "    for (var oi = 0; oi < order.length; oi++) {",
  "      var key = order[oi];",
  "      /* 倒叙一致：组内按时间升序（上早下新），与时间流同向 */",
  "      var list = groups[key].slice().sort(function (a, b) { return a.startMs - b.startMs; });",
  "      var g = el(\"div\", \"wfg\" + (key === \"(主线)\" ? \" closed\" : \"\"));",
  "      var h = el(\"button\", \"wfh\");",
  "      h.type = \"button\";",
  "      h.appendChild(el(\"span\", \"caret\", \"▼\"));",
  "      h.appendChild(el(\"span\", \"lane\", key));",
  "      var meta = el(\"div\", \"meta\");",
  "      var breaks = 0;",
  "      for (var bi2 = 1; bi2 < list.length; bi2++) if (list[bi2].startMs - list[bi2 - 1].endMs > GAP_MS) breaks++;",
  "      var spanDays = (list[list.length - 1].endMs - list[0].startMs) / 86400000;",
  "      meta.appendChild(el(\"span\", null, list.length + \" 个事件\"));",
  "      meta.appendChild(el(\"span\", null, \"跨 \" + (spanDays < 1 ? \"<1\" : spanDays.toFixed(1)) + \" 天\"));",
  "      meta.appendChild(el(\"span\", null, \"断点 \" + breaks));",
  "      h.appendChild(meta);",
  "      h.addEventListener(\"click\", function () { this.parentNode.classList.toggle(\"closed\"); });",
  "      g.appendChild(h);",
  "      var body = el(\"div\", \"wfbody\");",
  "      for (var li = 0; li < list.length; li++) {",
  "        var ev = list[li];",
  "        var r = el(\"div\", \"wfrow\");",
  "        r.setAttribute(\"data-id\", ev.id);",
  "        r.setAttribute(\"role\", \"button\");",
  "        r.setAttribute(\"tabindex\", \"0\");",
  "        r.appendChild(el(\"div\", \"t\", ev.title));",
  "        r.appendChild(el(\"div\", \"m\", ev.start.slice(5, 16) + \" · \" + ev.checkpoints.length + \" 点\"));",
  "        r.addEventListener(\"click\", (function (id) { return function () { select(id, { openDetail: true }); }; })(ev.id));",
  "        r.addEventListener(\"keydown\", (function (id) { return function (e) { if (e.key === \"Enter\" || e.key === \" \") { e.preventDefault(); select(id, { openDetail: true }); } }; })(ev.id));",
  "        cardEls[ev.id] = r;",
  "        itemOrder.push(ev.id);",
  "        body.appendChild(r);",
  "      }",
  "      g.appendChild(body);",
  "      box.appendChild(g);",
  "    }",
  "    mid.appendChild(box);",
  "  }",
  "",
  "  function renderDemo(mid, mode) {",
  "    var box = el(\"div\", \"demo\");",
  "    var banner = el(\"div\", \"demo-banner\");",
  "    var h = el(\"h3\");",
  "    h.appendChild(el(\"span\", \"demo-tag\", \"合成数据\"));",
  "    h.appendChild(el(\"span\", null, \"并发演示 · \" + DEMO.length + \" 个虚构事件（与真实事件严格分区）\"));",
  "    banner.appendChild(h);",
  "    var p = el(\"p\");",
  "    p.textContent = \"来自 fixtures/concurrent-demo.json 的合成 fixture，不是真实账本：真实事件列表里一条都没有它（demo id 全部以 demo- 开头，由 verify.mjs 的负路径断言守着）。它存在的唯一目的——证明「多个事件同时 active」是事件模型的真实能力，而旧流水账格式物理上无法记录并行。\";",
  "    banner.appendChild(p);",
  "    var st = el(\"div\", \"demo-stat\");",
  "    function stat(label, val) {",
  "      var s = el(\"span\");",
  "      s.appendChild(document.createTextNode(label + \" \"));",
  "      s.appendChild(el(\"b\", null, String(val)));",
  "      st.appendChild(s);",
  "    }",
  "    stat(\"事件\", DEMO.length);",
  "    stat(\"区间重叠\", overlapPairs(DEMO) + \" 对\");",
  "    var all = [];",
  "    for (var i = 0; i < DEMO.length; i++) for (var j = 0; j < DEMO[i].checkpoints.length; j++) all.push({ ms: DEMO[i].checkpoints[j].ms, ev: i });",
  "    all.sort(function (a, b) { return a.ms - b.ms; });",
  "    stat(\"检查点\", all.length);",
  "    var maxConc = 0;",
  "    for (var q = 0; q < all.length; q++) {",
  "      var t = all[q].ms, c = 0;",
  "      for (var e2 = 0; e2 < DEMO.length; e2++) if (DEMO[e2].startMs <= t && t <= DEMO[e2].endMs) c++;",
  "      if (c > maxConc) maxConc = c;",
  "    }",
  "    stat(\"同时 active 峰值\", maxConc + \" 条\");",
  "    banner.appendChild(st);",
  "    box.appendChild(banner);",
  "    if (mode === \"workflow\" || mode === \"lanes\") {",
  "      var scale = timeScale(DEMO);",
  "      box.appendChild(laneCanvas(DEMO, scale));",
  "      var hint = el(\"div\", \"lanes-hint\");",
  "      hint.textContent = \"四条线在 10:00–17:20 之间交错推进：同一分钟内可以有多条线各自推进，这正是新事件中心模型相对旧账本的差别。\";",
  "      box.appendChild(hint);",
  "    } else {",
  "      var cards = el(\"div\", null);",
  "      cards.id = \"cards\";",
  "      for (var c2 = 0; c2 < DEMO.length; c2++) { cards.appendChild(renderCard(DEMO[c2], -1)); itemOrder.push(DEMO[c2].id); }",
  "      box.appendChild(cards);",
  "    }",
  "    mid.appendChild(box);",
  "  }",
  "",
  "",
  "  /* ==========================================================================",
  "     右栏抽屉：弹簧 damping 0.8 / response 0.3（apple-design 抽屉参数），可中断",
  "     —— 窄屏不用弹簧，改成 sheet 的 translateY 过渡（样式层驱动）",
  "     ========================================================================== */",
  "  var NARROW = false;",
  "  function isNarrow() { return window.matchMedia(\"(max-width: 1023px)\").matches; }",
  "  function reducedNow() { try { return window.matchMedia(\"(prefers-reduced-motion: reduce)\").matches; } catch (e) { return false; } }",
  "",
  "  var spring = { x: detailOpen ? 0 : 1, v: 0, target: detailOpen ? 0 : 1, raf: 0, last: 0 };",
  "",
  "  function cssNum(name, fb) {",
  "    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();",
  "    var n = parseFloat(v);",
  "    return isFinite(n) ? n : fb;",
  "  }",
  "  function applyDrawer(x) {",
  "    var layout = document.querySelector(\".layout\");",
  "    if (!layout) return;",
  "    if (isNarrow()) {",
  "      layout.style.gridTemplateColumns = \"\";",
  "      layout.classList.toggle(\"detail-off\", x >= 0.9995);",
  "      return;",
  "    }",
  "    var railW = cssNum(\"--rail-w\", 336);",
  "    var midW = cssNum(\"--mid-w\", 392);",
  "    var avail = Math.max(0, layout.clientWidth - railW);",
  "    var detailOpenW = Math.max(0, avail - midW);",
  "    var detailW = detailOpenW * (1 - x);",
  "    layout.style.gridTemplateColumns = Math.round(railW) + \"px \" + Math.round(avail - detailW) + \"px \" + Math.round(detailW) + \"px\";",
  "    layout.classList.toggle(\"detail-off\", x >= 0.9995);",
  "  }",
  "  function springStep(ts) {",
  "    if (!spring.last) spring.last = ts;",
  "    var dt = Math.min(0.064, Math.max(0.001, (ts - spring.last) / 1000));",
  "    spring.last = ts;",
  "    var k = Math.pow(2 * Math.PI / 0.3, 2);",
  "    var c = 4 * Math.PI * 0.8 / 0.3;",
  "    var a = -k * (spring.x - spring.target) - c * spring.v;",
  "    spring.v += a * dt;",
  "    spring.x += spring.v * dt;",
  "    if (Math.abs(spring.x - spring.target) < 0.001 && Math.abs(spring.v) < 0.02) {",
  "      spring.x = spring.target; spring.v = 0; spring.last = 0; spring.raf = 0;",
  "      applyDrawer(spring.x);",
  "      updateDetailToggle();",
  "      return;",
  "    }",
  "    applyDrawer(spring.x);",
  "    spring.raf = requestAnimationFrame(springStep);",
  "  }",
  "  function setDetailOpen(open) {",
  "    detailOpen = open;",
  "    lsSet(LS_DETAIL, open ? \"true\" : \"false\");",
  "    updateDetailToggle();",
  "    if (isNarrow()) { document.body.classList.toggle(\"detail-sheet\", open); applyDrawer(open ? 0 : 1); return; }",
  "    if (reducedNow()) {",
  "      spring.x = open ? 0 : 1; spring.v = 0; spring.last = 0; spring.target = spring.x;",
  "      if (spring.raf) { cancelAnimationFrame(spring.raf); spring.raf = 0; }",
  "      applyDrawer(spring.x);",
  "      return;",
  "    }",
  "    spring.target = open ? 0 : 1;",
  "    if (!spring.raf) { spring.last = 0; spring.raf = requestAnimationFrame(springStep); }",
  "  }",
  "  function updateDetailToggle() {",
  "    var b = document.getElementById(\"dtoggle\");",
  "    if (!b) return;",
  "    b.textContent = detailOpen ? \"收起右栏 ▸\" : \"展开右栏 ◂\";",
  "    b.setAttribute(\"aria-expanded\", detailOpen ? \"true\" : \"false\");",
  "  }",
  "",
  "  /* ==========================================================================",
  "     主题：auto / light / dark 三态",
  "     · dataset.theme 永远是「实际生效」的 light|dark（断言用）",
  "     · dataset.themeMode 保存三态原值",
  "     · 首屏由 <head> 内联脚本提前落位，切换不闪白",
  "     ========================================================================== */",
  "  var THEMES = [\"auto\", \"light\", \"dark\"];",
  "  function mqlDark() { try { return window.matchMedia(\"(prefers-color-scheme: dark)\").matches; } catch (e) { return false; } }",
  "  function themeMode() {",
  "    var m = lsGet(LS_THEME);",
  "    return THEMES.indexOf(m) >= 0 ? m : \"auto\";",
  "  }",
  "  function resolvedTheme(mode) { return mode === \"dark\" ? \"dark\" : mode === \"light\" ? \"light\" : (mqlDark() ? \"dark\" : \"light\"); }",
  "  function applyTheme(mode) {",
  "    var r = resolvedTheme(mode);",
  "    document.documentElement.dataset.theme = r;",
  "    document.documentElement.dataset.themeMode = mode;",
  "    lsSet(LS_THEME, mode);",
  "    var b = document.getElementById(\"themebtn\");",
  "    if (b) {",
  "      var ic = b.querySelector(\".tico\"), tx = b.querySelector(\".ttxt\");",
  "      if (ic) ic.textContent = mode === \"auto\" ? \"◐\" : mode === \"dark\" ? \"☾\" : \"☀\";",
  "      if (tx) tx.textContent = mode === \"auto\" ? \"跟随系统\" : mode === \"dark\" ? \"暗色\" : \"浅色\";",
  "      b.setAttribute(\"data-mode\", mode);",
  "      b.title = \"主题：\" + (mode === \"auto\" ? \"跟随系统\" : mode === \"dark\" ? \"暗色\" : \"浅色\") + \"（点击循环 auto → light → dark）\";",
  "      b.setAttribute(\"aria-label\", b.title);",
  "    }",
  "    var meta = document.getElementById(\"meta-theme\");",
  "    if (meta) meta.setAttribute(\"content\", r === \"dark\" ? \"#0a0d14\" : \"#f4f6f9\");",
  "  }",
  "  function cycleTheme() {",
  "    var m = themeMode();",
  "    applyTheme(THEMES[(THEMES.indexOf(m) + 1) % THEMES.length]);",
  "  }",
  "",
  "  /* 字号三档：只改 html 根字号（rem 全站联动） */",
  "  var FSS = [\"0\", \"1\", \"2\"];",
  "  function fsIndex() {",
  "    var v = lsGet(LS_FS);",
  "    return FSS.indexOf(v) >= 0 ? v : \"1\";",
  "  }",
  "  function applyFontScale(idx) {",
  "    document.documentElement.dataset.fs = idx;",
  "    lsSet(LS_FS, idx);",
  "    var btns = document.querySelectorAll(\".fsctl button\");",
  "    for (var i = 0; i < btns.length; i++) {",
  "      var on = btns[i].getAttribute(\"data-fs\") === idx;",
  "      btns[i].classList.toggle(\"on\", on);",
  "      btns[i].setAttribute(\"aria-pressed\", on ? \"true\" : \"false\");",
  "    }",
  "    measurePill();",
  "  }",
  "",
  "  /* ==========================================================================",
  "     视图切换（药丸滑动 = tabs-sliding）",
  "     ========================================================================== */",
  "  function measurePill() {",
  "    var sw = document.querySelector(\".vswitch\");",
  "    if (!sw) return;",
  "    var pill = sw.querySelector(\".pill\");",
  "    var on = sw.querySelector(\"button.on\");",
  "    if (!pill || !on) return;",
  "    pill.style.transition = \"none\";",
  "    pill.style.transform = \"translateX(\" + on.offsetLeft + \"px)\";",
  "    pill.style.width = on.offsetWidth + \"px\";",
  "    void pill.offsetWidth;",
  "    pill.style.transition = \"\";",
  "  }",
  "  function syncViewChrome() {",
  "    var btns = document.querySelectorAll(\".vswitch button\");",
  "    for (var i = 0; i < btns.length; i++) {",
  "      var on = btns[i].getAttribute(\"data-view\") === viewMode;",
  "      btns[i].classList.toggle(\"on\", on);",
  "      btns[i].setAttribute(\"aria-selected\", on ? \"true\" : \"false\");",
  "      btns[i].tabIndex = on ? 0 : -1;",
  "    }",
  "    document.body.setAttribute(\"data-view\", viewMode);",
  "    measurePill();",
  "  }",
  "  function setView(mode) {",
  "    viewMode = mode;",
  "    lsSet(LS_VIEW, mode);",
  "    /* 泳道 / 工作流需要横向画布：切过去时自动收起右栏（用户仍可手动展开） */",
  "    if ((mode === \"lanes\" || mode === \"workflow\") && detailOpen) setDetailOpen(false);",
  "    syncViewChrome();",
  "    filterMode = false;",
  "    var q = qEl ? qEl.value.trim() : \"\";",
  "    if (qEl && q) qEl.value = \"\";",
  "    var mid = clearMid();",
  "    var midCol = document.querySelector(\".mid\");",
  "    if (midCol) midCol.scrollTop = 0;",
  "    if (mode === \"lanes\") renderLanes(mid);",
  "    else if (mode === \"workflow\") renderWorkflow(mid);",
  "    else { renderStream(mid); if (lazyOn && !demoOn) anchorToNewest(); }",
  "    applyDrawer(spring.x);",
  "    applyFilterVisibility();",
  "    updateCounts();",
  "    reapplyRailState();",
  "  }",
  "  function clearMid() {",
  "    var mid = document.getElementById(\"mid-body\");",
  "    if (mid) mid.innerHTML = \"\";",
  "    cardEls = {}; itemOrder = [];",
  "    return mid;",
  "  }",
  "",
  "  /* ==========================================================================",
  "     选中 / 深链 / 键盘",
  "     ========================================================================== */",
  "  function ensureLoaded(i) {",
  "    if (demoOn || !lazyOn || filterMode) return;",
  "    if (i >= loadedStart) return;",
  "    loadedStart = Math.max(0, i - 4);",
  "    /* 只有时间流视图才需要重建卡片列表；lanes / workflow 不依赖卡片窗口 */",
  "    if (viewMode === \"stream\") rebuildStream(true);",
  "  }",
  "  function select(id, opts) {",
  "    var ev = byIdAll[id];",
  "    if (!ev) return;",
  "    if (ev.kind === \"demo\" && !demoOn) return;",
  "    var isDemoId = ev.kind === \"demo\";",
  "    if (!isDemoId && realIdx[id] != null) ensureLoaded(realIdx[id]);",
  "    if (curId === id) { if (opts && opts.scroll) scrollToCard(id); if (opts && opts.openDetail && !detailOpen) setDetailOpen(true); return; }",
  "    var oldTick = document.querySelector(\".tick.on\");",
  "    if (oldTick) oldTick.classList.remove(\"on\");",
  "    for (var k in cardEls) if (cardEls[k].classList) cardEls[k].classList.remove(\"on\");",
  "    curId = id;",
  "    if (cardEls[id]) cardEls[id].classList.add(\"on\");",
  "    if (tickEls[id]) tickEls[id].classList.add(\"on\");",
  "    if (opts && opts.scroll) { scrollToCard(id); railEnsureVisible(id); }",
  "    renderDetail(ev);",
  "    if (opts && opts.openDetail && !detailOpen) setDetailOpen(true);",
  "    try { history.replaceState(null, \"\", \"#\" + id); } catch (e) {}",
  "    updateNavBtns(ev);",
  "  }",
  "  function scrollToCard(id) {",
  "    var c = cardEls[id];",
  "    if (!c) return;",
  "    var mid = document.querySelector(\".mid\");",
  "    if (mid && c.scrollIntoView) {",
  "      try { c.scrollIntoView({ block: \"center\", behavior: reducedNow() ? \"auto\" : \"smooth\" }); } catch (e) { c.scrollIntoView(); }",
  "    }",
  "  }",
  "  function updateNavBtns(ev) {",
  "    var wrap = document.getElementById(\"dnav\");",
  "    if (!wrap) return;",
  "    wrap.innerHTML = \"\";",
  "    if (ev.kind === \"demo\") { wrap.style.display = \"none\"; return; }",
  "    wrap.style.display = \"\";",
  "    var i = realIdx[ev.id];",
  "    var prev = i > 0 ? EV[i - 1] : null;      /* 更早 */",
  "    var next = i < N - 1 ? EV[i + 1] : null;  /* 更新 */",
  "    var bE = el(\"button\", \"dbtn\", \"↑ 更早\");",
  "    bE.type = \"button\"; bE.id = \"nav-earlier\";",
  "    if (prev) { bE.title = prev.start + \" · \" + prev.title; bE.addEventListener(\"click\", function () { select(prev.id, { scroll: true, openDetail: true }); }); }",
  "    else bE.disabled = true;",
  "    var bN = el(\"button\", \"dbtn\", \"↓ 更新\");",
  "    bN.type = \"button\"; bN.id = \"nav-newer\";",
  "    if (next) { bN.title = next.start + \" · \" + next.title; bN.addEventListener(\"click\", function () { select(next.id, { scroll: true, openDetail: true }); }); }",
  "    else bN.disabled = true;",
  "    var lab = el(\"span\", \"dnav-lab\", i + 1 + \" / \" + N);",
  "    wrap.appendChild(bE); wrap.appendChild(bN); wrap.appendChild(lab);",
  "  }",
  "",
  "  /* ==========================================================================",
  "     过滤（过滤时临时全量，退出回窗口模式）",
  "     ========================================================================== */",
  "  var qEl = document.getElementById(\"q\");",
  "  function hayOf(ev) {",
  "    return (ev.title + \" \" + ev.date + \" \" + ev.start + \" \" + kindLabel(ev.kind) + \" \" + (ev.lane || \"\")).toLowerCase();",
  "  }",
  "  function applyFilterVisibility() {",
  "    var q = qEl ? qEl.value.trim().toLowerCase() : \"\";",
  "    var shown = 0, total = 0;",
  "    for (var id in cardEls) {",
  "      total++;",
  "      var ev = byIdAll[id];",
  "      if (!ev) continue;",
  "      var hit = !q || hayOf(ev).indexOf(q) >= 0;",
  "      cardEls[id].style.display = hit ? \"\" : \"none\";",
  "      if (hit) shown++;",
  "    }",
  "    for (var id2 in tickEls) {",
  "      var ev2 = byIdAll[id2];",
  "      if (!ev2) continue;",
  "      var hit2 = !q || hayOf(ev2).indexOf(q) >= 0;",
  "      tickEls[id2].style.display = hit2 ? \"\" : \"none\";",
  "    }",
  "    var cnt = document.getElementById(\"cnt\");",
  "    if (cnt) cnt.textContent = q ? shown + \" / \" + total : \"\";",
  "    var bar = document.getElementById(\"loadmore\");",
  "    if (bar) bar.style.display = (q && lazyOn) ? \"none\" : \"\";",
  "  }",
  "  function onQuery() {",
  "    var q = qEl.value.trim();",
  "    if (q && !filterMode && lazyOn && !demoOn) {",
  "      filterMode = true;",
  "      rebuildStream(true);",
  "    } else if (!q && filterMode) {",
  "      filterMode = false;",
  "      loadedStart = lazyOn ? Math.max(0, N - INIT_WINDOW) : 0;",
  "      rebuildStream(true);",
  "    }",
  "    applyFilterVisibility();",
  "  }",
  "  function updateCounts() {",
  "    var chip = document.getElementById(\"chip-view\");",
  "    if (chip) chip.textContent = viewMode === \"lanes\" ? \"泳道 / 甘特\" : viewMode === \"workflow\" ? \"工作流线索\" : \"时间流\";",
  "  }",
  "",
  "  /* ==========================================================================",
  "     scroll-spy + 懒加载触发 + 状态回填",
  "     ========================================================================== */",
  "  var spyTick = 0;",
  "  function reapplyRailState() {",
  "    if (curId && tickEls[curId]) tickEls[curId].classList.add(\"on\");",
  "  }",
  "  function onMidScroll() {",
  "    var mid = document.querySelector(\".mid\");",
  "    if (!mid) return;",
  "    userScrolled = true;",
  "    /* 懒加载：接近顶部就加载更早 */",
  "    if (lazyOn && !demoOn && !filterMode && !loading && loadedStart > 0 && mid.scrollTop < 260) {",
  "      loadEarlier();",
  "    }",
  "    /* scroll-spy：当前视口里的卡片 → 对应 rail tick 高亮 */",
  "    if (viewMode !== \"stream\") return;",
  "    var now = Date.now();",
  "    if (now - spyTick < 90) return;",
  "    spyTick = now;",
  "    var vpTop = mid.getBoundingClientRect().top + 4;",
  "    var best = null, bestD = Infinity;",
  "    for (var i = loadedStart; i < N; i++) {",
  "      var ev = EV[i];",
  "      var c = cardEls[ev.id];",
  "      if (!c) continue;",
  "      var r = c.getBoundingClientRect();",
  "      if (r.bottom > vpTop && r.top < mid.getBoundingClientRect().bottom) {",
  "        var d = Math.abs(r.top - vpTop);",
  "        if (d < bestD) { bestD = d; best = ev.id; }",
  "        if (c.classList) c.classList.add(\"in-viewed\");",
  "      }",
  "    }",
  "    for (var k in tickEls) tickEls[k].classList.remove(\"in-view\");",
  "    if (best && tickEls[best]) tickEls[best].classList.add(\"in-view\");",
  "  }",
  "",
  "  /* ==========================================================================",
  "     合成 demo 开关",
  "     ========================================================================== */",
  "  function setDemo(on) {",
  "    demoOn = on;",
  "    var sw = document.getElementById(\"demoSwitch\");",
  "    if (sw) { sw.checked = on; sw.parentNode.classList.toggle(\"on\", on); }",
  "    var banner = document.getElementById(\"demo-banner-top\");",
  "    if (banner) banner.style.display = on ? \"\" : \"none\";",
  "    renderRail();",
  "    var mid = clearMid();",
  "    var midCol = document.querySelector(\".mid\");",
  "    if (midCol) midCol.scrollTop = 0;",
  "    if (viewMode === \"lanes\") renderLanes(mid);",
  "    else if (viewMode === \"workflow\") renderWorkflow(mid);",
  "    else { renderStream(mid); if (on) { /* demo 只有 4 个：保持顶部 */ } else anchorToNewest(); }",
  "    curId = null;",
  "    var detail = document.getElementById(\"detail\");",
  "    detail.innerHTML = '<div class=\"empty\">' + (on ? \"合成演示已开启：点左侧或中间任一条线 → 右侧时间轴\" : \"左侧或中间选择事件\") + \"</div>\";",
  "    applyDrawer(spring.x);",
  "    var first = on ? (DEMO[0] && DEMO[0].id) : EV[0].id;",
  "    if (first) select(first, { scroll: false });",
  "    applyFilterVisibility();",
  "    updateCounts();",
  "  }",
  "",
  "  /* ==========================================================================",
  "     启动",
  "     ========================================================================== */",
  "  function boot() {",
  "    NARROW = isNarrow();",
  "    /* 主题与字号先落位（<head> 已做过一次；这里同步控件态） */",
  "    applyTheme(themeMode());",
  "    applyFontScale(fsIndex());",
  "",
  "    renderRail();",
  "    var mid0 = clearMid();",
  "    if (viewMode === \"lanes\") renderLanes(mid0);",
  "    else if (viewMode === \"workflow\") renderWorkflow(mid0);",
  "    else renderStream(mid0);",
  "    applyDrawer(spring.x);",
  "    updateDetailToggle();",
  "    updateCounts();",
  "    syncViewChrome();",
  "",
  "    /* 深链：先确保在窗口内，再选中 */",
  "    var start = (location.hash || \"\").replace(\"#\", \"\");",
  "    var hasDeepLink = !!byIdAll[start] && byIdAll[start].kind !== \"demo\";",
  "    var firstId = hasDeepLink ? start : EV[N - 1].id;   /* 默认落在「最新」 */",
  "    if (hasDeepLink && realIdx[start] != null) ensureLoaded(realIdx[start]);",
  "    select(firstId, { scroll: false });",
  "",
  "    /* —— 初始锚点：底部 = 最新（中栏与左轨同向） —— */",
  "    if (viewMode === \"stream\" && !demoOn) { anchorToNewest(); scrollRailToNewest(); }",
  "    else if (viewMode === \"lanes\") midScrollToEndMaybe();",
  "",
  "    if (hasDeepLink) {",
  "      setTimeout(function () {",
  "        var sc = cardEls[start];",
  "        if (sc) { try { sc.scrollIntoView({ block: \"center\" }); } catch (e) {} }",
  "      }, 60);",
  "    }",
  "  }",
  "  /* 泳道视图也可「最新在右」：初始把横向画布滚到最右（新端），语义与时间流一致 */",
  "  function midScrollToEndMaybe() {",
  "    var mid = document.querySelector(\".mid\");",
  "    if (mid && mid.scrollWidth > mid.clientWidth + 4) mid.scrollLeft = mid.scrollWidth;",
  "  }",
  "",
  "  var vbtns = document.querySelectorAll(\".vswitch button\");",
  "  for (var vi = 0; vi < vbtns.length; vi++) {",
  "    vbtns[vi].addEventListener(\"click\", (function (m) { return function () { setView(m); }; })(vbtns[vi].getAttribute(\"data-view\")));",
  "    vbtns[vi].addEventListener(\"keydown\", function (e) {",
  "      if (e.key !== \"ArrowLeft\" && e.key !== \"ArrowRight\") return;",
  "      var list = [].slice.call(document.querySelectorAll(\".vswitch button\"));",
  "      var idx = list.indexOf(this);",
  "      var nx = list[(idx + (e.key === \"ArrowRight\" ? 1 : list.length - 1)) % list.length];",
  "      nx.focus(); nx.click(); e.preventDefault();",
  "    });",
  "  }",
  "",
  "  var dsw = document.getElementById(\"demoSwitch\");",
  "  if (dsw) dsw.addEventListener(\"change\", function () { setDemo(this.checked); });",
  "  var dtg = document.getElementById(\"dtoggle\");",
  "  if (dtg) dtg.addEventListener(\"click\", function () { setDetailOpen(!detailOpen); });",
  "  var tbt = document.getElementById(\"themebtn\");",
  "  if (tbt) tbt.addEventListener(\"click\", cycleTheme);",
  "  var fsc = document.getElementById(\"fsctl\");",
  "  if (fsc) for (var fi = 0; fi < fsc.children.length; fi++) {",
  "    (function (b) { b.addEventListener(\"click\", function () { applyFontScale(b.getAttribute(\"data-fs\")); }); })(fsc.children[fi]);",
  "  }",
  "  var scl = document.getElementById(\"scalectl\");",
  "  if (scl) for (var si = 0; si < scl.children.length; si++) {",
  "    (function (b) {",
  "      b.addEventListener(\"click\", function () {",
  "        railScale = b.getAttribute(\"data-scale\");",
  "        lsSet(LS_SCALE, railScale);",
  "        for (var j = 0; j < scl.children.length; j++) scl.children[j].classList.toggle(\"on\", scl.children[j] === b);",
  "        renderRail(); reapplyRailState(); applyFilterVisibility();",
  "      });",
  "    })(scl.children[si]);",
  "  }",
  "  var nb = document.getElementById(\"nav-rail\");",
  "  if (nb) nb.addEventListener(\"click\", function () { document.body.classList.toggle(\"rail-open\"); });",
  "  var scl2 = document.getElementById(\"sheet-close\");",
  "  if (scl2) scl2.addEventListener(\"click\", function () { document.body.classList.remove(\"detail-sheet\"); });",
  "  var nb2 = document.getElementById(\"nav-detail\");",
  "  if (nb2) nb2.addEventListener(\"click\", function () { document.body.classList.toggle(\"detail-sheet\"); });",
  "  var scrim = document.getElementById(\"scrim\");",
  "  if (scrim) scrim.addEventListener(\"click\", function () {",
  "    document.body.classList.remove(\"rail-open\"); document.body.classList.remove(\"detail-sheet\");",
  "  });",
  "",
  "  if (qEl) qEl.addEventListener(\"input\", onQuery);",
  "  var midEl = document.querySelector(\".mid\");",
  "  if (midEl) midEl.addEventListener(\"scroll\", onMidScroll, { passive: true });",
  "",
  "  document.addEventListener(\"keydown\", function (e) {",
  "    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;",
  "    if (e.key === \"Escape\") { document.body.classList.remove(\"rail-open\"); document.body.classList.remove(\"detail-sheet\"); return; }",
  "    if (e.key !== \"ArrowDown\" && e.key !== \"ArrowUp\") return;",
  "    var idx = itemOrder.indexOf(curId);",
  "    if (idx < 0) return;",
  "    /* ↑ = 更早（list 索引 -1）；↓ = 更新（+1）。list 本身是早→新升序。 */",
  "    var nx = itemOrder[idx + (e.key === \"ArrowUp\" ? -1 : 1)];",
  "    if (!nx) return;",
  "    e.preventDefault();",
  "    select(nx, { scroll: true, openDetail: true });",
  "  });",
  "",
  "  window.addEventListener(\"hashchange\", function () {",
  "    var idh = (location.hash || \"\").replace(\"#\", \"\");",
  "    if (!idh || !byIdAll[idh]) return;",
  "    if (byIdAll[idh].kind === \"demo\" && !demoOn) return;",
  "    select(idh, { scroll: true });",
  "  });",
  "  var rzT = 0;",
  "  window.addEventListener(\"resize\", function () {",
  "    clearTimeout(rzT);",
  "    rzT = setTimeout(function () { measurePill(); applyDrawer(spring.x); NARROW = isNarrow(); }, 120);",
  "  });",
  "",
  "  /* 调试/验收钩子（CDP 断言读这个，不靠源码字符串） */",
  "  window.__wb = {",
  "    get loadedStart() { return loadedStart; },",
  "    get total() { return demoOn ? DEMO.length : N; },",
  "    get loaded() { return demoOn ? DEMO.length : N - loadedStart; },",
  "    get loadCount() { return loadCount; },",
  "    get lazyOn() { return lazyOn; },",
  "    get filterMode() { return filterMode; },",
  "    get viewMode() { return viewMode; },",
  "    get curId() { return curId; },",
  "    get themeMode() { return themeMode(); },",
  "    get theme() { return document.documentElement.dataset.theme; },",
  "    get fontScale() { return document.documentElement.dataset.fs; },",
  "    get railScale() { return railScale; },",
  "    loadEarlier: function () { loadEarlier(); },",
  "    setLazy: function (on) { lazyOn = !!on; loadedStart = lazyOn ? Math.max(0, N - INIT_WINDOW) : 0; rebuildStream(false); },",
  "    anchor: anchorToNewest,",
  "    select: function (id) { select(id, { scroll: true, openDetail: true }); }",
  "  };",
  "  var loadCount = 0;",
  "  var _origLoad = loadEarlier;",
  "  loadEarlier = function () {",
  "    if (loading || demoOn || !lazyOn || filterMode || loadedStart <= 0) return;",
  "    loadCount++;",
  "    return _origLoad.apply(null, arguments);",
  "  };",
  "",
  "  if (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", boot);",
  "  else boot();",
  "})();",
  "",
].join('\n');


function chip(k, v, id) {
  return '<span class="chip"' + (id ? ' id="' + id + '"' : '') + '>' + k + ' <b>' + v + '</b></span>';
}

/* 首屏主题/字号：内联在 <head>，先于 CSS 生效，避免暗色闪白（FOUC） */
const BOOT = [
  '(function(){try{',
  'var R=document.documentElement;',
  'var m=localStorage.getItem("wbEvt.theme");if(m!=="light"&&m!=="dark")m="auto";',
  'var d=m==="dark"||(m==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);',
  'R.dataset.theme=d?"dark":"light";R.dataset.themeMode=m;',
  'var f=localStorage.getItem("wbEvt.fontScale");',
  'R.dataset.fs=(f==="0"||f==="1"||f==="2")?f:"1";',
  '}catch(e){}})();'
].join('');

export function renderHtml(payload) {
  const s = payload.stats;
  const chips = [
    ['文档', s.documents],
    ['事件', s.events],
    ['检查点', s.checkpoints],
    ['最大事件', s.maxCheckpoints + ' 点'],
    ['单检查点', s.singleCheckpointPct + '%']
  ].map(([k, v]) => '<span class="chip">' + k + ' <b>' + v + '</b></span>').join('');

  const legend = [
    '<span class="lg"><i class="dot" style="background:var(--done)"></i>已完成</span>',
    '<span class="lg"><i class="dot" style="background:var(--active)"></i>进行中</span>',
    '<span class="lg"><i class="dot" style="background:var(--muted)"></i>未判定</span>',
    '<span class="lg rule" title="卡片宽度 = 检查点数：窄 = 单篇 · 中 = 2–3 点 · 宽 = ≥4 点">宽窄 = 检查点数</span>'
  ].join('');

  // JSON 内联：转义 </script 与 <!-- 以免提前闭合
  const jsonText = JSON.stringify(payload)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\u0021--');
  const demoPayload = payload.demo || { events: [] };
  const demoText = JSON.stringify(demoPayload)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\u0021--');

  return [
    '<!doctype html>',
    '<html lang="zh-CN" data-theme="light" data-theme-mode="auto" data-fs="1"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f6f9" id="meta-theme">',
    '<title>白板事件化原型 · 事件视图预览 v4</title>',
    '<script>' + BOOT + '</scr' + 'ipt>',
    '<style>' + CSS + '</style>',
    '</head><body data-view="stream">',
    '<div class="topbar">',
    '  <button type="button" class="navbtn" id="nav-rail" aria-label="打开时间轴">☰ 轴</button>',
    '  <div class="brand"><b>白板 · 事件视图</b><span>wb-event-preview v4 · 倒叙 / 懒加载 / 三档响应 / 明暗主题（event 档预览，非新增页面）</span></div>',
    '  <div class="controls">',
    '    <div class="vswitch" role="tablist" aria-label="视图切换">',
    '      <span class="pill" aria-hidden="true"></span>',
    '      <button type="button" role="tab" data-view="stream" class="on" aria-selected="true">时间流</button>',
    '      <button type="button" role="tab" data-view="lanes" aria-selected="false" tabindex="-1">泳道 / 甘特</button>',
    '      <button type="button" role="tab" data-view="workflow" aria-selected="false" tabindex="-1">工作流线索</button>',
    '    </div>',
    '    <div class="fsctl" id="fsctl" role="group" aria-label="字号档位">',
    '      <button type="button" data-fs="0" class="a0" title="紧凑：根字号 15px" aria-pressed="false">A-</button>',
    '      <button type="button" data-fs="1" class="a1 on" title="标准：根字号 16px" aria-pressed="true">A</button>',
    '      <button type="button" data-fs="2" class="a2" title="宽松：根字号 17.5px" aria-pressed="false">A+</button>',
    '    </div>',
    '    <button type="button" class="themebtn" id="themebtn" data-mode="auto" aria-label="切换主题"><span class="tico">◐</span><span class="ttxt">跟随系统</span></button>',
    '    <div class="chips">' + chips + '</div>',
    '    <label class="demo-switch" id="demoSwitchWrap" title="载入 fixtures/concurrent-demo.json（合成数据，与真实事件严格分区）"><input type="checkbox" id="demoSwitch"><span>并发演示</span></label>',
    '    <button type="button" class="dtoggle" id="dtoggle" aria-expanded="true">收起右栏 ▸</button>',
    '    <button type="button" class="navbtn" id="nav-detail" aria-label="打开详情">详情</button>',
    '  </div>',
    '</div>',
    '<div class="topbar" id="demo-banner-top" style="display:none;height:34px;min-height:34px;background:var(--demo-soft);border-bottom:1px solid var(--demo-line)">',
    '  <span class="demo-tag">合成数据</span>',
    '  <span style="font-size:.75rem;color:var(--demo)">当前显示的是 fixtures/concurrent-demo.json 的并发演示 —— 4 个虚构事件、检查点时间真交错。真实事件列表不含任何 demo id。</span>',
    '</div>',
    '<div class="layout">',
    '  <aside class="col rail" id="rail">',
    '    <div class="rail-top">',
    '      <h3 class="rail-h" id="rail-h">时间轴</h3>',
    '      <div class="scalectl" id="scalectl" role="group" aria-label="时间轴比例">',
    '        <button type="button" data-scale="even" class="on" title="等距：任何间隔的纵向间距相同，最好读">等距</button>',
    '        <button type="button" data-scale="real" title="真实比例：间隔越久留白越大，能看出 40.9h 的洞">真实</button>',
    '      </div>',
    '      <span class="rail-hint" id="rail-hint"></span>',
    '    </div>',
    '    <div class="rail-body"><div class="axis" id="rail-axis"></div></div>',
    '  </aside>',
    '  <main class="col mid" id="mid">',
    '    <div class="mid-top">',
    '      <div class="mid-h"><h2>事件</h2><em><b id="chip-view">时间流</b> · 底部最新 · ↑ 回溯</em><div class="lm-slot" id="lm-slot"></div></div>',
    '      <div class="toolbar"><input id="q" type="search" placeholder="过滤事件标题 / 日期（输入即筛）" autocomplete="off"><span class="cnt" id="cnt"></span></div>',
    '      <div class="legend">' + legend + '</div>',
    '    </div>',
    '    <div id="mid-body"></div>',
    '  </main>',
    '  <section class="col detail" id="detail"><button type="button" class="sheet-close" id="sheet-close" aria-label="关闭详情">✕ 关闭</button><div class="empty">左侧或中间选择事件</div></section>',
    '</div>',
    '<div class="scrim" id="scrim" aria-hidden="true"></div>',
    '<script type="application/json" id="payload">' + jsonText + '</script>',
    '<script type="application/json" id="demo-payload">' + demoText + '</script>',
    '<script>' + SCRIPT + '</scr' + 'ipt>',
    '</body></html>'
  ].join('\n');
}
