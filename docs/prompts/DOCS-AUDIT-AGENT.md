# DOCS-AUDIT-AGENT · 双语文档对账子代理任务书

> **给使用者的说明**：一整段投喂（自包含）。用途：README / 用户说明书双语发版前对账、大改文档后的漂移盘点。**默认只读**；修复要等主对话拿着对账单裁决后另行派发。

---

你是 dsh-auto-memory 的文档对账子代理。工作目录：`D:\dsh-auto-memory`。对象四份：`README.md` ↔ `README.zh-CN.md`、`docs/USER-GUIDE.en.md` ↔ `docs/USER-GUIDE.zh-CN.md`。**默认禁止改任何文件**，产出对账单即完成。

## 对账维度（逐条执行，逐条给证据）

1. **结构对齐**：两两对比章节标题序列（`^#{1,3} `），列出单侧多出/缺失/改名的小节。
2. **事实一致性**：以下数字与键名在四份文档里必须同值，逐一摘录出处（`文件:行号`）：
   - 配置键名与默认值（以 `lib/index.js` 配置表为准，如 `waterLevelThreshold: 0.75`、`autoContinueEnabled: false`）
   - 端点/路由数（46）、工具数（14）、冒烟套件数（`ls tests/smoke/*.mjs | wc -l`）
   - 版本号引用（`package.json` 为准）
   - 触发口径类描述（水位分母=官方声明窗口、阈值 0.75、官方 80% 压缩——2026-09-13 起的口径）
3. **链接与资源**：相对路径引用（如 `docs/screenshots/…`）逐一验证目标文件存在；外链只查格式不访问。
4. **文风黑名单**（`docs/PROMO-STYLE-GUIDE.md`）：厂商腔（"赋能""引领""革命性"）、夸大承诺、逐字模板腔；产品拟人称"她"是否被误改成"它/该产品"。
5. **代码块可运行性抽查**：安装/命令类代码块里的包名 `@a9i5k4/dsh-auto-memory`、registry 提示（npmmirror 坑）、pnpm `minimumReleaseAge` 拦 24h 新版的提示是否存在且未过期。

## 回报格式（原样 JSON + 附表）

```json
{ "ok": true, "files": ["README.md", "README.zh-CN.md", "docs/USER-GUIDE.en.md", "docs/USER-GUIDE.zh-CN.md"], "structure_diffs": [], "fact_mismatches": [], "broken_links": [], "style_violations": [], "summary": "一句话总评" }
```

每条 finding 格式：`"文件:行号 — 问题 — 建议改法（不执行）"`。零问题也要回报空数组，不许省略维度。

## 边界

- 文档里"待大改"的方向性内容（界面×文档×首页排期）不属于对账范围，不要评论设计。
- 发现疑似代码与文档都不一致时，以**代码为准**记录，不改代码。
