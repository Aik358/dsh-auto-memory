# 参考图视觉版 · 真实宿主集成

2026-09-30，已整合上游 `07e5490` / `3.2.4`。项目所有者随后提供十张 GPT 参考图，并明确允许突破旧白皮书与 demo 的视觉约束。本目录保留 `iter5` 技术名称，但最终视觉以该后续要求为准。

## 入口

使用加载本仓库的 DSH web，打开会话的「记忆」页。沿用上游 3.2.4 默认新款的行为，显式选择过经典版的用户仍保留经典；可点「新款」切入。顶栏选择仪器、编辑、活水，并独立选择跟随宿主、浅色、深色。专注查看可展开工作台，Escape 恢复内嵌视图。

主导航：工作台、记忆、任务、设置。技能、唤起回顾、外部来源与工作区关系归入记忆，日程归入任务，统计归入工作台，存储与维护归入设置。团队保留次级入口。轻面板和首次向导继续由宿主触发，不添加 demo 假入口。

## 源码与生成

- `ui.js`：外壳、导航、原文浏览、页签与请求生命周期。
- `settings-source.js`：共享设置控件唯一源；`settings-schema.js`、`settings-copy.js`、`settings-layout.js` 提供索引、字段描述与渐进布局。
- `views.js`：工作台、日程、唤起详情、交接材料、外部来源、笔记、检索和关系图。
- `skin.css`：局部作用域样式、浅色与深色、响应式布局。
- `../../tools/build-iter5-skin.mjs`：将源码嵌入 `lib/client.js` 的 `ITER5-GENERATED` 区间，并从当前上游经典设置、存储和技能组件生成独立新皮肤版本。replaceOnce 群要求唯一匹配；其余变换点在 G0-2 后同样响亮失败（源结构改变即 exit 2 并点名变换点），避免悄悄生成错误界面。

两条铁律（2026-10-02）：**R1 同步即通过** —— 生成器算出的产物与磁盘上的 `lib/client.js` 逐字节一致才是通过；**R2 失配即停机** —— 变换点失配、切片锚点消失、产物含无主内容，一律 exit 2 硬停，不允许静默生成、不允许告警后照写。

```powershell
# SOP 首位：R1 —— 先证明「源 × 生成器 == 产物」
node tools/build-iter5-skin.mjs --check     # 绿 ⇒ SYNC-OK；对产物做任一字节扰动都会非零退出
node tools/build-iter5-skin.mjs             # 需要重建时；orphan 非空 ⇒ exit 2 拒写（R2-b）
node tools/build-iter5-skin.mjs --force     # 只有确认那些行是垃圾、明确放弃时才用
node --check lib/client.js
node tests/smoke/smoke-test-iter5-skin.mjs
```

不要手改生成区。宿主继续只加载一个手写 `__ModuleLoader__` bundle，使用宿主 React；没有新增前端依赖、网络字体、构建服务或 mock API。山水图沿用已发布的 `hero.welcome` 素材路由，空状态为内联 SVG，没有把 demo 的 4.8MB 内联页面带入 bundle。

上游主题订阅、欢迎向导 Hook 顺序与自动接续切换会话修复均保留。整合时消除重复 Hook 和首屏插画；手写区摘要按上游 3.2.4 与已审查的共享入口接线重新登记。深浅偏好兼容旧 dam-skin-theme 值。

## 数据与行为

- 统计只来自宿主数据；文件数明确标为「文件」，不冒充记忆条目数。水位环不冒充健康评分。缺字段显示「—」或暂不可用。
- 记忆列表先取得当前工作区状态，再取文件列表；拒绝目录不一致的结果，文件读取绑定绝对来源路径。
- 检索模式单独即时写 `/config`。普通配置只提交实际修改键，保存失败保留草稿。发射模式仍走 `semanticEmit`，外观偏好仍走 localStorage。
- 关闭引擎提示观察数据清零；删除、修复和技能状态变更保留确认。拒绝或失败不显示成功。
- 接续复用当前上游 `runContinueFlow`，不复制宿主状态机。白板原文只读。
- 日程只有真实支持的新增、完成、删除；地点和提醒说明与现有客户端一样写入备注，不伪造系统日历同步或通知调度。
- 唤起详情只显示接口实际返回的概率、原因码和脱敏锚点。投递关联明确标注为启发式；没有把锚点前缀伪装成可打开的原文链接。

## 验证与限制

结果和截图见 `docs/ui-redesign-2026-09-25/INTEGRATION-RESULT.md` 与 `artifacts/iter5-integration/`。截图使用独立 DSH_HOME、独立工作区和显式验收数据，写入测试前校验记忆目录位于临时验收目录。

真实模型生成、完整跨会话接续、130MB/563MB 模型下载及 Desktop/Mica 尚未验收；这些能力保留上游实现。集成验收后按用户要求提交并创建 PR；未发布安装包，也没有替换日常 DSH profile 中的已安装包。


## 三种皮肤与明暗模式（2026-09-30）

顶栏和宿主设置标题栏提供独立选择：仪器 / 编辑 / 活水，以及跟随宿主 / 浅色 / 深色。选择仅保存于浏览器，刷新恢复；切换不重挂当前页面或清除草稿。经典回退继续使用原 dam-skin key，三种新皮肤共用上游新款入口。

实现：style-choice.js 管理偏好及主题覆盖，alternate-home.js 用同一首页数据渲染编辑/活水布局，style-variants.css 控制跨页与独立浮层外观。新增源文件需随生成器 fixture 一起维护。验证见 artifacts/three-skins-20260930/ACCEPTANCE.md。

最终参考、配色与验证见 [实拍验收](../../docs/skin-figures/iter5-final/README.md)。

## 共享设置与冻结契约（2026-10-03 V3）

经典工作台、冻结旧款与三个变体共用由 `settings-source.js` 生成的
`Iter5Settings`。经典 `SettingsPage` 和冻结 `Iter5Settings` 仅委托
`DamSharedSettings`，不再复制控件业务；冻结文件仍是其余旧款页面的唯一源。
宿主设置使用 `host` 草稿作用域，工作台与浮层使用 `workbench`。共享注册表按
session/workspace 与承载作用域隔离，外壳监听身份并按 key 重挂表单；表单固定
挂载时身份，旧请求与事件不能跨身份改草稿。

修改设置：改 `settings-source.js` 或相应描述/布局源，运行既有生成器；保留
冻结委托和宿主接线。`smoke-test-settings-parity`、`smoke-test-frozen-mirror`
与 `smoke-test-gap-rounds-three-surface` 检查源到实际共享实现、委托契约及真执行
数字规范化，负路径仍必须失败。不要把新设置逻辑重新拷回冻结或经典外壳。
R1 逐字节一致及 R2 失配停机保持有效。

共享表单自行注入 `shared-settings-base.css` 与 `settings-v3.css` 的局部结构规则；
经典/旧款仍从既有出口获得冻结配色，不能用整份变体样式覆盖它们。窄浮层依据
自己的容器宽度显示分区选择器。宿主字体与字号、原外观偏好及独立宿主底色规则
保持既有契约。

验证与完整入口迁移见 [V3 实现记录](../../docs/ui-v3-20261003/IMPLEMENTATION.md)。
