## python-setup

- **规模**：22,620 B / 393 行 / 1 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M7.6 Python 一键向导（host 半）**。把 C3 进阶档从"开发机可达"变成"爱好者可达"。四步链路全走本模块：①detect（探测系统 Python ≥3.9 / 既有 venv / 模型本体，全只读）；②venv（幂等，已存在跳过）；③deps（venv 内 pip 安装，清华镜像兜底；int8 档不需要 torch）；④model（BGE-M3 int8 ~539MB 下载，cn/intl 双通道 + SHA256 校验）；④' 模型齐备后**必须回写 `embedding-config.json`**，否则 worker `load_embedder` 抛 `unknown embedding provider` —— 这是"装了用不了"的头号断点。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L62 | `createPythonSetupPre(...)` | 向导工厂（四步链路） |

### 数据流

```
createPythonSetupPre(...)  L62   ← 四步链路，UI 只管展示状态与点击
  ① detect  探测系统 Python(≥3.9) / 既有 venv / 模型本体     （**全部只读**）
  ② venv    python -m venv <userDir>/python-engine/.venv     （**幂等**：已存在直接跳过）
  ③ deps    venv 内 pip 安装 transformers/onnxruntime
              （清华镜像兜底；**int8 档不需要 torch**）
  ④ model   BGE-M3 int8（约 539MB）→ <userDir>/python-engine/models/
              cn(hf-mirror) / intl(hf 官方) 双通道 + **SHA256 校验**
  ④'        ★ **必须回写 embedding-config.json**
              （provider / modelDir / onnxFile / dimension）
        │
        ▼
   依赖 memoryDir（datadir.js 第 1 行 import）
```

### 内部关键实现

**1. "装了用不了"的头号断点（文件头逐字）**

*模型齐备后**必须回写 embedding-config.json**（provider / modelDir / onnxFile / dimension），否则 worker 的 load_embedder 抛 unknown embedding provider*。

**2. 四步全幂等**

② venv 已存在直接跳过；③/④ 有既存检查。⇒ 用户重复点"一键安装"不会破坏既有环境。

**3. 与用户铁律的边界**

用户硬规则：**JS 端语义模型 = 默认形态；Python 端 = 发烧友主动安装的进阶项；两者是两项相对独立、可互相替换的功能，严禁混为一谈、严禁互相联动**（不得让选一个就开关另一个，不得让一个的存在成为另一个生效的前提）。本模块的一切改造都必须守住这条。

### 可直接落地的代码片段

**插入位置**：python-setup.js:62 附近的 `createPythonSetupPre`。

```js
/**
 * 团队成员的引擎就绪状态 —— **只上报状态，绝不同步环境**。
 *
 * 为什么不同步环境：venv 路径、系统 Python 版本、模型文件路径都是平台/机器相关的；
 * 模型本体还有约 539MB，且各平台 ONNX 产物不同。同步它既不现实也无意义。
 * 团队真正需要知道的是"这名成员的语义臂能不能工作"，从而解释检索质量差异。
 *
 * @param {object} probe 探测结果 { pythonOk, venvOk, modelOk, provider, dimension }
 * @returns {{ready:boolean, summary:string, gaps:string[]}}
 */
export function teamEngineStatusPre(probe) {
  const p = probe || {}
  const gaps = []
  if (!p.pythonOk) gaps.push('python-missing')
  if (!p.venvOk) gaps.push('venv-missing')
  if (!p.modelOk) gaps.push('model-missing')
  const ready = gaps.length === 0
  // 注意措辞：状态是"本机语义引擎"，与团队记忆是否可用**无关**（JS 端可完全替代）
  const summary = ready
    ? ('本机语义引擎就绪（' + String(p.provider || 'unknown') + ' / dim=' + String(p.dimension || '?') + '）')
    : ('本机语义引擎未就绪：' + gaps.join(', ') + '（不影响团队记忆读取，JS 引擎可替代）')
  return { ready, summary, gaps }
}
```

### 关联行号索引

- lib/python-setup.js:62

### 与团队化的关系

**判定：私有（Private）· 设备级安装。**

Python 环境是**每台机器各自安装**的（系统 Python、venv、模型文件路径都不同），无法也不应同步。

### Teamwork 改造要点

1. **安装状态可上报、环境不可同步**：团队面板可显示"该成员语义引擎已就绪/未安装"，但绝不尝试同步 venv 或模型文件（539MB + 平台差异）。
2. **`embedding-config.json` 回写是不可跳过的步骤**：注释明确它是"装了用不了"的头号断点。团队化新增任何配置项都要纳入这条回写链。
3. **fail-soft 与 `memoryDir` 依赖**：本模块 `import { memoryDir } from './datadir.js'` ⇒ 目录收口变更会直接影响它。

### 风险与回归

- 回归：四步链路各自幂等（重复执行不得破坏既有安装）。
- 模型下载有 SHA256 校验——不得为"快一点"而跳过。
- 用户硬规则：**不得与 JS 语义引擎联动**。
