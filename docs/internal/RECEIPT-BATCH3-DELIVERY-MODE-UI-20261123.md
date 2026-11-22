# 批次 3 · 投递模式设置页回执 · 2026-11-23

基线 `2275a99a`，分支 `preview`。在「接续与维护／行为与维护 → 投递策略 → 预设与节奏」加入三档单选。选中项反映草稿，「当前生效」反映配置回读。切换内容预设保留投递模式。编辑器沿用现有策略保存和删除入口。`units` 生效后，模块页和预算页显示对应的实际生效范围。

| 模式 | 事件渲染 | 组装方式 |
| --- | --- | --- |
| `legacy` 旧版投递 | 旧卡片、目录、摘要 | 按字符预算 |
| `eventView` 新版事件视图（推荐） | 新卡片、目录、摘要 | 按字符预算，缺省值 |
| `units` 按单位投递 | 新事件视图 | 按检查点等单位组装，应用模块设置和配额 |

## 变更与生成产物

改前用 `git show HEAD:<path>` 取字节，改后直接读文件。行数按原始换行计，SHA16 是 SHA256 前 16 位。

| 文件 | EOL | 改前 B / 行 / SHA16 | 改后 B / 行 / SHA16 | 增 / 删 |
| --- | --- | --- | --- | --- |
| `skins/iter5/policy-settings.js:595` | LF | 70,204 / 998 / `fc5ae9096da5df60` | 74,048 / 1,044 / `375c06cf828dbfe8` | 53 / 7 |
| `skins/iter5/policy-settings.css:74` | LF | 5,883 / 130 / `bb83e758a194617c` | 6,452 / 145 / `63cf14c109a7b5f2` | 15 / 0 |
| `skins/iter5/settings-copy.js:2` | LF | 25,211 / 95 / `fbeb841c5a7ae12d` | 26,028 / 104 / `035102185b5ff0cf` | 9 / 0 |
| `lib/client.js:21343` | CRLF | 3,049,150 / 27,445 / `4ded8a3c935801c2` | 3,055,034 / 27,500 / `f4363ecfb446daee` | 64 / 9 |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs:1567` | LF | 87,890 / 1,564 / `5e90015f7905b3b8` | 95,049 / 1,696 / `815314e5e9c4736f` | 134 / 2 |
| `docs/USER-GUIDE.zh-CN.md:159` | CRLF | 44,307 / 503 / `d33976221be97e6d` | 45,565 / 516 / `9ef0b993e6d95c51` | 13 / 0 |
| `docs/USER-GUIDE.en.md:159` | LF | 47,373 / 502 / `27a5c88d1691f0d8` | 48,683 / 515 / `0f6cea9ba7851bca` | 13 / 0 |
| `docs/internal/FEATURE-INVENTORY.md:18` | LF | 71,013 / 552 / `e8244d26594796ba` | 71,223 / 554 / `b8a0dd21e38c744a` | 3 / 1 |

两个 `ITER5-GENERATED` 标记之间的内容行数分别为 2,612 → 2,612 和 4,833 → 4,888。冻结皮肤的标记内字节相同，通过共享组件与生成在标记外的 `LEGACY_OVERLAY_EXTRA` 获取控件及样式。主生成区承担全部 55 行新增量。排除两个生成区与生成器管理的共享样式行后，客户端其余字节与基线一致。

第一次重生成时，R2 将被源修改替换的旧生成行报告为 orphan。对照干净的基线客户端与源文件差异，确认报告指向本次替换行后，使用生成器的 `--force` 重建。最终严格检查输出如下。

```text
SYNC-OK: sources × generator == lib/client.js
iter5 bundle source is up to date
```

`node --check lib/client.js` 与 `git -c core.whitespace=cr-at-eol diff --check` 均退出 0。客户端 factory 的执行证据见下文。后端、冻结名单和生成器文件的 `git diff --exit-code` 退出 0。

## §4 验收

### 1–2. 静态锚点与客户端运行时

两个生成区分别命中控件锚点 0 和 1 次。专项套件运行生成后的客户端 factory，检查中英文三档文案和可访问说明。测试实际点击单选，独立断言草稿高亮和当前生效值，并核对模式与节奏值经同一次 `{ deliveryPolicy }` 保存及回读。覆盖刷新、选预设保留模式、保存 `legacy` 与 `eventView`、删除策略和七个旧控件解冻。

```text
PASS 21 generated client contains exactly one delivery mode selector anchor
PASS 21b all three modes render distinct explanations in English and Chinese, with accessible descriptions
PASS 22 factory renders three clickable radios and confirms units and cadence in one save and config readback
PASS 23 factory reload restores units and supports saving legacy and eventView with frozen legacy fields
PASS 24 factory deletion restores the labeled eventView default and unlocks all seven legacy fields
Delivery settings UI guards: 30 PASS / 0 FAIL
```

### 3–4. 隔离 DSH 宿主保存、刷新与回滚

在 DSH CLI/Web `0.2.2-rc.5` 的独立 `delivery-mode-ui` profile 上使用 `127.0.0.1:19434`，通过宿主「设置 → 自动记忆 → 接续与维护 → 投递策略 → 预设与节奏」操作。验收后关闭浏览器和两个隔离端口。[宿主验收摘要](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/host-acceptance.json)

| 操作 | 实测 | 证据 |
| --- | --- | --- |
| 打开无策略配置 | 三档可选。新版事件视图选中，生效值显示「默认（未保存策略）」 | [默认状态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/mode-default.yml:116) |
| 点选按单位投递 | `units` 已选中，保存前「当前生效」仍为默认新版事件视图 | [草稿状态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/02-units-draft.yml:117) |
| 保存按单位投递 | 落盘字段为 `{"deliveryPolicy":{"deliveryMode":"units"}}`。页面显示「当前生效 · 按单位投递」 | [配置片段](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/config-after-units.json) · [三档截图](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/12-units-all-modes.png) |
| 刷新宿主页并重新打开设置 | `units` 仍选中，生效值仍为按单位投递 | [刷新后状态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/04-units-reloaded.yml:116) |
| 切回新版事件视图并保存 | 落盘字段为 `{"deliveryPolicy":{"deliveryMode":"eventView"}}`。页面显示此档已生效 | [配置片段](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/config-after-eventview.json) · [保存后状态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/06-eventview-saved.yml:117) |
| 从「兼容」删除策略 | 磁盘 `policyExists: false`，原 `injectEnabled: true`。页面恢复「当前生效 · 新版事件视图（推荐） · 默认（未保存策略）」 | [配置片段](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/config-after-delete.json) · [恢复默认状态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/13-default-confirmed.yml:177) · [三档截图](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/13-default-all-modes.png) |

有策略时，宿主把「让 AI 使用已有记忆」展示为只读值，并提供回滚入口。删除后恢复可编辑开关。完整七键的保存冻结与删除解冻由真 factory 守卫逐键核对。[保存态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/07-saved-legacy-controls.yml:90) · [删除态](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/11-legacy-unfrozen.yml:94)

### 5. 定向回归

| 命令或套件 | 实测 |
| --- | --- |
| `node tools/verify-docs.mjs` | `工具 22 · 路由 87 · 配置键 182`，退出 0 |
| `batch-y-frontend` | `PASS batch-Y frontend acceptance: 75 assertions` |
| `v5-p6-r4-scope-filter` | `SUMMARY  PASS 57 / FAIL 0` |
| `iter5-skin` | 28 条 PASS 输出，退出 0 |
| `settings-safety` | 10 条 PASS 输出，退出 0 |
| `client-loadable` | `[client-loadable] PASS 34 / FAIL 0` |
| `r26-cross-layer` | `PASS 26 / FAIL 0`，现有锁未改 |

### 6. 模型逐轮

从真实设置页保存 `units`，在隔离记忆库准备测试事件，再发起带 `DELIVERY_UI_UNITS_SEEDED_2` 标记的会话轮次。宿主向 `127.0.0.1:19435` 的本地 Anthropic Messages 协议夹具提交 `POST /v1/messages`。新增用户消息中实测有四行独立的「[检查点 #…]」单元标题，对应夹具序号 1 至 4，事件卡标题出现次数为 0。新增用户消息文本的 SHA256 为 `0d859d60084a9b79b1b8986231ac91876ccc24163c2b43af237797f3e695593f`。[脱敏请求摘要](/D:/dsh-auto-memory/artifacts/_delivery-mode-ui-20261123/evidence/provider-units-proof.json)

## 未验证

- 本轮真实宿主覆盖「自动记忆」设置入口。其他设置入口和英文文案采用 factory 守卫。
- 会话轮次使用本地模型协议夹具。外部模型、其他设备及全库回归不在本轮实测范围。
