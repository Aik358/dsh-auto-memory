/**
 * M7-0/M7-1 PythonContextSinkPre(docs/PYTHON-SIDECAR-CONTRACT.md §5.2,§8.2,§13.1)。
 * 实现 M5 ContextSinkPre 接口:消费现有 ContextPushEnvelopePre 原样字段(零 schema 改动),
 * 在 deadlineAt 预算内返回兼容 ContextAckPre;worker 主动推送的 activation_request 帧经
 * onActivation 上抛(交给现有 M6 validator/inbox 路径,本模块不构建 Packet)。
 * 失败映射为结构化 ContextAckPre(accepted:false + reason 枚举);异常绝不冒泡到基础对话。
 * 本模块不 spawn:进程生命周期完全属于共享的 SidecarClient。UTF-8 无 BOM。
 */
import { validateContextAckPre } from './context-bridge.js'
import { ackMatchesObservationPre } from './m7-wire.js'

export const PYTHON_CONTEXT_SINK_KIND_PRE = 'python'

const ACK_REASON_FOR_CODE_PRE = Object.freeze({
  timeout: 'busy',
  aborted: 'busy',
  circuitOpen: 'unsupported',
  'circuit-open': 'unsupported',
  unavailable: 'unsupported',
  crashed: 'unsupported',
  disposed: 'unsupported',
  backpressure: 'busy',
  protocol: 'unsupported',
  'line-oversize': 'unsupported',
  'worker-error': 'unsupported',
  'unsupported-frame': 'unsupported',
})

export function createPythonContextSinkPre(opts = {}) {
  const client = opts.client
  if (!client || typeof client.request !== 'function') throw new Error('context-sink-python: client required')
  const stats = { pushed: 0, accepted: 0, rejected: 0, staleDeadline: 0, invalidAck: 0, errors: 0 }
  const requestTimeoutMs = Number(opts.requestTimeoutMs) || 5000
  // 2026-08-30 canary 实证修复:传入的 onActivation 从未注册(只暴露注册方法,无人调用),
  // worker activation_request 帧到达客户端后静默蒸发(activationsReceived++ 但 offers=0)。
  // 自动注册,修通 Python emit → M6 的最后一厘米。
  if (typeof opts.onActivation === 'function') client.onActivation(opts.onActivation)

  /** 注册 worker 主动激活的下游处理器(M6 路径);返回解绑函数。 */
  function onActivation(handler) { return client.onActivation(handler) }

  async function push(frame, signal) {
    stats.pushed++
    const observationId = frame && typeof frame.observationId === 'string' ? frame.observationId : ''
    try {
      if (!frame || !observationId) { stats.rejected++; stats.errors++; return { observationId, accepted: false, reason: 'unsupported' } }
      const now = Date.now()
      const deadline = Number(frame.deadlineAt)
      let timeoutMs = requestTimeoutMs
      if (Number.isFinite(deadline)) {
        const remaining = deadline - now
        if (remaining <= 0) { stats.rejected++; stats.staleDeadline++; return { observationId, accepted: false, reason: 'stale' } }
        timeoutMs = Math.min(timeoutMs, remaining)
      }
      // §8.2:payload 即完整 ContextPushEnvelopePre,原样透传(零字段增删)
      const res = await client.request('context_push', frame, { timeoutMs, signal })
      if (res.ok) {
        const ack = res.frame && res.frame.payload
        const v = validateContextAckPre(ack)
        if (!v.ok || !ackMatchesObservationPre(ack, observationId)) {
          stats.rejected++; stats.invalidAck++
          return { observationId, accepted: false, reason: 'unsupported' }
        }
        if (ack.accepted) stats.accepted++; else stats.rejected++
        return ack
      }
      stats.rejected++
      const reason = ACK_REASON_FOR_CODE_PRE[res.code] || 'unsupported'
      return { observationId, accepted: false, reason }
    } catch (_) {
      stats.errors++; stats.rejected++
      return { observationId, accepted: false, reason: 'unsupported' }
    }
  }

  async function closeSession(sessionId) {
    try { client.notify('close_session', { sessionId: String(sessionId || '') }) } catch (_) {}
  }

  async function dispose(reason) {
    void reason
    // 客户端为 engine 级共享;sink 只解除自身注册(进程销毁由客户端 disposer 负责)
  }

  function debugView() {
    return { kind: PYTHON_CONTEXT_SINK_KIND_PRE, stats: { ...stats }, client: client.debugView() }
  }

  return { kind: PYTHON_CONTEXT_SINK_KIND_PRE, push, closeSession, dispose, onActivation, debugView, _statsForTest: stats }
}
