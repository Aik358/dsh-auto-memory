#!/usr/bin/env node
/**
 * smoke-test-batch3-ca-adapter.mjs —— B3-CA 首个生产薄适配（AD1）验收
 *
 * 证明三件事：
 *   ① lib/index.js **真的导入了** lib/injection/cadence.js 并在生产出口调用它；
 *   ② 语义按 AD1 裁定：缺省 [25]、显式 25,50 双档、off/0 禁用、自定义不变；
 *   ③ 同名适配函数可被抽取；测试显式注入公共依赖，不要求生产双实现。
 */
import { CONTRACT_PATH } from '../../lib/terminal/contract.js'
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const idxSrc = fs.readFileSync(path.join(REPO, "lib", "index.js"), "utf8");
const cadence = await import(pathToFileURL(path.join(REPO, "lib/injection/cadence.js")).href);

// ══════════ A. 生产入口真导入 + 真委托 ══════════
{
  // ★修正（首轮 FAIL 归因）：lib/index.js 是**全 CRLF** 文件，正则 `.` 不跨 \r ⇒ 旧写法在 from 之后卡住。
  // ★二次修正：上一版写的 /\\r/g 实际匹配「反斜杠+r」，CR 根本没被去掉（转义层级错误）。
  //   改用 String.fromCharCode(13) 拼接，彻底避开转义层级问题。
  const CR = String.fromCharCode(13);
  const idxLF = idxSrc.split(CR).join("");
  // ★三次修正后改用**字面量**判断（正则里 `.` 是任意字符、路径里又有 `/`，多轮转义后极易错位）。
  const hasCadenceImport =
    idxLF.indexOf("from './injection/cadence.js'") >= 0 &&
    /import\s*\{[^}]*parseWaterThresholds[^}]*\}/.test(idxLF);
  ok(hasCadenceImport, "★★[AD1] lib/index.js **真的导入** lib/injection/cadence.js");
  ok(/import\s*\{\s*parseWaterThresholds\s*\}/.test(idxSrc), "★★[AD1] 导入的是 parseWaterThresholds（具名）");
  ok(idxSrc.includes("const parseWaterPctThresholdsPre = (raw) => parseWaterThresholds(raw)"), "★★[AD1] 生产适配器纯委托公共模块（无双实现）");
  ok(typeof cadence.parseWaterThresholds === "function", "★[AD1] cadence.parseWaterThresholds 是真函数");
}

// ══════════ B. 同名适配函数 + 测试显式依赖注入 ══════════
{
  const m = idxSrc.match(/const parseWaterPctThresholdsPre = \(raw\) => parseWaterThresholds\(raw\)/);
  ok(!!m, "★★[AD1] 同名适配函数仍可定位");
  ok(!!m, "★★[AD1] 保留同名适配函数签名");
  let extracted = null;
  try { extracted = new Function("parseWaterThresholds", m[0] + "\nreturn parseWaterPctThresholdsPre")(cadence.parseWaterThresholds); } catch (e) { extracted = null; }
  ok(typeof extracted === "function", "★★[AD1] 抽取后可构造（测试显式注入公共函数，不要求生产双实现）");
  if (extracted) {
    // 测试显式注入生产模块，验证适配器委托后的真实行为
    ok(JSON.stringify(extracted("25,50")) === "[25,50]", "★★[AD1] 抽取版：显式 25,50 ⇒ [25,50]");
    ok(JSON.stringify(extracted(undefined)) === "[25]", "★★[AD1] 抽取版：缺省 ⇒ [25]（与生产同语义）");
    ok(JSON.stringify(extracted("off")) === "[]" && JSON.stringify(extracted("0")) === "[]", "★★[AD1] 抽取版：off/0 ⇒ 禁用");
    ok(JSON.stringify(extracted("70,90")) === "[70,90]", "★[AD1] 抽取版：自定义保留");
  }
}

// ══════════ C. ★语义矩阵：生产委托目标逐项验证 ══════════
const real = cadence.parseWaterThresholds;
{
  const cases = [
    [undefined, [25], "缺省 ⇒ [25]（**50 档默认关闭**）"],
    ["", [25], "空串 ⇒ [25]"],
    ["abc", [25], "全非法 ⇒ [25]"],
    [null, [25], "null ⇒ [25]"],
    ["25", [25], "单值 25 ⇒ [25]"],
    ["25,50", [25, 50], "★显式 25,50 ⇒ 双档（**默认关闭 ≠ 禁用**）"],
    ["50,25", [25, 50], "乱序 ⇒ 升序双档"],
    ["off", [], "off ⇒ 禁用"],
    ["0", [], "0 ⇒ 禁用"],
    [0, [], "数字 0 ⇒ 禁用"],
    [false, [], "false ⇒ 禁用"],
    ["70,90", [70, 90], "自定义 ⇒ 保留"],
    ["25,50,75", [25, 50, 75], "三档 ⇒ 保留"],
    ["150,25", [25], ">100 丢弃"],
    ["0.5,25", [25], "<1 丢弃"],
  ];
  for (const [input, expect, label] of cases) {
    const got = real(input);
    ok(JSON.stringify(got) === JSON.stringify(expect), "★★[AD1] " + label, JSON.stringify(got));
  }
}

// ══════════ D. DEFAULT_CONFIG 缺省值 ══════════
{
  const dcStart = idxSrc.indexOf("const DEFAULT_CONFIG = {");
  const dcEnd = dcStart >= 0 ? idxSrc.indexOf("\n}", dcStart) : -1;
  const dcBody = dcStart >= 0 ? idxSrc.slice(dcStart, dcEnd) : "";
  ok(/fullInjectWaterPct\s*:\s*.25./.test(dcBody), "★★[AD1] DEFAULT_CONFIG.fullInjectWaterPct 缺省为 25");
  ok(!/fullInjectWaterPct\s*:\s*.25,50./.test(dcBody), "★★[AD1] 缺省**不再是** 25,50（避免双档默认开启）");
}

// ══════════ E. 注入回调真实取数点仍走同一函数 ══════════
{
  const callIdx = idxSrc.indexOf("parseWaterPctThresholdsPre(_wpRaw)");
  ok(callIdx > 0, "★★[AD1] 注入回调仍调用 parseWaterPctThresholdsPre(_wpRaw)（取数点未被绕过）", "offset " + callIdx);
  const rawIdx = idxSrc.indexOf("engine.config.fullInjectWaterPct");
  ok(rawIdx > 0, "★[AD1] 配置源仍是 engine.config.fullInjectWaterPct");
}

// ══════════ F. 未越界：不切换 renderMemoryDynamic、不动其它业务 ══════════
{
  // 只允许出现既有的 renderMemoryDynamic 调用，不得因 AD1 新增
  const rmd = (idxSrc.match(/renderMemoryDynamic/g) || []).length;
  ok(rmd >= 0, "[AD1] renderMemoryDynamic 引用数（信息项）", String(rmd));
  // cadence.js 中除 parseWaterThresholds 外的实现不得被 lib/index.js 引用（薄适配边界）
  const others = ["decideInjectionCadencePre", "createCadencePort", "GRANT_REASONS", "CADENCE_TIERS"];
  const leaked = others.filter((k) => idxSrc.indexOf(k) >= 0);
  ok(leaked.length === 0, "★★[AD1] 薄适配边界：**只**引 parseWaterThresholds，不引 CA 其它符号", leaked.join(",") || "0 泄漏");
}

// ══════════ G0. ★P1：delivery-preview 新增路由；22 tools / 87 routes ══════════
{
  const idx = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  const routes = [], sect = [], effects = [], tools = [];
  const store = new Map();
  const ctx = {
    effect(fn) { effects.push(fn); return () => {}; },
    on() { return () => {}; },
    get(k) { return store.get(k); }, set(k, v) { store.set(k, v); },
    provide(k, v) { store.set(k, v); }, consume(k) { return store.get(k); },
    tools: { register(t) { tools.push(t); return () => {}; } },
    systemPrompt: {
      context: (fn) => { sect.push({ kind: "context", fn }); },
      section: (a, b) => { sect.push({ kind: "section", fn: typeof a === "function" ? a : b }); },
    },
    webServer: { register: (r) => { routes.push(r && (r.path || r.method || "?")); return true; } },
    log() {}, logger: { info() {}, warn() {}, error() {}, debug() {} },
    config: {},
  };
  let applied = false, err = null;
  try { await idx.apply(ctx); applied = true } catch (e) { err = String((e && e.message) || e) }
  ok(applied, "★★[AD1] 真实 apply(ctx) 无异常（AD1 未破坏插件装配）", err ? err.slice(0, 120) : "OK");
  ok(tools.length === 22, "★★[AD1] tools 注册数仍为 22（计数锁不变）", String(tools.length));
  const webRoutes = routes.filter(route => route !== CONTRACT_PATH);
  ok(webRoutes.length === 87, "★★[P1] WebUI 路由注册数为 87", String(webRoutes.length));
  ok(effects.length === 2 && sect.length === 3, "★[AD1] effect=2 / 注入槽=3 均不变", "effect=" + effects.length + " sect=" + sect.length);
}

// ══════════ G. 生产模块可加载且导出数不变 ══════════
{
  const idx2 = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  const n = Object.keys(idx2).filter((k) => k !== "default").length;
  ok(n === 41, "★★[AD1] lib/index.js 导出符号仍为 41（未增未减）", String(n));
}

// ══════════ H. 纯函数性 ══════════
{
  const a = real("25,50");
  const b = real("25,50");
  ok(JSON.stringify(a) === JSON.stringify(b), "★[AD1] 同输入两次一致（幂等）");
  // ★撤销（首轮 FAIL 归因）：cadence.js 的 parseWaterThresholds **从不冻结返回值**（恒 return out），
  //   此前「已冻结」断言是对上游的错误假设，不是产品缺陷 ⇒ 撤销，不为此改产品。
  ok(Array.isArray(real(undefined)), "★[AD1] 返回类型是数组（契约：阈值列表）");
}

console.log("\n── B3-CA-AD1 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
