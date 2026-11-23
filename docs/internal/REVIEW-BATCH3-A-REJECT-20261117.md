# A 批验收结论：不通过（退回）

## 一、落盘前检查：通过

| 项 | 结果 |
|---|---|
| 锚点（含 eol）唯一命中 | **51/51**（上批 7/9 失败，本批已修复） |
| `lib/index.js` 是否被改动 | **否**（符合硬约束） |
| 导出符号数 | 各模块未减少 |
| 语法 | 全部模块 `node --check` 通过 |
| 落盘指纹 | 与 patches.json 声明一致（验证器拒绝重复应用，反证正确） |

**交付规范的进步值得肯定**：eol 标注、SHA256SUMS、STATIC-REVIEW、mutations.json、分离的 cases-*.mjs，比上批明显更严谨。

## 二、★阻止合并的原因：8 个既有套件由全绿变红

用 `git stash` 做补丁前/后对照，同一套件、同一台机器：

| 套件 | 补丁前 | 补丁后 |
|---|---|---|
| cadence-projection | 97 PASS / 0 FAIL | **68 / 29 FAIL** |
| events | 86 PASS / 0 FAIL | **80 / 6 FAIL** |
| sources | 64 PASS / 0 FAIL | **63 / 1 FAIL** |
| final-frame | 93 PASS / 0 FAIL | **抛错退出** |
| consolidate | 66 PASS / 0 FAIL | **抛错退出** |
| event-frame | 通过 | **抛错退出** |
| notification-store | 通过 | **抛错退出** |
| consolidation-boundaries | 通过 | **抛错退出** |

这不是"判据过期"，是**修复改变了既有契约**，且未同步更新消费者。

## 三、四类根因

### 1. `finalizedText` 变成必填，但既有调用方不提供（影响 3 个套件）

```text
injection-missing-field  field: 'finalizedText'
```

F13 要求"定稿核对最终文本"方向正确，但实现把 `finalizedText` 设为**强制字段**。既有 `notification-store` 与 `final-frame` 套件的调用都不传它 ⇒ 直接抛错。

**要求**：新增字段应为**可选**，缺失时走兼容分支（如按旧行为不核对，但记 degradation），不得让既有调用方崩溃。

### 2. CA 缺省水位语义被改（影响 cadence-projection 29 条）

失败样例：
- `缺省配置 waterPct=26 ⇒ water-25 授予 full` —— 未通过
- `全非法串 'abc' ⇒ 回落缺省 [25]` —— 未通过
- 显式 `'25,50'` 双档行为 —— 未通过

**F12 只要求**「非真人信号不授予 full；slim 间隔生效；缺省值可配」。**没有授权改缺省水位档位语义**。请确认是否越界；若是，请回退这部分，只保留真人门与节流。

### 3. EV 状态过滤语义被改（影响 events 6 条）

失败样例：
- `status=active ⇒ 进卡片` —— 得到 0
- `status=paused/closed/archived ⇒ 不展开，只进目录` —— 得到 0
- `重复 id 去重` / `重复 id 记 warning` —— 未通过

**F17 要求**「保留旧可见性政策」。当前实现把归档/关闭过滤逻辑改动了，active 事件都不进卡片，属功能倒退。

### 4. RC 候选分类与 CO 边界（各 1 条）

- `含「参考历史」语境 ⇒ 计入 candidate` —— 得到 0
- `consolidation-boundaries` 期望 1 实际不同

## 四、退回要求

1. **不得以"更新测试"解决**。既有套件锁的是行为契约；除非能证明是判据过期（契约本身被有意改变且有裁定依据），否则必须改实现。
2. 修复后请**自行用 `git stash` 做补丁前/后对照**，确保：
   - 原有 8 个套件恢复 0 FAIL
   - 新增行为有独立用例覆盖
3. 如果某处确实必须改变契约（例如 `finalizedText` 必填），请在交付说明中**显式列出**并给出理由与影响面，由 Lead 裁定，不要默认改掉。
4. 保持本批已做对的部分：eol 标注、锚点唯一、不动 `lib/index.js`、指纹一致。

## 五、当前状态

- A 批改动**已从工作区撤下**（`git checkout -- lib/injection`），仓库回到 `96bfded8`
- `dto.js` 15,834B、CA/PJ 套件 97/0 已复核恢复
- B 批仍等待 A 批通过

## 六、已确认修好的（供参考，勿回退）

- **F14**：`capChars:1` 由静默返回 7 字符改为抛 `hard-cap-unsatisfiable`（含 `requiredChars:10`）——符合验收出口
- **F13 方向**：文本不含通知时 `selectedNotificationIds` 已为空数组
- **F19 版本**：`policyVersion:999` 已被拒（`version mismatch`）
- **F18 档位**：`INJECTION_TIERS` 已含全部 8 个生产档位
- **F08**：候选文件不再被提前读取（此前的"读 2 次"为正常规则文件读取，是我探针误判）

> 注：F19 的 `promptChars` 一条**系我方误报**——该参数不是 `buildConsolidationPromptPre` 的入参，函数已有 `truncation` 字段负责该职责。请忽略上批该条。