# DeepCode 兼容修复与同类问题复核

2026-10-05；基于 upstream/main `e260677`（3.2.9）。此分支修复代码与生成源，不发布安装包。

## 工作区和目录

上游 3.2.9 已修复工作台运行校验的 Android 路径别名误判，以及连续建立失败时的熔断。本次进一步修复遗漏入口：

| 问题 | 修复后行为 |
| --- | --- |
| 多层新目录尚不存在时，只解析直接父目录，仍保留别名 | 找到最近存在的祖先，解析物理路径，再拼回缺失后缀 |
| `/config` 对合法别名目录静默丢弃 | `workbenchRoot`、`memoryRoot`、`userMemoryDir` 均按物理路径判断是否位于 DSH_HOME 下 |
| 根目录中的符号链接可绕过上述字面包含校验 | 解析后确实落到根外的路径继续拒绝，不改变原配置 |
| 清理旧工作台时，将当前目录的另一种写法误删为旧登记 | 同一物理目录的登记保留；含会话的登记仍保留；缺失路径的登记不清理 |
| 接续会话按 cwd 查工作区时，别名匹配不到，落入未分组 | 保留 sessionIds 的优先级，再按物理路径寻找所属工作区 |
| Linux/Android 登记比较无条件转小写，可能混淆两个目录 | Windows 忽略大小写；Android/Linux/macOS 保留路径大小写 |
| `..phone` 等合法子目录名被当成父目录遍历 | 仅拒绝 `..` 路径段；合法子目录照常使用 |

截图中 C 盘与 D 盘若确实为不同物理目录，仍正确报告不匹配。已有“同意并建立”入口可建立目标目录下的工作台；不会将两处不同目录假装成同一处，也不会因此删除旧会话。

## 外观和手机布局

- 共享兼容样式由 `skins/compat/mobile.css` 提供，随生成器嵌入客户端，适用于基线、仪器、编辑和活水四款皮肤。
- 设置页使用实色背景、清楚的文字和边框，避免宿主侧栏和设置透字。
- 展开页使用视口高度及 Android 安全区变量。内容单独滚动，保存按钮保留在底部，页签可横向滚动。
- 控件容器可以收缩，检索按钮可以换行；“端到端加密档位”等长选项不再撑宽页面。
- 小屏下浮窗、引导和工作台确认弹窗使用实色背景，关闭模糊效果。
- 检测 `window.androidBridge` 和 DeepCode 的移动布局标记，兼顾手机端的宽屏模式；普通窄浏览器也有回落。
- 自动展开只触发一次。点击“返回宿主设置”或 Escape 后，尺寸监听不会立即重新展开。

DeepCode 接口依据其[公开源码](https://github.com/kelai141/dsh-mobile-apk)，包括 theme bridge 和移动样式。插件不修改宿主的主题桥接。冻结基线源固定为 LF，避免 Windows 检出改变换行后违反生成和主题同步约束。

## 已完成验证

- 修复前实际复现了路径配置丢失、当前登记误删、接续别名匹配失败、长下拉框将 320px 页面撑到约 502px，以及返回设置后反复展开。
- 46 个相关 smoke 套件：46 PASS、0 FAIL、0 TIMEOUT。范围为工作台、设置、皮肤、生成器、路由、接续、跨工作区、配置读写等；不是全仓全部测试。
- 新增路径测试执行完整 MemoryEngine 和真实注册的 `/config` HTTP handler，使用隔离临时目录与真实 junction/symlink；三种平台的大小写分支另外直接执行生产方法验证。
- 使用 Windows DSH 0.2.0-rc.2 的实际页面检查。320×720 下四款皮肤 × 深浅主题 × 四个设置页签，共 32 组，通过背景不透明、视口边界、横向宽度、底部保存可点击和内容滚动检查。
- 四个页签逐个打开可见折叠项（分别 4、12、5、17 项），宽度检查通过。另检查 390×844、320×420、1280×900 的实际页面尺寸。
- 在实际 UI 修改设置并保存，看到“已保存”，配置文件对应字段更新；点击返回后保持宿主设置页。工作台确认和记忆浮窗在 320px 下背景不透明且位于视口内。
- 入口语法、生成源同步检查通过。

重点复核命令：

```sh
node --check lib/index.js
node --check lib/client.js
node tools/build-iter5-skin.mjs --check
node tests/smoke/smoke-test-deepcode-paths.mjs
node tests/smoke/smoke-test-deepcode-ui.mjs
node tests/smoke/smoke-test-workbench-canon.mjs
node tests/smoke/smoke-test-workbench-create-breaker.mjs
node tests/smoke/smoke-test-workbench-gaps.mjs
```

浏览器只读探针保存在 `tests/browser/deepcode-ui-probe.js`，可在打开真实记忆设置页后通过 BrowserSkill 的 evaluate 运行。测试与页面检查结果、截图位于本地忽略目录 `.qa-deepcode/`。

上游标准 smoke runner 依赖的 `tools/smoke-impact.mjs` 在本次基线中缺失，因此使用隔离 DSH_HOME/HOME/USERPROFILE 的逐文件执行器运行上述相关套件。

**验收边界：未连接 Android 手机，未运行 DeepCode APK；浏览器尺寸检查不等于 DeepCode 真机验收。** 手机系统栏、安全区、软键盘和具体 WebView 版本仍需设备复测。未发布、未合并。
