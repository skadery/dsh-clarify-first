# dsh-clarify-first · 澄清优先

> **EN** — *Ask three questions before writing code, not thirty messages after.* When the **first message** of a session is a task that is doable but under-specified (e.g. "make me a blog"), this DSH plugin injects a ~200-token **one-shot** notice before the model starts, so it asks 2–4 key decision points via the built-in `ask_user_question` tool — options come from a local template library. No tool registration, no resident system prompt, no extra LLM call: roughly **200 tokens per session, paid once**.

用户发出**本会话第一条消息**时，如果这句话"能做但缺关键决策"（例：`帮我做一个网页博客`），插件会在模型动手前注入一条约 200 token 的**一次性**提示，让模型用原生 `ask_user_question` 一次问清 2~4 个决策点（选项来自本地模板库），拿到答案直接开工。

```
用户: 帮我做一个网页博客
     ↓ 插件（确定性匹配，0 延迟）
模型: [ask_user_question] 站点形态？生成方式？部署方式？
用户: 点选 → 纯静态 / Hexo / GitHub Pages
模型: 直接按这三条开工（不再复述需求）
```

## 档位：一次问几个

| 档位 | 第一轮问几个 | 补问 | 怎么切 |
| --- | --- | --- | --- |
| 精简 | 2 | 不补问，没问到的按推荐项定 | 首条消息里写「少问点」「只问关键」 |
| 标准（默认） | 3 | 不补问 | 不写，或写 `depth: 2` |
| 深入 | 4 | 拿到答案后，再对仍悬着的关键点补一轮（最多 2 问） | 写「问细一点」「多问几个」 |

优先级：**首条消息里的措辞 > 档位文件 > 插件配置**。档位文件可随时改、60 秒内生效，不用重启：

```jsonc
// <DSH_HOME>/clarify-first/gear.json    (Windows 默认就是 F:\DSHHome\clarify-first\gear.json)
{ "depth": 3 }   // 1=精简 2=标准 3=深入
```

深入档的问法变了：第一轮给 4 个最影响做法的点，再单独列一条「第二轮（拿到答案后，只问还悬着的）」，模型只在出现**新歧义**时才补问，最多 2 问——不是固定 4+N 轮访谈。

## 为什么不那样做

| 常见做法 | 隐藏成本 | 本项目 |
| --- | --- | --- |
| 注册 `clarify_options` 工具 | 工具描述+参数进**每一次**请求的工具表，300~900 token/轮；50 轮 ≈ 1.5~4.5 万 | 不注册工具 |
| 常驻 `systemPrompt` 段 | 每轮都在付费，500 字 ≈ 700 token | 只在首轮注入一次 |
| 客户端卡片 / 拦截发送 | 要写客户端 bundle，版本一升就碎；还得再调一次模型 | 复用原生 ask_user_question |
| 调辅助小模型改写提示词 | 每条消息 500~1500 token，还多 1~3 秒首字延迟 | 0 次模型调用 |
| 多轮访谈 | 每轮一次调用 + 打断心流 | 一次问完，最多 4 问 + 至多 1 轮补问 |

**总成本：约 200 token / 会话（深入档约 320），一次性。** 一轮返工通常 2k~10k token —— 只要返工率降 10% 就已经回本。

## 文件

```
lib/index.js        门控 + 匹配 + 档位 + notice 注入（唯一逻辑文件，约 360 行）
packs/*.json        15 个模板包 / 89 决策点 / 246 选项（每个点带 lv=1|2|3 影响度）
tools/smoke.mjs     46 项冒烟断言（含档位问数、token 预算、静音、异常兜底）
tools/route.mjs     34 条真实请求的路由回归（命中哪个包 / 该不该注入）
cordis.patch.yml    bundle 激活条目
```

| 包 | 覆盖的首轮请求 | 决策点示例 |
| --- | --- | --- |
| web 60 | 网页 / 博客 / 官网 / 落地页 | 站点形态、生成方式、部署在哪 |
| design 58 | 海报 / 封面 / logo / 详情页 | 用途与尺寸、风格、是否要可编辑源文件 |
| image 57 | 头像 / 插画 / 配图 / 图标 | 画什么、画风、透明底还是白底 |
| service 55 | 后端 / 接口 / 小程序 / 登录系统 | 技术栈、数据存哪、要不要部署 |
| game 53 | 小游戏 / 网页游戏 | 玩法类型、跑在哪、美术风格 |
| video 52 | 剪辑 / 字幕 / 配音 / 播客 | 做什么、画幅、要不要字幕 |
| ops 51 | 部署 / 服务器 / 定时任务 / 自启 | 部署到哪、域名 HTTPS、要不要监控 |
| code 50 | 脚本 / 插件 / 小工具 / 命令行 | 语言、形态、是否要 GUI |
| data 50 | 爬虫 / 清洗 / 分析 / 看板 / 报表 | 数据从哪来、要什么结果、更新频率 |
| refactor 49 | 重构 / 迁移 / 升级 / 改造 | 改多大范围、目标、是否保兼容 |
| writing 48 | 文案 / 公众号 / 邮件 / 小说 / 剧本 | 写什么、给谁看、长度语气 |
| research 46 | 调研 / 选型 / 评测 / 竞品对比 | 要多深、要不要我拍板、输出格式 |
| doc 45 | 文档 / 报告 / PPT / 表格 / 纪要 | 交付物、给谁看、篇幅 |
| learning 44 | 教程 / 课程 / 学习路线 / 讲解 | 现有基础、节奏、要不要练习 |
| generic 0 | 兜底（上面的包都没命中） | 交付形态、范围、验收标准 |

优先级数字越大越优先；命中数相同时按优先级取舍。`packs/*.json` 每 60 秒热重载。

## 安装

```powershell
# 市场安装（已上架后）
dsh plugin --profile desktop add dsh-clarify-first

# 本地目录直接挂载（开发）
dsh plugin --profile desktop add link:F:\DSHproj\project\2026-10-31-prompt-clarify-plugin
# 然后重启 DSH（插件在启动时装载）
```

卸载/停用：把 `config.enabled` 设为 `false`，或 `dsh plugin --profile desktop remove dsh-clarify-first`。

## 配置（profile 的 `cordis.patch.yml`）

```yaml
- id: clarify-first
  name: 'dsh-clarify-first'
  config:
    enabled: true      # 总开关
    minScore: 3        # 欠定义阈值：任务词+2 产物词+2 含糊词+1 具体性-3
    depth: 'auto'      # 默认档位 1|2|3；'auto' = 标准(2)。消息措辞与档位文件优先
    maxPoints: 0       # >0 时强制收窄第一轮问数（0 = 交给档位）
    gearFile: ''       # 档位文件路径；空 = <DSH_HOME>/clarify-first/gear.json
    packsDir: ''       # 自定义模板目录（绝对路径；空=用插件内置 packs）
    quietDirs: []      # 这些目录下不触发
    debug: false       # 命中原因写日志
```

## 触发规则

- 只看**本会话第一条真人消息**（`source.kind === 'user'`）：历史里出现助手回复、或已经有过第二条真人消息，都不插手（会话中途绝不打断）。
- 文本 >120 字不打扰；`继续/好/谢谢/你好` 不打扰。
- 出现具体性标记（框架名、`D:\` 路径、`@文件`、代码块、带单位数字、"用 X 做"）**扣 3 分** —— 明确的需求不该被问。例外：调研/选型类（"Hexo 和 Hugo 哪个好"）不吃这一刀，因为点候选名字不等于定好了深度和取舍。
- 请求本身是在指挥这个插件（"发布到市场""优化一下澄清优先"）→ 不插嘴。
- 用户说`别问了直接做` → 本会话永久静音。
- 任何异常（packs 缺失/JSON 损坏/未知钩子）→ 静默放行，绝不阻断对话。

## 开发

```powershell
node tools/smoke.mjs     # 46 项断言，不需要装插件、不需要 DSH
node tools/route.mjs     # 34 条真实请求 → 期望命中哪个包（改词表/改包必跑）
node tools/route.mjs -v  # 连命中的也打印出来
node _tmp\packs-v3.cjs   # 重新生成 packs/（生成器自带 schema 校验）
```

改 `packs/*.json` 后无需重启：插件每 60 秒重读一次模板目录；改 `lib/index.js` 需要重启 DSH。

## 已知取舍

- 提示是"注入消息"而非系统指令，模型**可能**忽略 —— 忽略即回到原行为，无副作用。这是用可靠性换取"零常驻成本"的自觉选择。
- 选项只有 2~4 个，靠"推荐项 + 用户可自由回答"兜住长尾，不做完整需求访谈。
- 依赖 `agent/pre-step` 一个钩子；DSH 大版本升级后先跑 `tools/smoke.mjs` 再升级。