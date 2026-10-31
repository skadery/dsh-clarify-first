# PR：收录 skadery/dsh-clarify-first

## 标题

```
Add skadery/dsh-clarify-first
```

## 正文（直接粘进 PR 描述）

```markdown
### 这是什么

一个**不注册工具、不调模型、不常驻 system prompt** 的首轮澄清插件：会话第一条消息如果需求欠定义（"帮我做个网页博客"），它在模型动手前注入一条**一次性**提示（约 200 token），让模型用原生 `ask_user_question` 一次问清 2~4 个真正会改变做法的决策点，选项来自插件内置的 15 个模板包（89 决策点 / 246 选项），并支持精简 / 标准 / 深入三档。

### 和现有 prompt 类插件的区别

| | 常见做法 | 本插件 |
| --- | --- | --- |
| 触发 | 点按钮改写输入框 | 首条消息自动判断（欠定义才动手） |
| 产物 | 更长的 prompt | 2~4 个结构化决策点（带推荐项） |
| 成本 | 每次改写一次 LLM 调用 | **0 次调用**，模板库本地确定性返回 |
| 常驻开销 | 注册工具 = 每条消息都在工具表里计费 | 不注册任何工具 |

### 成本（可复核）

| 档位 | 首轮问数 | notice 大小 |
| --- | --- | --- |
| 精简 | 2 | ≈150 token |
| 标准（默认） | 3 | ≈177 token |
| 深入 | 4 + 补问一轮 | ≈298 token |

每个会话只注入一次。判定逻辑是三把锁：`WeakSet<Agent>` + 按会话 id 去重 + **必须恰好一条真人消息**，所以中途不会二次打扰（这个 bug 我在 0.2.0 修过，见 README 的"触发规则"）。

### 自检

- [x] `package.json` 声明 `dsh.bundle.patch` → `./cordis.patch.yml`
- [x] `node tools/smoke.mjs` → 46 通过 / 0 失败
- [x] `node tools/route.mjs` → 34 条真实首轮请求路由全对（博客 / 海报 / 爬虫 / 剪视频 / 部署 / 重构 …）
- [x] 已在本机 DSH 0.2.1-rc.5 装好实测生效（选项卡片正常出现，三档问数正确）
- [x] MIT、README 中英双语、`.gitignore` 干净

### 分类说明

`workflow` —— 它不改 UI、不改模型，只在开工前插一次需求澄清，和 `dsh-grill-first` 同类。
```

## 附：PR 的 diff 只有这一个文件

`data/plugins/skadery__dsh-clarify-first.yml`，内容与本仓库的 `market/skadery__dsh-clarify-first.yml` 完全一致：

```yaml
url: https://github.com/skadery/dsh-clarify-first
name: skadery/dsh-clarify-first
category: workflow
description:
  en: "Asks the few key questions that decide the approach before work starts — one shot, about 200 tokens per session, no tool registration and no extra model call."
  zh: "开工前用一次提问把关键选择问清（静态还是动态、Hexo 还是 Hugo），约 200 token/会话，不注册工具、不额外调模型；可在精简/标准/深入三档间切换。"
```

## 提 PR 的完整流程

1. fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 在 **你的 fork** 的 `main` 上新建 `data/plugins/skadery__dsh-clarify-first.yml`（内容同上）
3. 提 PR，标题 `Add skadery/dsh-clarify-first`，描述粘上面的 markdown
4. 等 CI：条目数 ≤3 → `dsh.bundle` 检查 → 仓库年龄 ≥24h → `awesome-lint` + 站点构建

## 时间线

仓库 `created_at` = `2026-10-31T11:07:09Z`，满 24 小时 = **2026-11-01 19:07（本地）**。在那之前提 PR，CI 的仓库年龄检查会直接 fail。