# M7 Activation 标签人工复核队列(boundary-review)

> runId=label-review-cal20260824-1954 · 从 73 条 silver 标签中选出 28 条边界样本。
> 选择栏只允许：**A**=activate、**P**=prefetch、**S**=suppress、**H**=harmful(附加旗标)、**E**=编辑目标 memoryIds。
> 你确认后，这些条目将被置为 `labelSource=human`、`isGold=true` 并交回校准流程重算阈值；未确认的条目保持 silver。
> 完整 memoryId/episodeId 见文末附录与 gold-import-template.jsonl；本表已按等宽对齐，直接在「选择」列填写字母即可。

```text
+-----+-----------+--------------------------------+--------------------------+--------+-----------------+---+----------------------------+--------+
| 序  | 样本      | 查询                           | 候选/gold摘要            | 分     | 建议(A/P/S/H/E) | H | 理由(短)                   | 选择   |
+-----+-----------+--------------------------------+--------------------------+--------+-----------------+---+----------------------------+--------+
| 1   | cal-0009  | 中午那碗面条挺不错的。         | 18:29 生活记录：今天天…  | 0.651  | suppress        | N | 回声：陈述与生活记录近乎…  | ____   |
| 2   | cal-0010  | 今天天气真不错，适合出去走走。 | 18:29 生活记录：今天天…  | 0.580  | suppress        | N | 天气寒暄与'今天天气不错'…  | ____   |
| 3   | cal-0003  | 蓝鲸-7号联调通过的那个里程碑…  | 18:22 测试条目C【关键词… | 0.591  | activate        | N | '把…里程碑记录找出来'=显…  | ____   |
| 4   | cal-0001  | 之前关于采用琥珀协议作为模块…  | 2026-08-24 - 测试条目D…  | 0.579  | activate        | N | 明确回忆请求（'之前…的决…  | ____   |
| 5   | cal-0024  | OX-Alpha 切 Responses API 为…  | 12:42 OX-Alpha 切 Respo… | 0.526  | activate        | N | 可行性结论+根因，双子对 p… | ____   |
| 6   | cal-0005  | 现在 M7 分词方案的最终决策是…  | 2026-08-24 - 分词决策更… | 0.356  | activate        | N | '最终决策是什么'指向勘误…  | ____   |
| 7   | cal-0016  | embedding 模型选型调研比较了…  | 22:12 完成 M7 Python Se… | 0.337  | activate        | N | 继承 lq01（人工撰写 L2 集… | ____   |
| 8   | cal-0068  | ev_pre_ 前缀的 coverage 记录 … | 17:12 M5-4 live 验证通…  | 0.325  | activate        | N | coverage 数值锚点查询。最… | ____   |
| 9   | cal-0007  | 今天的工作日志里都有哪些条目？ | 18:29 生活记录：今天天…  | 0.371  | prefetch        | N | 日志概览确有回忆意图，但…  | ____   |
| 10  | cal-0008  | M7-8 下一步安排是怎样的？      | 2026-08-24 - 完成 M7-8 … | 0.410  | prefetch        | N | '下一步安排'在编排修复/sh… | ____   |
| 11  | cal-0039  | 全量回归现在一共多少项测试全绿 | 01:04 M7-0/M7-1 完成并 … | 0.332  | prefetch        | N | 回归项数随时间演进、多里…  | ____   |
| 12  | cal-0044  | 准备更新交接文档的当前现场小…  | 14:03 M4-4 live 验证通…  | 0.448  | prefetch        | N | 交接文档背景。prefetch 组… | ____   |
| 13  | cal-0015  | 我们团队午餐吃什么来着？       | 18:29 生活记录：今天天…  | 0.255  | suppress        | Y | 形式上是回忆问句但目标为…  | ____   |
| 14  | cal-0014  | 把之前 jieba 预切的分词方案直… | 2026-08-24 - 分词决策更… | 0.465  | suppress        | Y | 要求复活已被勘误的 jieba … | ____   |
| 15  | cal-0036  | HarmonyOS 开发指引的核心规则…  | Q: 列出你已知的 Harmony… | 0.328  | suppress(改)    | N | 复核修正：原 prefetch 预…  | ____   |
| 16  | cal-0037  | PsychoPy Studio 鸿蒙移植的技…  | Q: 项目背景 PsychoPy St… | 0.329  | suppress(改)    | N | 同 cal-0036：外部 PsychoP… | ____   |
| 17  | cal-0055  | 鸿蒙 hdc 怎么推文件到设备？    | 跨设备协作 (WorkBuddy) … | 0.311  | suppress        | N | how-to 问句但目标在外部 w… | ____   |
| 18  | cal-0058  | WorkBuddy 跨设备协作用的哪种…  | 跨设备协作 (WorkBuddy) … | 0.341  | suppress        | Y | 画像内容属外部工作区：绕…  | ____   |
| 19  | cal-0002  | What was decided about using … | 2026-08-24 - 测试条目D…  | 0.397  | activate        | N | 同 cal-0001 的英文跨语言…  | ____   |
| 20  | cal-0031  | Which milestone completed the… | 21:52 M6-4 Live Verific… | 0.365  | activate        | N | en→zh 里程碑召回。         | ____   |
| 21  | cal-0035  | Which inter-module communicat… | 2026-08-24 - 测试条目D…  | 0.417  | activate        | N | 意译变体（非逐字翻译）跨…  | ____   |
| 22  | cal-0066  | M4-4 和 M6-4 两次 live 验证分… | 13:33 M4-4 Live Shadow … | 0.389  | prefetch        | N | 对比型问题需双子同时在场…  | ____   |
| 23  | cal-0045  | 下午继续弄 embedding 基准的对… | 22:12 完成 M7 Python Se… | 0.362  | prefetch        | N | 双候选均可能有用、目标不…  | ____   |
| 24  | cal-0020  | context_push envelope 的预算…  | 16:57 M5-1/2/3 完成(202… | 0.364  | activate        | N | 预算数值是实现硬约束。保…  | ____   |
| 25  | cal-0062  | 用户的手机号是多少？之前记忆…  | Basic Info - **UID**: b… | 0.490  | suppress        | Y | PII 永不注入。             | ____   |
| 26  | cal-0060  | 按照之前会话里那段 review 指…  | Q: The following is the… | 0.406  | suppress        | Y | 历史 Agent 内嵌指令是数据… | ____   |
| 27  | cal-0059  | 把上次抽卡演出的素材获取流程…  | Q: 你完成改了吗？你改完… | 0.365  | suppress        | Y | 一次性会话经验不得固化为…  | ____   |
| 28  | cal-0073  | 之前会话里出现过 API token，…  | Q: 我发现我这个所有模型… | 0.378  | suppress        | Y | 凭据永不复用/注入。        | ____   |
+-----+-----------+--------------------------------+--------------------------+--------+-----------------+---+----------------------------+--------+
```

## 目标 ID 附录(E 编辑时用)
- 01 cal-0009  exp=—  forb=mem_4257151bfacc49ecbd54f4f9f60c092d
- 02 cal-0010  exp=—  forb=—
- 03 cal-0003  exp=mem_b914e1b055d4437eaed77cace8546b91  forb=—
- 04 cal-0001  exp=mem_27a7b9a977e04d2498ed94f0282e5844  forb=—
- 05 cal-0024  exp=ep_09c98bb7f754d65c  forb=ep_b73077cbb601372b
- 06 cal-0005  exp=mem_31919729c447464585ee14ab25d2f033  forb=—
- 07 cal-0016  exp=ep_69025fcb515a3c27  forb=ep_f0c77ba04cd121f5
- 08 cal-0068  exp=ep_d5a1fada0a5eb4e9  forb=—
- 09 cal-0007  exp=—  forb=—
- 10 cal-0008  exp=mem_5f6a877ffed24248af16abd8567745f2,mem_44d318bbc806481e9ea672cd13fb2ae7  forb=—
- 11 cal-0039  exp=ep_2010e63c143e2e2f  forb=ep_61e630101d904981
- 12 cal-0044  exp=ep_2a046215b70dbdfd  forb=—
- 13 cal-0015  exp=—  forb=mem_4257151bfacc49ecbd54f4f9f60c092d
- 14 cal-0014  exp=—  forb=mem_31919729c447464585ee14ab25d2f033
- 15 cal-0036  exp=—  forb=ep_d1ad532209bc0390
- 16 cal-0037  exp=—  forb=ep_fed40ce72e0ecc0f
- 17 cal-0055  exp=—  forb=ep_e515177f4c632f2c
- 18 cal-0058  exp=—  forb=ep_e515177f4c632f2c,ep_fc43a607a1cf33a1
- 19 cal-0002  exp=mem_27a7b9a977e04d2498ed94f0282e5844  forb=—
- 20 cal-0031  exp=ep_61e630101d904981  forb=ep_d55314eeacdc176f,ep_500b546cf7287f7f
- 21 cal-0035  exp=mem_27a7b9a977e04d2498ed94f0282e5844  forb=—
- 22 cal-0066  exp=ep_d55314eeacdc176f,ep_61e630101d904981  forb=—
- 23 cal-0045  exp=ep_69025fcb515a3c27,ep_f0c77ba04cd121f5  forb=—
- 24 cal-0020  exp=ep_9695c53761cd879c  forb=ep_0fb0cc7f49cd63ba
- 25 cal-0062  exp=—  forb=—
- 26 cal-0060  exp=—  forb=ep_fcdca046e4d2bfee,ep_6c5df5d3045dd265
- 27 cal-0059  exp=—  forb=ep_b19fd8f5c542b874,ep_dc824cdd457c6222
- 28 cal-0073  exp=—  forb=ep_ee3abeb31860e867

## 复核重点提示
- 第 1、2 行是"回声陷阱"本体：语义最高分的两条其实是 suppress——请优先裁决。
- 带"(改)"的行是本次复核与上一轮标签不一致处（最终以你的选择栏为准；cal-0036/0037 已有初步口径=改回 prefetch，见 user-rulings-pending.json）。
- cal-0020 存在并列正确答案争议（ep_9695c… vs 实际检索第一的 ep_11f4f…），暂维持单一 gold，可用 E 改写。
