# DSH 插件 API 摸底笔记（M0 · 2026-10-31）

验证来源（均为本机实际代码，非猜测）：
- 已装插件 `F:\DSHHome\profiles\desktop\node_modules\dsh-todo-board\lib\index.js`（3.4k 行，ESM，Cordis 插件）
- npm 包 `dsh-smart-prompt@1.0.1`（源码含宿主 `lib/index.js` + 客户端 `lib/client.js` 85 KB bundle）
- 插件清单 `F:\DSHHome\profiles\desktop\package.json` → `dsh.profile.bundles`

## 1. 插件形态

```js
export const name = 'xxx'                 // 插件名
export const inject = ['tools', 'llm']    // 可选，声明依赖服务
export function apply(ctx, rawConfig) {  // rawConfig 来自 cordis.patch.yml 的 config 段
  ctx.inject(['tools'], (toolsCtx) => {  // 服务就绪后再注册，容忍加载顺序
    const tools = toolsCtx.get('tools')
  })
}
```
- `ctx.inject(deps, cb)`：依赖服务出现时执行 cb，消失时自动卸载（todo-board 注释明确说明这是官方推荐姿势，而非 `ctx.get`）。
- `ctx.effect(fn, label)`：注册可自动释放的副作用，fn 返回 disposer。
- `ctx.on(event, handler)`：钩子；返回 `next()` 的 waterfall 钩子可以改写下游。

## 2. 可用服务（本机已确认字符串名）

`llm`、`webServer`、`systemPrompt`、`skills`、`commands`、`tools`、`sessions`、`sessionProjections`、`sessionQuery`、`agents`、`attachments`、`fileUploads`、`web`、`agentDefaultModel`

## 3. 关键钩子

| 钩子 | payload | 用途 |
| --- | --- | --- |
| `agent/pre-step` | `{ agent, messages }`，waterfall | **每步模型调用前**；返回 `next()` 后拿到 `downstream` |
| `agent/turn-stopping` | `{ agent, signal }` | 回合结束前 |
| `tools/pre-execute` | `{ name, input, ... }` | 工具执行前拦截，返回 `{kind:'ask'|'deny'}` 可走审批 |
| `llm/stream` | `options`，waterfall | 模型调用参数（含 provider/model） |

## 4. 往模型上下文里"加一句话"的两条路（成本差别巨大）

### 4.1 `systemPrompt.section`（常驻）
```js
ctx.inject(['systemPrompt'], (promptCtx) => {
  const prompt = promptCtx.get('systemPrompt')
  promptCtx.effect(() => prompt.section({ name: 'todo-board', order: 150, text: '...' }),
                   'dsh-todo-board: prompt section')
})
```
- 效果：**每一条请求都带**，进 system prompt。
- 成本：text 长度 × 每轮请求数。500 字 ≈ 700 token，50 轮 ≈ 3.5 万 token。
- 结论：适合"必须每轮生效的规则"，**不适合**只在首轮用一次的澄清提示。

### 4.2 `agent/pre-step` 追加 notice（按需、一次性）— 本项目采用
```js
ctx.on('agent/pre-step', (payload, next) => {
  const { agent, messages } = payload
  if (claimed.has(agent)) return next()            // WeakSet 防重复
  return Promise.resolve(next()).then((downstream) => {
    if (downstream?.kind !== 'enter') return downstream
    return { ...downstream, messages: [...downstream.messages, noticeMessage(text, summary)] }
  })
})
```
- notice 消息必须是合法 `ContentBlock[]`，`source.kind` 用 `plugin:<name>`（**不是** `'user'`），否则会被别家插件当真人消息误判。
- 注入位置是当前 step 的 messages 尾部 → 模型本轮立刻看到，且**不写进历史持久化的用户消息**（todo-board 注释：注入的 notice 不会触发自己的规划提示，就是因为 `source.kind !== 'user'`）。
- 成本：只在命中时付一次 ≈ 100~200 token。

```js
function noticeMessage(content, summary) {
  return { id: randomUUID(), role: 'user', content,
           source: { kind: 'plugin:<plugin-name>', form: 'notice', summary } }
}
```

## 5. 工具注册（本项目 M1 **不用**）

```js
const definition = {
  name: TOOL_NAME,
  description: '...',                    // 进模型工具表，按轮计费
  parameters: { type:'object', properties:{...}, required:[...] },  // 纯 JSON Schema，不是 DSL
  output: { schema: {...}, render: (args, value) => [{ type:'text', text: value.message }] },
  async execute(args, exec) { const agent = exec?.agent; const cwd = agent?.session.header.cwd }
}
ctx.effect(() => toolsCtx.get('tools').register(definition), 'label')
```
**为什么不用**：`parameters` + `description` 会进入**每一次**请求的工具表（todo-board 的 todo_board 工具描述约 900 token，每轮都在付费）。一个只在首轮用一次的能力，塞进工具表等于给每条消息收税。同理，`grill_first`/`clarify_options` 这类"首轮用一次"的工具，token 模型天生不划算。

## 6. 其它可复用服务

- `ctx.webServer.register({ kind:'prefix', path:'/dsh-xxx/api', handler })`：客户端 ←→ 宿主的回环 HTTP（smart-prompt 用它做 `/improve`）。
- 客户端 API（`dsh-smart-prompt/lib/client.js`）：`SLOT.composer`、`registerComposerEntry`、`readDraft`、`actions.setDraft`、`keepDraftFocus`、`conversation.serializeDraftAttachments`、`composer` 服务。能读写输入框草稿、注册输入区入口；**未发现**可拦截"发送"事件的公开钩子。
- `skills`：`ctx.inject(['skills'])` 注册技能；技能只在目录里占一行（name+description），正文按需加载 —— 这是"首轮用一次"能力的合适容器，但技能调用要模型主动发起，可靠性低于 pre-step notice。
- `commands`：斜杠命令，不进每轮工具表。

## 7. 结论（架构定稿依据）

1. 首轮一次性提示 → `agent/pre-step` + notice（≈150 token，一次性）。
2. 决策点模板 → 插件本地 JSON，pre-step 时**确定性**匹配后把匹配到的 2~3 个决策点直接写进 notice，**零额外模型调用、零文件读取、零工具注册**。
3. 选项渲染 → 复用宿主原生 `ask_user_question`，不自建 UI、不写客户端 bundle。
4. 不注册模型工具、不注册常驻 systemPrompt 段、不开 HTTP 路由。
5. 兜底：pre-step 全程 try/catch，任何异常直接 `next()`，绝不让插件阻断对话。