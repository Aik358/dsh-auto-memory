# 批次 2 · 2.5–2.8 实现与隔离验收记录（2026-11-12）

## 范围与生产边界
本批只改源码、测试和施工记录；验收时未提交、未 push，现已随前置 R4 P5/A1 一并提交 `45a7f905`（未 push）。未改生产记忆或 19387，未执行迁移、归并、删除或生产开启。2.3/2.4 未启动。真实模型行为、HOST、跨设备仍属未验证。

## 分线结果
- **2.5**：独立合并 13 PASS/0，3 变异捕获；真实 MemoryEngine/memory_event 18 PASS/0；锁与合并变异 9 PASS/0、2 变异捕获。新增 planAutoRedrawEnabled=false，显式开启才重绘；锁内按真实事件 ID 继承 memId、保留自有卡/user 备注、sidecar 刷新，失败独立回执。
- **2.6**：真实 memory_note 22 PASS/0，基础归属 7/0、事件库 96/0、h2 48/0、A1 24/0。仅旧 Phase1 透传 eventId；active/paused 接受，closed/未知/非法统一 event-id-unavailable 且零文档副作用；缺省旧行为保留。
- **2.7**：指针 46 PASS/0、3 变异捕获；真实 memory_recall 下钻 25 PASS/0。sourceRef 仅受信 handoff 根，raw/normalized full64；缺强指纹回显旧 checkpoint，不把当前 PLAN 冒充历史。
- **2.8**：无 IO 预检 19 PASS/0、3 变异捕获；真实工具集成 17 PASS/0。确定性拒绝在事件检查点前，M1 仍放行；正式锁/CAS/终检与补偿保留；R4 无第二 Phase0。

## 修正记录
- A1 create 返回顶层 revision，原工具投影只读嵌套字段导致 revision null；已兼容两种真实结果形状。
- 预检 CAS/M1 的集成夹具须按写入器分配锚点后的 revision 与幂等语义计算，不能用旧 revision 或错误输入推测。
- 自动重绘在 PLAN 锁内以当前 existing 的 revision 提交 CAS；普通 fromEvents 手动路径不改。
- 事件工具抽取壳补新依赖；测试错误与产品错误分别归因，未删负路径。

## 基线
lib/index.js 顶层导出 27、路由 86，保持 CRLF、无裸 LF。r26 按自身 LF 管道复算：IX 1,613,855 / SHA16 686CF32DEA5B0521；新配置 planAutoRedrawEnabled 默认 false。

## 尚未完成
无生产启用证据、真实宿主/真实模型/跨设备验证、G-1 容器/G-2 摘要、2.3/2.4 或发版；Git 检查点已完成但未 push。新开关若启用须另做隔离宿主或用户明确授权验证。
