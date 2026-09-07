// Build counterfactual-pairs.jsonl for label-review-cal20260824-1954.
// Every sample anchors to a REAL parent (live memoryId or episodes.jsonl
// episodeId). Only query phrasing / recall demand varies - never new user
// facts. Split is grouped by pairId (sha256 % 10: <7 train, <9 dev, else
// test); all samples of a pair share the split.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const LIVE = {
  lunch: 'mem_4257151bfacc49ecbd54f4f9f60c092d',
  amber: 'mem_27a7b9a977e04d2498ed94f0282e5844',
  whale: 'mem_b914e1b055d4437eaed77cace8546b91',
  jiebaCorrMd: 'mem_31919729c447464585ee14ab25d2f033',
  jiebaCorrLog: 'mem_fa5325639f2b4e7883c3a5f504a69ab4',
  m78fix: 'mem_5f6a877ffed24248af16abd8567745f2',
  pushInv: 'mem_044dd2f5581549bfbae880d7a643a862',
  testA: 'mem_cd96bfa374594427b3104d8c8fa860d8',
}
const EP = {
  bgeSel: 'ep_69025fcb515a3c27', tokChunk: 'ep_f0c77ba04cd121f5',
  bm25: 'ep_4d566bf383c52c84', validator: 'ep_0fb0cc7f49cd63ba',
  inbox: 'ep_7f62b88e4a88a30c', staleCtx: 'ep_821e9a67dfaa1167',
  m6tail: 'ep_61e630101d904981', m4live: 'ep_d55314eeacdc176f',
  oxa: 'ep_09c98bb7f754d65c', openCode: 'ep_b73077cbb601372b',
  unkTruth: 'ep_e18652acb486ac1d', unkPatch: 'ep_668da319b91aa991',
  coverage: 'ep_d5a1fada0a5eb4e9', compact: 'ep_500b546cf7287f7f',
  budget: 'ep_9695c53761cd879c', freeze: 'ep_fbaf15fadf93800d',
  m7071: 'ep_2010e63c143e2e2f', release: 'ep_a6d7815720f65150',
  assetWide: 'ep_464d5cf4839ee012', assetComplain: 'ep_93e469ae72141e16',
  ccsw: 'ep_ee3abeb31860e867', refreeze: 'ep_d1b5ccbaa319263e',
  npmUpd: 'ep_07aa98a770488574', handoff: 'ep_ed328f67349005fd',
  hdcXdev: 'ep_e515177f4c632f2c', psychopy: 'ep_fed40ce72e0ecc0f',
  clApi: 'ep_d1ad532209bc0390', devecoSkills: 'ep_63a81d63a2fe9499',
  cardAes: 'ep_dc824cdd457c6222', sshKey: 'ep_7f86c6be19ce3103',
  partClone: 'ep_2796e89a18b449d2',
}

let n = 0
const out = []
// group(category) helper; s() adds one sample.
function group(pairId, category, parent, meta, samples) {
  for (const v of samples) {
    n++
    const s = {
      sampleId: 'cf-' + String(n).padStart(3, '0'),
      pairId, category,
      parentEpisodeId: parent.startsWith('ep_') ? parent : null,
      parentMemoryId: parent.startsWith('mem_') ? parent : null,
      ...meta,
      ...v,
      synthetic: true,
      generator: { provider: 'zcode-agent', model: 'ox-alpha',
                   version: 'label-review-cal20260824-1954' },
      labelSource: 'strong-agent', isGold: false,
    }
    if (!s.language) s.language = 'zh'
    if (s.harmful === undefined) s.harmful = false
    if (!s.expectedMemoryIds) s.expectedMemoryIds = []
    if (!s.forbiddenMemoryIds) s.forbiddenMemoryIds = []
    out.push(s)
  }
}
const ACT = { proposedAction: 'activate', recallIntent: true,
              dialogueAct: 'question', echoRisk: 'none', taskNeed: 'required',
              scopeStatus: 'valid', freshnessStatus: 'fresh' }
const SUP = { proposedAction: 'suppress', recallIntent: false,
              dialogueAct: 'statement', echoRisk: 'high', taskNeed: 'none',
              scopeStatus: 'valid', freshnessStatus: 'unknown' }
const PFE = { proposedAction: 'prefetch', recallIntent: false,
              dialogueAct: 'planning', echoRisk: 'low', taskNeed: 'optional',
              scopeStatus: 'valid', freshnessStatus: 'fresh' }

// ---- G01-G12: explicit recall vs semantic echo ----
group('cf-g01', 'echo-vs-recall', LIVE.lunch, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '之前午饭吃了什么？', expectedMemoryIds: [LIVE.lunch],
    dialogueAct: 'question', echoRisk: 'none', confidence: 0.8,
    rationale: '显式回忆问句，目标唯一且 fresh（任务书示例对）' },
  { ...SUP, queryText: '今天这碗面挺好吃。', forbiddenMemoryIds: [LIVE.lunch],
    confidence: 0.95, rationale: '回声陈述：与记录内容近乎复述，无回忆需求' },
])
group('cf-g02', 'echo-vs-recall', LIVE.amber, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '之前为什么定琥珀协议做模块间通信格式？', expectedMemoryIds: [LIVE.amber],
    confidence: 0.85, rationale: '显式回忆虚构决策 fixture' },
  { ...SUP, queryText: '琥珀协议这名字听起来挺酷。', forbiddenMemoryIds: [LIVE.amber],
    confidence: 0.9, rationale: '纯感叹与决策记录零任务关系' },
])
group('cf-g03', 'echo-vs-recall', LIVE.whale, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '蓝鲸-7号联调是什么时候通过的？', expectedMemoryIds: [LIVE.whale],
    confidence: 0.85, rationale: '里程碑事实问句' },
  { ...SUP, queryText: '蓝鲸-7号这个名字真响亮。', forbiddenMemoryIds: [LIVE.whale],
    confidence: 0.9, rationale: '名字感叹非召回' },
])
group('cf-g04', 'echo-vs-recall', EP.bgeSel, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '之前为什么选 BGE-M3？', expectedMemoryIds: [EP.bgeSel],
    confidence: 0.85, rationale: '选型理由回忆（任务书示例对）' },
  { ...SUP, queryText: 'BGE-M3 看起来不错。', forbiddenMemoryIds: [EP.bgeSel],
    confidence: 0.9, rationale: '观点陈述非提问（任务书示例对）' },
  { ...PFE, queryText: '我准备评估新的 embedding 模型。', expectedMemoryIds: [EP.bgeSel],
    confidence: 0.75, rationale: '评估语境下选型历史备用（任务书示例对）' },
])
group('cf-g05', 'echo-vs-recall', EP.m6tail, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'Reference Tail 是在哪个里程碑完成 live 验证的？', expectedMemoryIds: [EP.m6tail],
    confidence: 0.8, rationale: '里程碑定位问句' },
  { ...SUP, queryText: '尾注渲染这块差不多了。', confidence: 0.8,
    echoRisk: 'medium', rationale: '模糊进展陈述，无目标无需求' },
  { ...PFE, queryText: '我要改 reference tail 的渲染逻辑。', expectedMemoryIds: [EP.m6tail],
    confidence: 0.7, rationale: '改动语境下 live 验证记录备用' },
])
group('cf-g06', 'echo-vs-recall', EP.bm25, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'BM25 的 k1 和 b 当时定的多少？', expectedMemoryIds: [EP.bm25],
    confidence: 0.85, rationale: '参数值回忆' },
  { ...SUP, queryText: 'BM25 挺好用的。', confidence: 0.9,
    rationale: '评价句非提问' },
])
group('cf-g07', 'echo-vs-recall', EP.validator, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'activation validator 都校验哪些字段？', expectedMemoryIds: [EP.validator],
    confidence: 0.85, rationale: '字段清单回忆（as02 同源）' },
  { ...SUP, queryText: 'validator 这块写得挺严。', confidence: 0.9,
    rationale: '评价句' },
])
group('cf-g08', 'echo-vs-recall', EP.inbox, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'inbox 的 offer 门序再说一下？', expectedMemoryIds: [EP.inbox],
    dialogueAct: 'request', confidence: 0.85, rationale: '显式请求复述门序' },
  { ...SUP, queryText: 'inbox 状态机挺复杂的。', confidence: 0.9,
    rationale: '感叹句' },
])
group('cf-g09', 'echo-vs-recall', EP.oxa, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '当时 OX-Alpha 切 Responses 为什么不行？', expectedMemoryIds: [EP.oxa],
    confidence: 0.8, rationale: '根因回忆' },
  { ...SUP, queryText: 'OX-Alpha 这个模型还行。', confidence: 0.85,
    rationale: '泛评价' },
])
group('cf-g10', 'echo-vs-recall', EP.unkTruth, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'UNKNOWN_MODEL 那次扰动真正的原因查清了吗？', expectedMemoryIds: [EP.unkTruth],
    confidence: 0.8, rationale: '事故真相回忆' },
  { ...SUP, queryText: 'UNKNOWN_MODEL 这报错名挺唬人。', confidence: 0.85,
    rationale: '感慨句' },
])
group('cf-g11', 'echo-vs-recall', LIVE.m78fix, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'M7-8 编排修复是什么时候完成的？', expectedMemoryIds: [LIVE.m78fix],
    confidence: 0.8, rationale: '时间事实问句' },
  { ...SUP, queryText: '编排修复总算搞完了。', forbiddenMemoryIds: [LIVE.m78fix],
    echoRisk: 'medium', confidence: 0.85,
    rationale: '进度感叹与记录同事件——回声风险中等的对照样本' },
])
group('cf-g12', 'echo-vs-recall', LIVE.testA, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '记忆工具联测那条记录的结论是什么？', expectedMemoryIds: [LIVE.testA],
    confidence: 0.8, rationale: '记录内容回忆' },
  { ...SUP, queryText: '测试又跑了一遍，一切正常。', confidence: 0.85,
    echoRisk: 'medium', rationale: '口头同步与日志条目语义重叠' },
])

// ---- G13-G20: task failure / repeated action vs normal planning ----
const FAIL = { ...ACT, dialogueAct: 'error-report', freshnessStatus: 'fresh' }
group('cf-g13', 'failure-vs-planning', EP.staleCtx, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: '注入又被 stale-context 丢掉了，跟上次一样！', expectedMemoryIds: [EP.staleCtx],
    confidence: 0.85, rationale: '故障复现直接需要上次的根因+解法' },
  { ...PFE, queryText: '之后要留意 contextVersion 的处理。', expectedMemoryIds: [EP.staleCtx],
    confidence: 0.7, rationale: '一般性注意项仅备用' },
])
group('cf-g14', 'failure-vs-planning', EP.validator, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'activation 一直报 invalid:字段，校验到底卡在哪？', expectedMemoryIds: [EP.validator],
    confidence: 0.85, rationale: '排障需要 validator 字段清单' },
  { ...PFE, queryText: '打算过一遍 activation 校验逻辑。', expectedMemoryIds: [EP.validator],
    confidence: 0.65, rationale: '计划性浏览仅备用' },
])
group('cf-g15', 'failure-vs-planning', EP.inbox, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: '同一个 activation 反复被 duplicate-activation 吞掉，门序是不是走错了？', expectedMemoryIds: [EP.inbox],
    confidence: 0.85, rationale: '重复门异常需门序知识定位' },
  { ...PFE, queryText: '准备梳理一遍重复门的逻辑。', expectedMemoryIds: [EP.inbox],
    confidence: 0.65, rationale: '梳理计划备用' },
])
group('cf-g16', 'failure-vs-planning', EP.coverage, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'read coverage 落盘值跟上次实测差很多，cov 只有 0.03。', expectedMemoryIds: [EP.coverage],
    confidence: 0.8, rationale: '数值异常对照历史实测值' },
  { ...PFE, queryText: '之后想复测一下 coverage 投影。', expectedMemoryIds: [EP.coverage],
    confidence: 0.65, rationale: '复测计划备用' },
])
group('cf-g17', 'failure-vs-planning', EP.budget, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'envelope 又超 4096 字节被裁了。', expectedMemoryIds: [EP.budget],
    confidence: 0.8, rationale: '超限排障需预算契约细节' },
  { ...PFE, queryText: '计划调一调 envelope 预算。', expectedMemoryIds: [EP.budget],
    confidence: 0.7, rationale: '调整工作背景下预算记录备用' },
])
group('cf-g18', 'failure-vs-planning', EP.compact, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'anchor 开启后压缩配额的分配看起来不对。', expectedMemoryIds: [EP.compact],
    confidence: 0.8, rationale: '配额异常对照设计记录' },
  { ...PFE, queryText: '有空研究下 compactLayer 的配额。', expectedMemoryIds: [EP.compact],
    confidence: 0.6, rationale: '远期研究计划' },
])
group('cf-g19', 'failure-vs-planning', EP.freeze, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'M7 契约冻结时说好的交付清单是哪几份？现在对不上。', expectedMemoryIds: [EP.freeze],
    confidence: 0.8, rationale: '交付物争议需冻结记录裁决' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'planning',
    echoRisk: 'low', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'unknown',
    queryText: '哪天把契约文档整理一下吧。', confidence: 0.8,
    rationale: '模糊远期安排，无需历史注入' },
])
group('cf-g20', 'failure-vs-planning', EP.npmUpd, { parentWorkspace: 'ws/dsh-core' }, [
  { ...FAIL, queryText: 'dsh 在线更新又失败了，之前确认过的 NPM 更新方式是什么？', expectedMemoryIds: [EP.npmUpd],
    confidence: 0.85, rationale: '"又失败"+显式指认历史结论=必须取回' },
  { ...PFE, queryText: '考虑下要不要做个自动更新。', expectedMemoryIds: [EP.npmUpd],
    confidence: 0.6, rationale: '新特性构想，历史仅背景' },
])

// ---- G21-G28: old fact vs correction / supersede ----
group('cf-g21', 'supersede', LIVE.jiebaCorrMd, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '分词现在是先用 jieba 预切吧？', expectedMemoryIds: [LIVE.jiebaCorrMd],
    confidence: 0.8, freshnessStatus: 'fresh',
    rationale: '旧事实问句的正确处置=返回勘误后的新权威记录（activate 新，非复活旧）' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    forbiddenMemoryIds: [LIVE.jiebaCorrMd],
    queryText: '我们就用 jieba 预切，别改了。', confidence: 0.9,
    rationale: '坚持已被勘误的旧方案=误导性陈述；不得作为可执行依据注入' },
])
group('cf-g22', 'supersede', EP.release, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '现在的发布策略还是老规则吗？', expectedMemoryIds: [EP.release],
    confidence: 0.75, rationale: '"现状是否变化"问句应返回策略更新记录本身' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '按老的发布规则直接发 formal 版。', confidence: 0.85,
    rationale: '按已更新前的旧规则行动有害' },
])
group('cf-g23', 'supersede', EP.assetWide,
  { parentWorkspace: 'ws/external-codex', scopeCaveat: '父记录属外部 codex 工作区，仅在源工作区语义内成立' }, [
  { ...ACT, queryText: '素材来源现在放宽到什么范围了？', expectedMemoryIds: [EP.assetWide],
    scopeStatus: 'invalid', confidence: 0.7,
    rationale: '放宽决定取代早期较窄约束' },
  { proposedAction: 'suppress', recallIntent: true, dialogueAct: 'question',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'invalid',
    freshnessStatus: 'stale', harmful: true,
    forbiddenMemoryIds: [EP.assetComplain],
    queryText: '素材不是只限电影原画吗？', confidence: 0.75,
    rationale: '复述已被放宽决定取代的旧约束；forbidden=早期抱怨轮（同任务相邻轮防混淆）' },
])
group('cf-g24', 'supersede', EP.ccsw,
  { parentWorkspace: 'ws/external-codex', scopeCaveat: '父记录属外部 codex 工作区' }, [
  { ...ACT, queryText: 'CC switch 里模型上下文上限后来改成多少了？', expectedMemoryIds: [EP.ccsw],
    scopeStatus: 'invalid', confidence: 0.7,
    rationale: '256K→1M 修正后的现值回忆' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'invalid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '上下文就是 256K，不用动了。', confidence: 0.8,
    rationale: '坚持修正前数值会误导后续配置' },
])
group('cf-g25', 'supersede', EP.refreeze, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'M5/M6/M7 的推进顺序最后是怎么定的？', expectedMemoryIds: [EP.refreeze],
    confidence: 0.75, rationale: '两阶段重排冻结记录为最终权威' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'planning',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '还按最早的单阶段顺序往下推吧。', confidence: 0.8,
    rationale: '已被冻结决定取代的原计划不得再执行' },
])
group('cf-g26', 'supersede', EP.unkTruth, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'UNKNOWN_MODEL 的根因结论后来有没有修正？', expectedMemoryIds: [EP.unkTruth],
    confidence: 0.7, rationale: '澄清记录即修正后的结论' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '根因就是 subagent 配置，别再查了。', confidence: 0.75,
    rationale: '断言澄清前的旧归因（该旧文本不在库，标注依据澄清记录的存在）' },
])
group('cf-g27', 'supersede', EP.handoff, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '交接文档"当前现场"小节的最新状态是什么？', expectedMemoryIds: [EP.handoff],
    confidence: 0.7, rationale: 'M4 收官要点记录了更新后的现场' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '现场还停留在 M4 收官前的状态吧。', confidence: 0.75,
    rationale: '过期现场描述会误导接手' },
])
group('cf-g28', 'supersede', LIVE.jiebaCorrLog, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '18:32 那条记忆勘误说了什么？', expectedMemoryIds: [LIVE.jiebaCorrLog],
    confidence: 0.8, rationale: '勘误日志条目内容回忆' },
  { proposedAction: 'suppress', recallIntent: false, dialogueAct: 'statement',
    echoRisk: 'none', taskNeed: 'none', scopeStatus: 'valid',
    freshnessStatus: 'stale', harmful: true,
    queryText: '记忆里写的分词方案就是最终方案，照它执行。', confidence: 0.8,
    rationale: '"记忆即真理"式断言无视后续勘误，有害' },
])

// ---- G29-G36: same topic, different workspace ----
function xws(pairId, parent, ws, q, extra) {
  group(pairId, 'cross-workspace', parent, {
    parentWorkspace: ws, scopeCaveat: '父记录属 ' + ws + '，dsh-core 会话中不可达' }, [
    { proposedAction: 'suppress', recallIntent: true, dialogueAct: 'question',
      echoRisk: 'none', taskNeed: 'optional', scopeStatus: 'invalid',
      freshnessStatus: 'unknown', workspaceScope: 'ws/dsh-core',
      forbiddenMemoryIds: [parent], language: 'zh', confidence: 0.8,
      queryText: q,
      rationale: '同一信息需求在 dsh-core 会话提出：目标跨 workspace，三重过滤下应不可达（wrong-scope suppress）',
      ...extra },
    { ...ACT, workspaceScope: ws, scopeStatus: 'valid',
      expectedMemoryIds: [parent], queryText: q, language: 'zh',
      confidence: 0.7,
      rationale: '同一查询在其源工作区内：目标可达且 fresh，构成合法 activate 对照' },
  ])
}
xws('cf-g29', EP.hdcXdev, 'ws/external-workbuddy', 'WorkBuddy 跨设备协作用的哪种连接模式？')
xws('cf-g30', EP.psychopy, 'ws/external-codex', 'PsychoPy 鸿蒙移植用的技术栈是什么？')
xws('cf-g31', EP.clApi, 'ws/external-claude', 'HarmonyOS 开发指引的核心规则有哪些？')
xws('cf-g32', EP.devecoSkills, 'ws/external-codex', 'DevEco 里装鸿蒙开发 skills 的步骤是什么？')
xws('cf-g33', EP.ccsw, 'ws/external-codex', 'CC switch 的模型上下文上限配置是多少？')
xws('cf-g34', EP.cardAes, 'ws/external-codex', '抽卡演出像素化的画风要求是什么？')
xws('cf-g35', EP.sshKey, 'ws/external-claude', 'GitHub SSH host key 报错怎么处理？')
xws('cf-g36', EP.partClone, 'ws/external-claude', 'marketplace 添加失败因为残留 partial clone 怎么清理？')

// ---- G37-G44: zh / en / mixed variants over the same parent ----
group('cf-g37', 'language-variant', LIVE.amber, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '之前关于琥珀协议的决定是什么？', expectedMemoryIds: [LIVE.amber],
    confidence: 0.85, rationale: 'zh 基准' },
  { ...ACT, language: 'en', queryText: 'What was the amber protocol decision about?',
    expectedMemoryIds: [LIVE.amber], confidence: 0.8,
    rationale: 'en→zh 跨语言同目标' },
  { ...ACT, language: 'mixed', queryText: 'amber 协议当时怎么定的？',
    expectedMemoryIds: [LIVE.amber], confidence: 0.8,
    rationale: '中英混写变体' },
])
group('cf-g38', 'language-variant', LIVE.whale, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '蓝鲸-7号的联调结论是什么？', expectedMemoryIds: [LIVE.whale],
    confidence: 0.85, rationale: 'zh 基准' },
  { ...ACT, language: 'en', queryText: 'What was the joint-testing result of Blue Whale-7?',
    expectedMemoryIds: [LIVE.whale], confidence: 0.75,
    rationale: 'en→zh（名称意译，非逐字）' },
])
group('cf-g39', 'language-variant', EP.bgeSel, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '当时为什么选了 BGE-M3 而不是另外两个候选？', expectedMemoryIds: [EP.bgeSel],
    confidence: 0.85, rationale: 'zh 基准' },
  { ...ACT, language: 'en', queryText: 'Why was BGE-M3 selected over Qwen3 and E5?', expectedMemoryIds: [EP.bgeSel],
    confidence: 0.8, rationale: 'en→zh' },
])
group('cf-g40', 'language-variant', EP.bm25, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '词法层的 BM25 参数取值是多少？', expectedMemoryIds: [EP.bm25],
    confidence: 0.85, rationale: 'zh 基准' },
  { ...ACT, language: 'mixed', queryText: 'BM25 的 k1/b 最终取值？', expectedMemoryIds: [EP.bm25],
    confidence: 0.85, rationale: '代码锚点混写' },
])
group('cf-g41', 'language-variant', EP.validator, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'ActivationRequest 硬校验都查什么？', expectedMemoryIds: [EP.validator],
    confidence: 0.85, rationale: 'zh 基准' },
  { ...ACT, language: 'en', queryText: 'What fields does the activation validator hard-check?', expectedMemoryIds: [EP.validator],
    confidence: 0.8, rationale: 'en→zh' },
])
group('cf-g42', 'language-variant', EP.oxa, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: '切 Responses API 不可行的根因是什么？', expectedMemoryIds: [EP.oxa],
    confidence: 0.8, rationale: 'zh 基准' },
  { ...ACT, language: 'mixed', queryText: '503 Endpoint is unavailable 那次的结论是什么？', expectedMemoryIds: [EP.oxa],
    confidence: 0.8, rationale: '错误码混写锚点' },
])
group('cf-g43', 'language-variant', EP.m6tail, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, language: 'en', queryText: 'Which milestone delivered the reference tail?', expectedMemoryIds: [EP.m6tail],
    confidence: 0.8, rationale: 'en 基准' },
  { ...ACT, queryText: '参考尾注是哪个里程碑交付的？', expectedMemoryIds: [EP.m6tail],
    confidence: 0.85, rationale: 'zh→同目标' },
])
group('cf-g44', 'language-variant', EP.tokChunk, { parentWorkspace: 'ws/dsh-core' }, [
  { ...ACT, queryText: 'tokenizer 和 chunking 怎么分工？', expectedMemoryIds: [EP.tokChunk],
    confidence: 0.8, rationale: 'zh 基准' },
  { ...ACT, language: 'en', queryText: 'Who owns tokenization versus chunking?', expectedMemoryIds: [EP.tokChunk],
    confidence: 0.75, rationale: 'en→zh' },
])

// ---- G45-G50: code / path / error-code / package-name anchors ----
const CODE = { ...ACT, language: 'mixed', dialogueAct: 'error-report' }
group('cf-g45', 'code-anchor', EP.coverage, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: 'ev_pre_ 记录 cov=0.035 对应哪次验证？', expectedMemoryIds: [EP.coverage],
    confidence: 0.8, rationale: '前缀+数值双锚点' },
])
group('cf-g46', 'code-anchor', EP.openCode, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: 'finish_reason=network_error 的重试处理参考哪条结论？', expectedMemoryIds: [EP.openCode],
    forbiddenMemoryIds: [EP.oxa], confidence: 0.75,
    rationale: '截断主题双子：OpenCode 修复侧而非 OX-Alpha 不可行侧' },
])
group('cf-g47', 'code-anchor', EP.m6tail, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: 'pkt_pre_ a602f2aa 那次注入的渲染结果是什么？', expectedMemoryIds: [EP.m6tail],
    forbiddenMemoryIds: [EP.staleCtx], confidence: 0.75,
    rationale: 'packet id 锚点+易混对压制' },
])
group('cf-g48', 'code-anchor', EP.oxa, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: '503 Endpoint is unavailable 当时的排查结论是什么？', expectedMemoryIds: [EP.oxa],
    forbiddenMemoryIds: [EP.openCode], confidence: 0.8,
    rationale: '与 g46 成对的相反方向查询' },
])
group('cf-g49', 'code-anchor', EP.m7071, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: 'index_sync 的 finalDigest 覆盖哪些字段？', expectedMemoryIds: [EP.m7071],
    confidence: 0.75, rationale: '协议字段锚点（M7-0/1 记录）' },
])
group('cf-g50', 'code-anchor', EP.m7071, { parentWorkspace: 'ws/dsh-core' }, [
  { ...CODE, queryText: 'obs_pre_ observationId 的幂等去重是怎么设计的？', expectedMemoryIds: [EP.m7071],
    confidence: 0.75, rationale: '前缀锚点+机制回忆' },
])

// ---- G51-G56: low-info / chitchat / acknowledgement contrasts ----
const LOW = { proposedAction: 'suppress', recallIntent: false,
              dialogueAct: 'acknowledgement', echoRisk: 'none',
              taskNeed: 'none', scopeStatus: 'valid',
              freshnessStatus: 'unknown' }
group('cf-g51', 'low-info', EP.inbox, { parentWorkspace: 'ws/dsh-core' }, [
  { ...LOW, queryText: '好的，继续。', confidence: 0.95, rationale: '无目标确认语' },
  { ...ACT, queryText: '好的，继续说 inbox 的 offer 门序。', expectedMemoryIds: [EP.inbox],
    dialogueAct: 'request', confidence: 0.85,
    rationale: '同款确认语+显式目标=合法 activate（对照）' },
])
group('cf-g52', 'low-info', EP.m4live, { parentWorkspace: 'ws/dsh-core' }, [
  { ...LOW, queryText: '嗯嗯。', confidence: 0.95, rationale: '纯附和' },
  { ...ACT, queryText: '嗯嗯，就按 M4-4 那次发现的两个缺陷来改。', expectedMemoryIds: [EP.m4live],
    dialogueAct: 'request', confidence: 0.8,
    rationale: '附和+指认历史结论=需要取回该记录' },
])
group('cf-g53', 'low-info', LIVE.lunch, { parentWorkspace: 'ws/dsh-core' }, [
  { ...SUP, queryText: '今天天气不错。', confidence: 0.95,
    rationale: '寒暄陈述（回声高风险族）' },
  { ...ACT, queryText: '上次记的天气那条还说了什么？', expectedMemoryIds: [LIVE.lunch],
    confidence: 0.7, rationale: '显式回忆当日生活记录（记录含天气+午饭）' },
])
group('cf-g54', 'low-info', LIVE.amber, { parentWorkspace: 'ws/dsh-core' }, [
  { ...LOW, queryText: '在吗？', dialogueAct: 'other', confidence: 0.95,
    rationale: '呼叫无内容' },
  { ...ACT, queryText: '在吗？帮我翻下琥珀协议那条决定。', expectedMemoryIds: [LIVE.amber],
    dialogueAct: 'request', confidence: 0.85, rationale: '呼叫+明确取回指令' },
])
group('cf-g55', 'low-info', EP.bm25, { parentWorkspace: 'ws/dsh-core' }, [
  { ...LOW, queryText: '谢谢！', dialogueAct: 'acknowledgement', confidence: 0.95,
    rationale: '致谢无需求' },
  { ...ACT, queryText: '谢谢。另外确认下 BM25 的 b 取值。', expectedMemoryIds: [EP.bm25],
    confidence: 0.85, rationale: '致谢+追加参数确认问句' },
])
group('cf-g56', 'low-info', EP.validator, { parentWorkspace: 'ws/dsh-core' }, [
  { ...LOW, queryText: '晚安。', dialogueAct: 'other', confidence: 0.95,
    rationale: '结束语' },
  { ...ACT, queryText: '睡前留个问题：明天先看 validator 字段清单，是哪些来着？',
    expectedMemoryIds: [EP.validator], confidence: 0.8,
    rationale: '预告+回忆问句' },
])

// ---- split assignment (pair-grouped) ----
const splitOf = (pairId) => {
  const h = parseInt(createHash('sha256').update(pairId).digest('hex').slice(0, 8), 16) % 10
  return h < 7 ? 'train' : h < 9 ? 'dev' : 'test'
}
for (const s of out) s.split = splitOf(s.pairId)

writeFileSync(process.argv[2], out.map((s) => JSON.stringify(s)).join('\n') + '\n')
console.log('samples:', out.length, 'pairs:', new Set(out.map((s) => s.pairId)).size)
const dist = {}
for (const s of out) dist[s.proposedAction] = (dist[s.proposedAction] || 0) + 1
console.log('actions:', JSON.stringify(dist))
const lang = {}
for (const s of out) lang[s.language] = (lang[s.language] || 0) + 1
console.log('langs:', JSON.stringify(lang))
const sp = {}
for (const s of out) sp[s.split] = (sp[s.split] || 0) + 1
console.log('splits:', JSON.stringify(sp))
