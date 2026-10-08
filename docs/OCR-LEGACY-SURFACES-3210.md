# 3.2.10 旧皮肤与设置层复核

范围：`v3.2.10` 起的 PR #240 全部差异，另查旧皮肤、变体、经典入口的共享样式安装、选肤持久化和对话框层级。使用 OCR delegation 的 preview 和逐文件 rule，由宿主代理执行审查；没有调用 OCR 的外部模型端点。

## 已修复的发现

以下为修复前发现，修复后没有剩余可操作的审查意见。产品路径和记忆写入逻辑没有参与本轮旧皮肤修复。

```json
[
  {"path":"lib/client.js","content":"旧玻璃规则清空展开设置背景，宿主深色和插件浅色底板混用；统一加载宿主设置适配并隔离设置主题。","category":"bug","severity":"high"},
  {"path":"skins/legacy/overlay-glass.css","content":"宽泛的非 page/settings 选择器仍给向导和其他入口写入半透明令牌；改为只允许 panel，并从手写客户端提取为生成器的 canonical source。","category":"bug","severity":"high"},
  {"path":"tools/build-iter5-skin.mjs","content":"两份共享安装器仅在挂载时写入 CSS，换肤后可能继续使用旧表；增加同页事件、跨页 storage 同步及卸载清理。","category":"bug","severity":"medium"},
  {"path":"skins/iter5/style-choice.js","content":"经典模式下选择变体只修改 family 键，保留 classic 模式；使持久化选择同时更新模式，只读跨页同步仍不写回。","category":"bug","severity":"medium"},
  {"path":"lib/client.js","content":"替换全局皮肤表时追加到共享设置表后方，变体的 static 保存栏规则覆盖 sticky 适配；替换时保持全局表在共享表之前。","category":"bug","severity":"medium"},
  {"path":"skins/legacy/iter5-325.js.frozen","content":"旧对话框的 zIndex=11000 低于展开设置，可能被遮挡；与变体统一为 2147483200 并执行实际函数验证。","category":"bug","severity":"medium"}
]
```

## 文件覆盖

OCR 范围预览的统计：`total_files=25`（包含工具排除的文件），`reviewable_files=16`。审查汇总以可审查文件为分母：`total_files=16, reviewed_files=16, skipped_files=0, coverage_rate=100%`。另外 9 个工具排除项全部人工补查，不计作跳过。

| 可审查文件 | 复核结果 |
| --- | --- |
| `.gitattributes` | 冻结源的 LF 约定，无业务影响 |
| `lib/client.js` | 手写改动、生成产物与两份实际函数已复核 |
| `skins/iter5/host-settings.css` | 宿主颜色、布局、保存栏及水平溢出已实测 |
| `skins/iter5/surfaces.js` | 宿主主题隔离、展开与返回、首次测量已执行验证 |
| `skins/iter5/style-choice.js` | 模式与 family 一致，只读同步不写回 |
| `skins/legacy/overlay-glass.css` | 全部选择器只允许 panel，有越界负对照 |
| `tests/browser/settings-expand-probe.js` | 检查计算样式、对比度、几何和实际点击位置 |
| `tests/browser/legacy-surface-probe.js` | 检查实际表标记、顺序、CSSOM 越界及可见浮层底板 |
| `tests/smoke/smoke-test-deepcode-paths.mjs` | URL 到本机路径的转换，无产品路径改动 |
| `tests/smoke/smoke-test-inj2-full-every-slims-migrate.mjs` | URL 到本机路径的转换，无产品迁移改动 |
| `tests/smoke/smoke-test-iter5-skin.mjs` | canonical 生成同步、主题同步与手写段快照 |
| `tests/smoke/smoke-test-settings-expand.mjs` | 两份实际组件及安装器、卸载、延迟测量与返回 |
| `tests/smoke/smoke-test-r15-left-rail.mjs` | 仅豁免与源逐字一致的玻璃常量，保留至少 90% 扫描及负对照 |
| `tests/smoke/smoke-test-skin-pluggable.mjs` | 用函数边界取块，原有互斥／负路径断言保留 |
| `tests/smoke/smoke-test-legacy-surface-isolation.mjs` | 实际函数、双安装器、双对话框、事件清理与层叠顺序 |
| `tools/build-iter5-skin.mjs` | 源文件生成、双实现同步，既有保护门禁保留 |

人工补查的工具排除项：冻结旧源 `skins/legacy/iter5-325.js.frozen`、本文与 `docs/SETTINGS-EXPAND-3210.md`，以及 `docs/screenshots/settings-expand-3210/` 的 6 张 PNG。冻结源保留前轮设置主题隔离和首次测量修复，本轮仅新增对话框层级调整；截图均通过图像查看器核对，文档与最终验证记录一致。

## 验证与边界

- canonical 生成 `--check` 同步、JavaScript 语法与 diff 空白检查通过。
- 独立 Windows DSH 宿主：120 组设置和 10 组向导首屏检查通过。五种皮肤、两种宿主主题、三种设置布局、四个页签；工作台主题与宿主相反。
- Linux 全量 smoke：292 通过、0 失败、0 超时。
- Windows 全量 smoke：290 通过、2 失败、0 超时；两项为本机文件符号链接 `EPERM`，未修改发布树同样失败，未弱化断言或改系统权限。
- 首轮 96 组结果遗漏活跃皮肤表验证，已明确纠正；最终矩阵同时检查皮肤身份和 CSS 顺序。
- 完整矩阵逐组记录与浏览器捕获分开。最终短捕获 25 操作且无丢弃；网站无 error，1 条资源错误来自浏览器扩展。长捕获有操作丢弃，不宣称完整轨迹。
- 旧对话框高层级经过实际函数执行验证；没有单独强制触发其与展开设置同时出现的真人流程。
- 未连接模型，未建立工作台，未访问个人记忆库；没有 Android/DeepCode 真机验收。没有制作安装包或发布版本。
