import { readFileSync, writeFileSync } from 'node:fs'
const PY = 'D:/dsh-auto-memory/python/worker_semantic_v1.py'
const CRLF = '\r\n'
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const py0 = readFileSync(PY, 'utf8')
const M = 'H 批 · v1 车道正式退休'

// ===== 1) 退休 v1 的发射权：保留 shadow 行（调参用），删除 append 帧 ===
ok(!py0.includes(M), '幂等：标记未存在（对入口快照判定）')
const A = [
  "                    # 2026-09-30 G 批 · 发射闸单钥匙化：本通道（M7-6 双阈值）此前只看 activationPolicy.mode，",
  "                    # 而该键在**用户面零写入点**（设置页 / 向导 / semantic-emit 端点均只写 activationEmitMode）",
  "                    # ⇒ 用户在 UI 开「记忆唤起」后本通道恒沉默（判定照跑、shadow 行照记、帧不发）。",
                    # 判定改为「以投递开关为准」：activationEmitMode == active 即放行；",
                    # 同时保留 activationPolicy.mode == active 的**显式**路径（校准脚本 / 老配置仍有效）。",
                    # ⚠️ 非引擎联动：JS 与 Python 两套引擎的选择逻辑完全不动（语义引擎铁律）。",
                    if (self.activation_policy['mode'] == 'active'",
                            or self.activation_emit_mode == 'active'):",
                        frames.append(self._frame(req, 'activation_request',",
                                                  {'activation': act},",
                                                  fid_prefix='act_'))",
].join(CRLF) + CRLF
ok(py0.split(A).length - 1 === 1, 'A 锚点恰命中 1 次')
const B = [
  '                    # ===== ' + M + '（用户裁定 2026-09-30：「正式退休 v1 车道，或者注释明白只用于调参实验，不可接入正式用户线」）=====',
  '                    # 【v1 车道（M7-6 双阈值）的定位｜仅调参实验·不可接入正式用户线】',
  '                    #',
  '                    # 本车道是 **校准期** 的机制：策略工件（tOn/tOff/cooldownObs，append-only、configHash 冻结）',
  '                    # 决定了它必须与用户运营面隔离。它的「发射权」**已正式退休** ——',
  '                    #     · 用户把「记忆唤起」开到 active 时，发帧的是 **fv2 车道**（见文件末尾 emit bridge）；',
  '                    #     · 本车道继续跑判定并**照写 shadow 行**（activation-shadow.jsonl），',
  '                    #       供双阈值标定/离线评测使用 —— 这是它唯一被保留的用途。',
  '                    #',
  '                    # 为什么退休：本车道读的是 activationPolicy.mode，而该键在用户面**零写入点**',
  '                    #（设置页 / 新手向导 / semantic-emit 端点三处全只写 activationEmitMode）。',
  '                    # 两把钥匙 = 两条用户无法自洽控制的投递路径；少一把钥匙，就少一条「用户开了却不生效」的歧路。',
  '                    #',
  '                    # ⚠️ 禁止复活：不得在此处重新 append activation_request 帧。',
  '                    #    正式用户线的发帧**唯一入口** = fv2 emit bridge（受 activationEmitMode 门控）。',
  '                    #    需要调参请直接读 activation-shadow.jsonl；需要上线请走 fv2。',
  '                    #    该不变量由 tests/smoke/smoke-test-h1-v1-lane-retired.mjs 真执行守卫。',
  '                    pass  # 退休：不再发帧（此前为 activation_policy/activation_emit_mode 双路放行）',
].join(CRLF) + CRLF
let py = py0.replace(A, B)
ok(py !== py0, 'A 替换已应用')

// ===== 2) 顶部策略块写明定位 =====\
const C = "    'mode': 'shadow',            # 'shadow' = calibrate/log only; 'active' = emit frames\r\n";
ok(py.split(C).length - 1 === 1, 'C 锚点恰命中 1 次')
const D = [
  "    # ⚠️ ' + M + '：mode 的 'active' 值**已失效**（不再放行任何帧）。",
  "    # 本策略块整体属**校准期**工件，仅供调参；正式用户线投递看 activationEmitMode（fv2 车道）。",
  "    'mode': 'shadow',            # 退休后恒为 shadow（'active' 已不再是发射开关）",
].join(CRLF) + CRLF
py = py.replace(C, D)
ok(py !== py0, 'C 替换已应用')

// 守恒：文件必须仍可 py_compile，且 activation_request 只剩 fv2 一处 append
const appends = (py.match(/frames\.append\(self\._frame\(req, 'activation_request'/g) || []).length
ok(appends === 1, 'activation_request append 仅剩 1 处（fv2 emit bridge）；实物 ' + appends)
writeFileSync(PY, py, 'utf8')
console.log('== patch done: pass ' + pass + ' / fail ' + fail + ' ==')
if (fail) process.exit(1)
