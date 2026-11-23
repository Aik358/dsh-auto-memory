# R4 P4-2 截图核验报告（2026-11-11）

## 结论（分承载面，不合并成虚假总分）

- classic 宿主：真实维护文档清单、点击读取、revision 更新有截图证据；修复前正文在 `## 任务状态` 后被裁，不能宣称完整正文已验收。
- iter5 宿主：真实工作台「接续 → 当前任务」可打开维护文档，正文与 revision 更新均有清晰截图。
- classic 修复后正文：组件真执行已验证 `maxHeight:none`，并新增高度变异回归；修复后宿主浮层截图未闭合，不冒充通过。
- P4-3 无新增前端视觉面，不虚构截图。

## 环境

- 独立 DSH_HOME/profile r4hv，profile 通过 link:D:/dsh-auto-memory 加载当前源码；boardMode=legacy、ledgerDocEnabled=true。
- 合成维护文档 `ui-classic-261111-0001`；所有写操作均在 artifacts 隔离根内，未改真实记忆。
- 合成会话仅本地 UI 记录，`llmMs=0`，未发起模型调用。

## 截图与核验

| 文件 | 承载面 | 实测证据 | 判定 |
|---|---|---|---|
| classic-document-v1.png | classic 宿主浮层 | documentId、revision 8f3bea10；正文在固定高度内截断 | revision 列表通过；正文不完整 |
| classic-document-v2.png | classic 宿主浮层 | 点击刷新后 revision 43c523ff，更新时间与正文 revision 均变 | revision 更新通过 |
| iter5-document-v2-clear.png | iter5 真实工作台 | 维护文档正文、V2、revision 43c523ff；提示已关闭 | 通过 |
| iter5-document-v3.png | iter5 真实工作台 | 外部 V3 内容更新后刷新并重新打开文档，revision a85296ce、正文 UI_CLASSIC_BODY_V3_ITER5_REFRESH | 通过 |
| classic-document-v3.png | 初始化弹窗 | 不属于维护文档正文证据 | 不计入通过数 |

## 截图驱动修复

1. classic 真机刷新不生效：MemoryTabBody 的 plan 分支漏传 nonce ⇒ 修复为 h(PlanTab,{nonce:nonce})，新增真实路由测试与 nonce 变异。
2. classic 正文截断：共享 `.dam-content` 的 `max-height:220px` ⇒ 仅维护文档正文覆盖 `maxHeight:none; overflow:visible`，不改其他卡片。
3. iter5 首次截图被架构改版预告遮挡 ⇒ 关闭该隔离环境提示后重截清晰图，不把遮挡图当通过证据。

## 验证

- P4-2 新套件：14 PASS / 0 FAIL；9 CAUGHT / 0 MISSED（含 classic-body-height-cap-restored）。
- client-loadable：34 PASS / 0 FAIL，真实 factory 执行通过。
- iter5-skin：通过；classic 锁按套件自身 9-replace 管道重钉为 1,552,897 字符 / 0c28c65a…。
- build-iter5-skin --check：SYNC-OK。

## 未覆盖边界

- classic 修复后完整正文的真实宿主截图仍未取得；现有组件回归不能替代该截图。
- 未跑全仓回归；未启用生产 R4；未迁移、删除或接管真实记忆。
