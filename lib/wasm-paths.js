/**
 * transformers.js / onnxruntime-web 的 **wasm 资产本地化**（#207 审计 §G2 第 4 项）。
 *
 * 病症：`@huggingface/transformers` v3 默认把 onnxruntime-web 的 .wasm 指向 CDN
 * （jsDelivr）。Node ESM 不接受 `https:` 导入 ⇒ 离线/内网环境下语义档初始化失败，
 * 退化为词法档（有 norm 自检兜底，不会炸，但语义能力静默消失）。
 *
 * 处方：把 `env.backends.onnx.wasm.wasmPaths` 固定到 **本包 dist 目录**（transformers.js
 * 随包发布 `ort-wasm*.wasm`）。用 `localWasmPaths` 开关控制：
 *   - `auto`（默认）：本地有 wasm 资产就本地化；没有则保持上游行为（不写坏 env）；
 *   - `off`：完全不碰（保留原 CDN 行为，供排障/对比用）。
 *
 * 本模块零第三方依赖、可独立 import 做真调用回归。
 */
import { existsSync, readdirSync } from 'node:fs'

/** onnxruntime-web 的 wasm 资产名（transformers.js dist 内随包发布）。 */
const WASM_ASSET_RE_PRE_V1 = /^ort-wasm[^\\/]*\.wasm$/i

/**
 * 在 `dir` 下找本地 wasm 资产目录；找到返回该目录，否则返回空串。
 * @param {string} dir
 */
export function resolveLocalWasmDirPre(dir) {
  try {
    const target = String(dir || '')
    if (!target || !existsSync(target)) return ''
    const hit = readdirSync(target).find((name) => WASM_ASSET_RE_PRE_V1.test(String(name)))
    return hit ? target : ''
  } catch (_) { return '' }
}

/**
 * 按 mode 把本地 wasm 目录写入 transformers 的 env。
 * @param {any} env transformers 导出的 env（须有 env.backends.onnx.wasm）
 * @param {string} dir 解析到的 transformers 包入口目录
 * @param {string} [mode] 'auto' | 'off'
 * @returns {{applied: boolean, mode: string, dir: string, reason?: string}}
 */
export function applyLocalWasmPathsPre(env, dir, mode) {
  const want = String(mode || 'auto').toLowerCase() === 'off' ? 'off' : 'auto'
  if (want === 'off') return { applied: false, mode: 'off', dir: '' }
  const local = resolveLocalWasmDirPre(dir)
  if (!local) return { applied: false, mode: want, dir: '', reason: 'no-local-wasm' }
  try {
    const wasm = env && env.backends && env.backends.onnx && env.backends.onnx.wasm
    if (!wasm || typeof wasm !== 'object') return { applied: false, mode: want, dir: local, reason: 'no-wasm-config' }
    wasm.wasmPaths = local
    return { applied: true, mode: want, dir: local }
  } catch (_) {
    return { applied: false, mode: want, dir: local, reason: 'set-failed' }
  }
}
