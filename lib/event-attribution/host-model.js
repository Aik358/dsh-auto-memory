/**
 * host-model.js —— 宿主 runSubagent 适配器：超时/空输出/异常归一化。
 *
 * 职责边界：
 *   · 把 ports.modelPort（生产 = 宿主 runSubagent；测试 = fake）包装成**统一的** { ok, text, error, code }
 *   · 归一化四类失败：不可用 / 空串 / 超时 / 抛错
 *
 * 禁止：新建网络通道、实现业务判定、读事件库。
 *
 * ★本模块存在的理由（真实坑）：runSubagent 五道门任一不过会 **return ''（不抛错）**。
 *   空串若被当成「模型说没意见」，就会静默 fail-open 成 create-new —— 那是把「不可用」伪装成「判定完成」。
 *   ⇒ 空串必须显式归为 unavailable，且**不得**被下游读成 create-new。
 */

import { HOST_JOB_LABEL, EVENT_ATTRIBUTION_PROFILE_V1 } from './contract.js'

/** 归一化结果码。 */
export const MODEL_CODES = Object.freeze({
  OK: 'ok',
  UNAVAILABLE: 'unavailable',
  EMPTY: 'empty',
  TIMEOUT: 'timeout',
  ERROR: 'error',
})

/**
 * 调用端口并归一化结果。
 *
 * @param {object} ports { modelPort?: { call(prompt, opts): Promise<string> } }
 * @param {string} prompt
 * @param {{ timeoutMs?:number, label?:string }} [opts]
 * @returns {Promise<{ok:boolean, text:string, code:string, error?:string, elapsedMs:number}>}
 */
export async function callHostModelPre(ports, prompt, opts = {}) {
  const t0 = Date.now()
  const port = ports && ports.modelPort
  const elapsed = () => Date.now() - t0
  if (!port || typeof port.call !== 'function') {
    return { ok: false, text: '', code: MODEL_CODES.UNAVAILABLE, error: '未注入 modelPort', elapsedMs: elapsed() }
  }
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || EVENT_ATTRIBUTION_PROFILE_V1.timeoutMs)
  const label = String(opts.label || HOST_JOB_LABEL)
  try {
    const raw = await Promise.race([
      Promise.resolve(port.call(prompt, { timeoutMs, label })),
      // ★超时自己实现，不依赖端口实现方是否尊重 timeoutMs；
      //   定时器必须 clear，否则进程会因悬挂 timer 迟迟不退出（smoke 里会表现为挂死）。
      new Promise((_, rej) => {
        const t = setTimeout(() => {
          const e = new Error('宿主模型调用超时（' + timeoutMs + 'ms）')
          e.code = MODEL_CODES.TIMEOUT
          rej(e)
        }, timeoutMs)
        if (typeof t.unref === 'function') t.unref()
      }),
    ])
    const text = String(raw == null ? '' : raw)
    if (!text.trim()) {
      return { ok: false, text: '', code: MODEL_CODES.EMPTY, error: '宿主返回空串（门控未通过或子代理不可用）', elapsedMs: elapsed() }
    }
    return { ok: true, text, code: MODEL_CODES.OK, elapsedMs: elapsed() }
  } catch (e) {
    const code = (e && e.code === MODEL_CODES.TIMEOUT) ? MODEL_CODES.TIMEOUT : MODEL_CODES.ERROR
    return { ok: false, text: '', code, error: String((e && e.message) || e).slice(0, 240), elapsedMs: elapsed() }
  }
}

/**
 * 生产适配器：把 engine.runSubagent 包成 modelPort。
 *
 * ★只复用宿主既有方法；不改 CROSS_WS_ALLOWED_LABELS、不授予跨工作区写权限。
 *
 * @param {object} engine 宿主 engine（需有 runSubagent）
 * @param {string} [_JobLabel]
 * @returns {{ call:(prompt:string, opts:object)=>Promise<string> }|null}
 */
export function createHostModelPort(engine, _JobLabel) {
  if (!engine || typeof engine.runSubagent !== 'function') return null
  return {
    /**
     * ★task-29 阻断五：**请求身份**（requested）与观测身份（resolved）分开。
     *   本方法只报「我们请求了什么」——从 engine.config.subagentProvider / subagentModel 读取。
     *   缺失即 null，**不猜测、不用默认值冒充**。
     *   runSubagent 不返回实际 provider/model ⇒ resolved 恒 null（由 reviewer 保持）。
     */
    describe() {
      const cfg = (engine && engine.config && typeof engine.config === 'object') ? engine.config : {}
      const pick = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null
      return {
        provider: pick(cfg.subagentProvider),
        model: pick(cfg.subagentModel),
      }
    },
    async call(prompt, opts = {}) {
      const label = String((opts && opts.label) || HOST_JOB_LABEL)
      const agent = engine._lastAgent
      const timeoutMs = Number(opts && opts.timeoutMs) || EVENT_ATTRIBUTION_PROFILE_V1.timeoutMs
      // 与产线同形：runSubagent(text, label, agent, timeoutMs)
      return await engine.runSubagent(prompt, label, agent, timeoutMs)
    },
  }
}

export default { MODEL_CODES, callHostModelPre, createHostModelPort }
