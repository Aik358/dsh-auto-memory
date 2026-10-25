# 原型抽取物（只读，供移植使用）

从 `../index.html`（2,599,966 B 单文件）中机械抽取，未做任何人工改写：

| 文件 | 字节 | 行 | 说明 |
|---|---|---|---|
| `prototype.css` | 45,953 | 655 | 全部视觉系统（412 条规则 / 176 个 class selector / 15 个分节） |
| `prototype.js` | 66,445 | 1,475 | 全部运行时（约 120 个函数：rail / card / detail / lanes / workflow / spring / theme / fs / lazy / 深链） |
| `prototype-body.html` | 4,509 | 53 | body 骨架 + 顶栏 + 三栏（已剔除 1.7MB JSON payload） |

复算方式：重跑抽取脚本即可（见 handoff 账本），三者 sha256 应与 `../index.html` 对应切片一致。
