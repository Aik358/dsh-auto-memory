# 批次 5 Phase 0 · 铭文测绘与中英对照

2026-11-23（香港时间）。源码基线为 `preview@d0862b9a`，批次 5 交付限于本报告。

## 结论

**建议改铭文，先保留中文。** 当前已经有「仅实质产出才做」的总闸，但「进展」与「完成」缺少统一的判断尺度。事件归属、追加、更新和关闭分散在长段里。缺少「写到这里就停」「现有工具已原子写入就跳过」的明确判断。已有八个编号段，⑧ 出现在 ⑦ 前。渲染后的完整铭文是 **1,675 JS 字符、3,034 UTF-8 字节**，约占默认 8,000 字符快照预算的 **20.9%**。420 字符的注释已经过期。将总闸、单轮事件写入、账本前置条件与停止条件放在一起，优先删重复散文。

**英文版慎用。** 本报告的等义样稿在保留锚点后有 3,505 JS 字符和 3,661 字节，分别比中文正文多 109.4% 和 20.7%。同口径估算输入 token 多 52.2%。语言切换还要验证模型按顺序调用工具和正确跳过写入。

**按计划 §5(5) 单独报缺陷。** 工具名与列出的枚举均有效，调用示例却省略了必填项。⑦ 的 `memory_recall(scope=archive)` 缺 `query`，② 的事件召回和日志预检也有同类问题。隔离 profile 下执行已注册的工具，复现了两条写入拒绝。只传 `kind=plan` 返回「content 为空,未写入」。R4 开启时，`kind=handoff` 即使给齐四段，缺少文档定位仍被拒绝。实际铭文与工具行为留待裁定。

## 一、逐条核对

下表按屏幕实际出现的顺序。总闸位于 `lib/index.js:1599`，只读或闲聊时整组跳过。这是给模型的文字指令。渲染器本身不会按工作类型剔除个别条目。

| 段 | 位置 | 摘要 | 能否答是或否 | 跳过条件与空白 |
| --- | --- | --- | --- | --- |
| ① | `index.js:1600` | 分类写今日日志 | 部分。四个 kind 可选，何时需要单独日志由总闸判断 | 继承总闸。无「同一检查点已承载事实」判断 |
| ② | `index.js:1601–1610` | 白板、账本与事件 | 部分。改文件和白板不符可核查。实质进展、归属与关闭混在同段 | 仅补一条可复用结论时走 note。归属不确定才预检。无每轮合并上限、关闭前确认与明确停止点 |
| ③ | `index.js:1611` | 查技能并沉淀新流程 | 部分。多步、跑通、已有条目可分别判断。「确信可复用」需证据 | 非多步可跳过查流程。未跑通可跳过沉淀。无命中旧技能却也没有可复用流程时的显式终止 |
| ④ | `index.js:1612` | 标记失效或恢复 | 能。是否确认有后继、原结论错误或标错 | 只有发生对应状态变化才触发。缺明确旧 `memoryId` 的跳过条件 |
| ⑤ | `index.js:1613` | 按标签落看板泳道 | 能。是否要求文本进入特定泳道 | 仅在写供看板分列的白板或账本时有义务。其他文本未明确说可跳过 |
| ⑥ | `index.js:1614` | 客观语体与内容筛选 | 不是独立工具动作。可作为写入正文时的验收 | 没有正文时自然无动作，未显式写出 |
| ⑧ | `index.js:1615` | 归并未入事件的账本 | 能。注入面是否出现「存量未归档」 | 明确无提示即跳过。提示是否出现受模式和预算影响 |
| ⑦ | `index.js:1622` | 定位并读取归档原文 | 能。是否需要旧日志。只列目录与取全文可区分 | 隐含仅在取旧日志时触发。检索缺查词及未命中终止条件 |

### 可合并项与保留边界

| 可合并 | 重复点 | 合并时必须保留 |
| --- | --- | --- |
| ① 与 ② 的事件归属、写入条件 | 一份事实可能同时触发日志、检查点与账本 | 日志 kind 与事件 id 是独立信息。账本有原文价值时仍要写。把同轮进展合成一个检查点，避免重复日志及已由一次原子调用完成的动作 |
| ② 的 `create/append/set/close` 与末尾归属条款 | 两处都要求显式 `eventId`，都讨论误挂和拆分 | 批次伞优先，同标识不同工作线不挂，`founding` 只用于首检查点。顺序要保留先确认归属，再追加，事件头有变化时才 set，确已完成再 close |
| ② 和 ⑤ 的四段与工具名 | 账本写法和看板落列都提到四段。handoff 调用重复出现 | 账本标题和 tag 属于文档格式，事件头与检查点的四段键各异。合并后不能把它们写成同一个 schema |
| ③ 的流程沉淀和 ② 的单条可复用结论 | 都在提示跨轮复用 | 流程要有步骤与 `successCriteria`，结论可进项目笔记，已知旧流程按 id 更新 |
| ⑥ 与各种写入条款的复用要求 | 写法散见，⑥ 没有独立动作 | 客观语体和筛选要求作为准备写入后的约束，保留路径与可核对结论 |
| ⑦ 与 ⑧ | 都使用「归档」 | ⑦ 是归档旧日志的只读取回。⑧ 是账本归入事件的写入，不能合成同一动作 |

## 二、注入链路与预算

- `lib/index.js:13833` 以 `pushPart('otherDynamic', 'frame-inscription', …, 'must')` 生成完整动态帧候选，位置在 `:13834` 的收尾段之前。前缀的一个 LF 来自此处，⑦ 自带另一个 LF。
- `index.js:12728–12733` 读取非空 `promptLayerOverrides[key]`，否则用默认中文词条。界面语言与这里的选择无关。日期按插件记忆日计算（`:9795`）。同一记忆日内默认铭文稳定。跨日或覆盖文本变化会改变尾部内容。本报告量默认词条。
- `index.js:24152–24154` 在 `systemPrompt.context()` 注册动态上下文。设计为 **user-role、追加在历史尾部**。`:25395–25402` 注册独立的固定 system 段。按 `:1596–1597`、`:10923` 和 `:24152` 的设计，尾部变化本身不改早先系统前缀字节。历史投影内容相同时由宿主去重。实际 provider 缓存命中率尚未测。
- 完整候选在 `:24334` 生成，精简候选在 `:24367` 生成，下游按节奏及水位选实际尾注（如 `:25325–25358`）。默认完整和精简节奏分别为 40、15 次模型请求，step 计数跨对话轮推进（`:24337–24338`、`:24548`）。字符模式的精简路径用独立维护提醒（`:11154`）。动态总闸也可跳过整帧（`:24159–24180`）。已有隔离宿主记录里，部分请求只在历史消息里保留铭文。因此「每轮提醒」不等于每模型步都新增完整铭文。
- 字符组装将铭文作为 `must` 段保留，最终 transport 仍可拒投整帧（`lib/memory-envelope.js:148`、`index.js:24368`）。`units` 的铭文随 `lib/injection/unit-delivery.js:527–528` 的可选段预算裁决。只放入铭文的纯组装夹具，在硬上限 1,674 时省略整段并报告 `frame-content-omitted`，1,675 时完整保留。生产帧还要计入其他段。

| 量取范围 | JS 字符 | UTF-8 B | 估算 token |
| --- | ---: | ---: | ---: |
| 主模板原串，包括 `{date}`，不含 ⑦ | 1,511 | 2,802 | 648 |
| 主段代入 2026-11-23 | 1,515 | 2,806 | 649 |
| ⑦ 归档段，含本身 LF | 159 | 227 | 58 |
| 主模板 + ⑦，尚未代入日期 | 1,670 | 3,029 | 706 |
| 主段渲染 + ⑦ | 1,674 | 3,033 | 707 |
| 完整候选，加 `pushPart` 前导 LF | **1,675** | **3,034** | **707** |

可复算方法是从词条定义取 JS 字符串字面值，用 `memToday()` 的日期值按 `L` 的替换规则代入，执行 `s.length` 和 `Buffer.byteLength(s, 'utf8')`。1,674 口径 SHA256 为 `7ed1653146d11110f8e3e416d9c2a4233467dc71eec648862d4f57d0cc2339a1`。1,675 口径 SHA256 为 `8a115451a718a71a9b5369d7b06128e976fc06f38524aad3e4b6e0bb655c244d`。Lead 的落点、1,511、1,515、1,674 和注释位置均复现。420 与不含⑦的 1,515 相差约 3.6 倍，与完整候选相差约 4.0 倍。

token 估算将 ASCII 码点按 0.3，非 ASCII 码点按 0.6 加权后四舍五入。中文散文率与英文散文率参考 DeepSeek 官方 Token 用量说明。将标点、工具参数和空白归入同组只是近似。插件中的向量 tokenizer 用于检索，未作为当前聊天 provider 的计费 tokenizer。实际输入 token 还受分词、消息封装和段间边界影响。来源：[DeepSeek API Token 用量](https://api-docs.deepseek.com/quick_start/token_usage)。

## 三、工具契约及缺陷

| 项 | 结论与依据 |
| --- | --- |
| ① `memory_log` | kind 确认是 `rule / preference / fact / todo`，缺省 `fact`（`index.js:25458–25465`）。日志必填 `note` |
| ② 显式归属及预检 | schema 接收 `eventId`、`dryRun:boolean`，并要求 `note`（`:25459–25466`）。`memory_log(dryRun:true)` 只能作提示短写，直接照抄缺必填。下游 `:25787–25808` 在写入前返回预检结果 |
| ② `memory_event` | action 有 `create / set / append / close / rename` 五档（`:26843–26845`）。铭文提到的四档都有效。`create` 需有效 `name`，其余相应调用需 `eventId`，`append` 的检查点应提供 `kind` 与 `goal/state/dead/next` 等内容，`set` 至少一个可变字段，`close` 需要 `outcome`（`:26848–26866`、`:26958–27028`）。事件头为 `goal/doing/deadend/next`。工具说明在 `:26843` 要求 close 前 set summary，且仍有下一步不可 close，铭文只说「做完了」，缺关单判据 |
| ② 交接账本 | `kind=handoff` 合法。R4 维护文档路径要求已有文档的 `documentId + expectedRevision`，或首建时 `documentId + createDocument:true + eventId`，也可按 `maintenanceTopic` 决定稳定 id（`:25458`、`:26040–26054`、`:26217–26264`）。**缺定位的裸调用会被拒绝**。同一工具的 `:26001` 允许四段和四类感知原子落盘。重复 append 之前须核对是否已写 |
| ② 白板与项目笔记 | `kind=plan`、`kind=note, action=append` 合法（`:26001–26008`）。手写 plan 整篇前先读版本，CAS 检查使用 `expectedRevision`。`fromEvents:true` 可从事件投影生成，源码还给事件写入后的重绘通路（`:26015`、`:26908–26954`）。「白板不符一定手工调用 plan」忽略了投影或先决数据 |
| ② 事件完整经过 | `scope=events` 可用，但 `query` 必填（`:26603–26606`）。普通召回是命中摘要。完整检查点还需 `expand`、同值 `eventId` 与 `checkpointIndex` 或 `idemKey`。**缺必填且短写夸大读取粒度** |
| ③ 技能与记忆 | `memory_procedure_list`、`memory_procedure` 可调用。后者 action 是 `write / activate / update`，update 需 `procedureId`，新写或直接激活需 `title + steps`，`successCriteria` 决定可否晋升（`:27061–27073`、`:27384–27388`）。`memory_note`、`memory_user`、`memory_rules` 均存在。`memory_rules` 改或删需 list 取得的 `expect`（`:26506–26512`、`:26793–26800`） |
| ④ 失效和恢复 | `supersedes`、`retract`、`restore` 是 `memory_note` 的 id 数组，`retractReason` 为可选说明（`:26021–26025`、`:26496–26498`）。铭文中的 `=` 短写不提示工具归属、id 类型或数组形状 |
| ⑤ 看板 tag | 四个 tag 均合法，见 `lib/wb-sidecar.js:752–755`。同模块 `:774–780` 还支持按段名和标题归类。tag 可消除标题猜测，属于可靠路径。省略后并非必然落空 |
| ⑦ 归档 | **schema 缺项。** 对照 `:1622` 与 `:26604–26605`，仅传 `scope: 'archive'` 缺必填 `query`。正确参数形状由现有工具说明给出 `{ scope: 'archive', query: '关键词' }`（`:26577`）。`memory_read(kind=archive)` 列目录，带 `name` 取正文，超过 8,000 JS 字符时只返回前段，铭文所说的「取全文」超出实际契约（`:26535–26577`）。30 天是 `memory_maintain` 的缺省阈值，它允许显式 `days`（`:26616–26619`），有旧日志并不保证维护已执行 |
| ⑧ 存量未归档 | `index.js:13493–13507` 只在有数据时构造提示，指向处理账本归属。`units` 的事件文本段映射与结构候选策略可能去掉这条文字（`unit-delivery.js:18`、`:22`、`:278–290`）。因此把「没看到提示」解释为本轮不做，不能用来判断磁盘肯定没存量 |

## 四、中英对照

中文基准与英文附件均代入 2026-11-23，两者包含 ⑦ 并排除帧额外 LF。附件保留当前动作、参数短写、锚点及原有歧义，只试翻译。它不得作为工具参数示例直接执行。

| 口径 | 中文版 | 等义英文稿 | 差异 |
| --- | ---: | ---: | ---: |
| JS 字符 | 1,674 | 3,505 | +109.4% |
| UTF-8 B | 3,033 | 3,661 | +20.7% |
| 估算输入 token | 707 | 1,076 | +52.2% |
| 每帧均投递 × 100 帧 | 70,700 估算 token | 107,600 估算 token | +36,900（+52.2%） |

中文由 991 ASCII 与 683 非 ASCII 码点构成，英文稿由 3,422 与 83 构成。100 帧按上表的整数估算逐帧相加。若用同一每百万输入 token 费率 `P` 且全部未命中，理论输入成本分别为 `0.0707 × P` 和 `0.1076 × P`。实际需按投递次数、provider 的缓存命中和未命中用量分开计算。日常用户轮数不能直接替代完整帧数。

当前主用中文模型可能更自然地遵循中文指令。这个假设需用工具回执验证。英文散文仍需保留中文结构与标识符，如 `白板`、`存量未归档`、`批次伞事件`，以及既有调用键和 `type:dead-end`。中英混排可能降低可读性。省 token 的收益以正确工具选择、失败后的停止动作和存量兼容为前提。

| 方案 | 做法 | 收益 | 代价 |
| --- | --- | --- | --- |
| ① 中文清单 | 合并前置条件、删重复措辞并写明确跳过与终止 | 最小语义迁移，中文阅读及调用键都保持熟悉 | 不能省略关键 schema，压缩有下限 |
| ② 中文 + 英文骨架 | 用简短 `IF / SKIP / STOP` 组织中文说明 | 顺序醒目，可与纯中文结构比较 | 混排要实测。若只是替换「若」「跳过」「结束」，未必省 token |
| ③ 英文散文 | 散文英译，工具键、枚举、段名、tag 和中文锚点保留 | 可以独立检验模型是否更偏好英文结构 | 本稿更长。要有更精简的英文稿并验证工具行为才能讨论效率收益 |

## 五、施工判据更新建议

- 总表 5.1 ③ 将「当前 1,489 字符」更新为 **当前实测 1,675 JS 字符 / 3,034 UTF-8 B**，注明默认完整候选、固定十字符日期、含⑦和前导 LF。已有 G4-6 临时硬上限 **1,700**（`tests/smoke/smoke-test-g4-whiteboard.mjs:115–131`）仍为代码实测守卫。5.1 实施建议用不超过 **1,489** 作为压缩目标，用 1,675 做回归基线，字节数同时报告。目标与硬门槛由用户一次确定，避免把测得的基线直接当成放宽护栏。
- ④ 指向 `lib/index.js:1594–1597`，把「420 字符 ≈ 210 token / 5%」注明为过期。施工时按新成品实测更新，当前参考为 1,675 字符 / 3,034 B、约 707 token、默认 8,000 字符预算的 20.9%。不要把 707 记作 provider 实测。
- ①、② 拆成明确的是非题和局部跳过。保留总闸，在所有需要的动作已确认、已由原子写入完成或缺少必要身份与修订凭据时停止补写。关闭事件须确认整体目标结束，完成本轮不构成自动关闭。
- 变更时检查 `G4-6b` 镜像（`tests/smoke/smoke-test-g4-whiteboard.mjs:147`），分开锁长度、必要工具/中文锚点和执行语义。不要用总字数替代正文判据。

## 六、真跑方案

只作为实施后的验收方案。建议先用仓库已记录的 DSH provider/model 路径 `deepseek-official/deepseek-v4.1-flash`（`lib/index.js:6579`）。开跑前在隔离 profile 的模型清单中确认可用，记录实际 `request/header` 中的 provider 和 model。三组统一采用同一个实际模型版本、同一推理设置、同一插件版本、暂停会自动写入的维护功能，输入使用合成事件与文档。

| 步骤 | 执行 |
| --- | --- |
| 固定对照 | A 原中文，B 精简中文，C 与 B 等义的英文清单。B 与 C 只改语言，以免把结构变化归因成语言差异。附件是现文的英语译本，提供独立长度对照。冻结场景初态及工具 schema。独立 profile、临时工作区、新建会话，每项重置同一夹具 |
| 第一次试跑 | 一条有实质产出的场景，用可触发完整帧的设置。记录尾部实际出现铭文，再检查结果的工具调用顺序和文件变化 |
| 有效比较 | 每组 8 个场景 × 3 次，共 72 个独立场景轮。场景包括只读、等待或重复状态、实质进展、同轮多条进展、目标变化但未完成、真正完成、维护文档缺凭据、按关键词取归档。另抽查每组普通精简帧一次并标注实际到达的档位 |
| 日志字段 | 场景 id、variant、模型 id、投递模式/档位、铭文 SHA256 和 JS/UTF-8 数量、工具调用有序序列和规范化参数、回执状态码、磁盘前后摘要、provider 返回的输入/缓存用量、耗时 |
| 失败判据 | 只读/等待/重复写了记录，缺必填字段或猜 id，单轮同一事件重复追加，提前 close，原子账本后再次重复写，归档先读后找或不查词，写入未确认却声称成功。没有实际完整帧的轮次单列「未投递」，不计语言遵循失败 |
| 采用门槛 | 精简稿在 24 个场景轮中通过所有关键负路径，并与基准对照顺序、归属与召回。只有行为值相当、实际输入 token 稳定降低时才考虑换语言。基准自身的错误也记录，不能因基准失败就放宽关键负路径 |

## 七、待拍板

| 决断 | A | B |
| --- | --- | --- |
| 本轮铭文方向 | **先做中文清单**。压缩、补前置与终止条件 | 同批加入英文对照。增加试跑成本，当前等义稿尺寸更大 |
| 长度验收 | **把 1,489 设为优化目标，1,700 暂作保护上限**。兼容既有守卫 | 把 1,489 改为硬顶。约束更强，可能要删除细节或挪回工具描述 |
| 何时写账本 | 批次/阶段完成、实质进展或重要裁定后按内容写，手续齐备才提交。需更新当前「动 lib 即必写」的文字 | 保留每次动 lib 必写，先补 R4 前置和已有原子写入的跳过。动作较多 |
| 归档提示位置 | **保留在铭文但压成一条条件提示**。提供明确 `query` 与查无结果收尾 | 把详情给读工具说明与可唤回指针。降低完整帧开销，需验证模型能主动找到工具 |

## 八、未验证

当前只核对源码、工具契约与字符串度量。未测中英文指令遵循率、真实 provider token 或缓存、真实模型顺序及新措辞的受控行为。隔离宿主的设置搜索仅属于批次 4 收口。

## 附件 · 等义英文对照稿

以下文本按 LF 拼接，围栏与末尾的 Markdown 换行不计入数值。夹具中日期用 2026-11-23。

```text
[铭文 · 每轮提醒 {date}]
【收尾自检】Run this check only after substantive work. Skip read-only work and casual chat. Cover three areas and keep their categories.
① Log to the memory file with memory_log. Choose kind by content. Use rule for user constraints or agreements, preference for preferences, fact for facts, and todo for pending work. Do not label everything fact.
② Update 白板 and 账本 and maintain the event. Follow these mappings whenever their conditions hold.
   · Changed any file under lib/, including tests or tools? Write a four-section 账本 with memory_note(kind=handoff).
   · Does 白板 disagree with the facts at the end of this round, such as test counts, completed work or next steps? Use memory_note(kind=plan).
   · Only adding one reusable conclusion? Use memory_note(kind=note, action=append).
   · Pass eventId explicitly when you know the event. Event cards and the catalog show #evt_xxx. If unsure, run memory_log(dryRun:true) first. Use memory_event(action=create) only when no event fits. Prefer a new event to a wrong link, which contaminates past records. Log batch work under the 批次伞事件. Keep separate work separate.
   · For new progress, call memory_event(action=append, eventId, checkpoint).
   · If the goal or status changed, call memory_event(action=set, eventId, …). When the work is done, call memory_event(action=close, eventId, outcome).
   · The event is an index. memory_note(kind=handoff) carries the original text. Write both. Use memory_recall(scope=events) to see the full history.
   · kind=note does not update 白板 or 账本. Do not claim a 白板 update after writing only a note. Writing to docs/ directly does not update plugin memory.
   · Attribution rules condensed from 15 rules. ① Match an identifier first and pass eventId on a match. ② Use the 批次伞事件 for batch logs. ③ Umbrellas include 三录, 编排, alpha.N, 总表 and 白板. ④ Use a dedicated event only for the same specific fix on the same day. ⑤ Use founding only for the first checkpoint of the event. ⑥ Do not attach work that shares an identifier but belongs to another workstream. ⑦ Only prefer separation over merging when evidence is insufficient.
③ Check the skill library first. Before a multi-step task, use memory_procedure_list and verify against successCriteria. For a proven procedure, use memory_procedure(action=update) to edit an existing item instead of creating a new item with the same name. Use action=activate when confident it is reusable. Use memory_note for findings across sessions, memory_user for rules across projects and memory_rules to add, update or remove rules.
④ When a conclusion becomes obsolete, set supersedes= to mark it superseded. If it was wrong, set retract= to mark it retracted and add retractReason=. The first has a successor. The second is itself a lesson. Use restore= if the marking was wrong.
⑤ To place 白板 or 账本 content in the board lanes, include the tag in the heading or body. Use type:goal / type:state / type:dead-end / type:progress. Guessing from headings can fail.
⑥ Write objective statements in the third person. Keep reusable facts, decisions, rules and paths.
⑧ When 「存量未归档」 appears, follow its instructions to attach the 账本 to an event. With no backlog the section is absent and takes zero bytes.
⑦ Old logs are in archive/. Logs older than 30 days are archived and excluded from all in memory_recall. Find the filename with memory_recall(scope=archive), then read the original with memory_read(kind=archive, name). Use memory_read(kind=archive) to list only.
```
