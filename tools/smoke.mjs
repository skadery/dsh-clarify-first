// 冒烟测试：不装插件、不起 DSH，直接跑 apply() 的门控逻辑。
// 用法：node tools/smoke.mjs
import { apply } from '../lib/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name) } else { fail++; failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' → ' + detail : '')) }
}

/** 粗略 token 估算：CJK 约 0.7 token/字，其余约 1 token/3.5 字符。 */
function estimateTokens(text) {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++
    else other++
  }
  return Math.round(cjk * 0.7 + other / 3.5)
}

function makeHost(config) {
  const handlers = new Map()
  const ctx = {
    on(event, fn) { handlers.set(event, fn) },
    logger() { return { info() {}, debug() {}, warn() {}, error() {} } },
    effect(fn) { return fn() },
  }
  apply(ctx, config)
  const preStep = handlers.get('agent/pre-step')
  if (typeof preStep !== 'function') throw new Error('agent/pre-step 未注册')
  return { ctx, preStep }
}

function humanMsg(text) {
  return { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

/** 跑一次 pre-step，返回注入的 notice 文本（没有注入则 null）。 */
async function run(preStep, agent, messages) {
  const payload = { agent, messages }
  let entered = false
  const next = async () => { entered = true; return { kind: 'enter', messages: [...messages] } }
  const countNotices = (list) => list.filter((m) => m && m.source && m.source.kind === 'plugin:dsh-clarify-first').length
  const before = countNotices(messages)
  const downstream = await preStep(payload, next)
  if (downstream === null || typeof downstream !== 'object') return { injected: null, entered, downstream }
  const added = downstream.messages.filter((m) => m && m.source && m.source.kind === 'plugin:dsh-clarify-first')
  const appended = added.length - before
  return {
    injected: appended <= 0 ? null : added[added.length - 1].content[0].text,
    appended,
    entered,
    downstream,
    added,
  }
}

const newAgent = (cwd = 'F:\\work\\demo') => ({ session: { header: { cwd } } })

console.log('\n[1] 首轮欠定义请求 → 注入')
{
  const { preStep } = makeHost()
  const agent = newAgent()
  const r = await run(preStep, agent, [humanMsg('帮我做一个网页博客')])
  check('注入了 notice', r.injected !== null)
  check('命中 web 包', r.injected !== null && r.injected.includes('网页 / 前端'))
  check('给出形态决策点', r.injected !== null && r.injected.includes('站点形态'))
  check('推荐项标记 (荐)', r.injected !== null && r.injected.includes('(荐)'))
  check('要求一次问完', r.injected !== null && r.injected.includes('一次'))
  const tokens = r.injected === null ? 0 : estimateTokens(r.injected)
  check('notice ≤ 220 token（实测 ' + tokens + '）', tokens <= 220)
  console.log('    --- notice ---\n' + (r.injected || '').split('\n').map((l) => '    ' + l).join('\n'))
}

console.log('\n[2] 带路径/语言/单位的明确请求 → 不注入')
{
  const { preStep } = makeHost()
  const r = await run(preStep, newAgent(), [humanMsg('帮我写个 Python 脚本，把 D:\\data\\a.csv 合并成一个，输出到 D:\\out')])
  check('不注入', r.injected === null)
}

console.log('\n[3] 闲聊/单字 → 不注入')
{
  const { preStep } = makeHost()
  for (const t of ['继续', '好', '谢谢', '你好']) {
    const r = await run(preStep, newAgent(), [humanMsg(t)])
    check('「' + t + '」不注入', r.injected === null)
  }
}

console.log('\n[4] 后端服务 → 命中 service')
{
  const { preStep } = makeHost()
  const r = await run(preStep, newAgent(), [humanMsg('帮我做个后端服务')])
  check('注入', r.injected !== null)
  check('命中 后端 / 服务', r.injected !== null && r.injected.includes('后端 / 服务'))
}

console.log('\n[5] 同一 agent 第二条消息 → 不重复注入')
{
  const { preStep } = makeHost()
  const agent = newAgent()
  const first = await run(preStep, agent, [humanMsg('帮我做一个网页博客')])
  check('首条注入', first.injected !== null)
  const msgs = [...first.downstream.messages, { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '好的' }] }, humanMsg('再帮我搞个文档吧')]
  const second = await run(preStep, agent, msgs)
  check('第二条不再注入', second.injected === null)
}

console.log('\n[6] 已有助手回复的新 agent（插件热更新场景）→ 不插手')
{
  const { preStep } = makeHost()
  const msgs = [humanMsg('帮我做一个网页博客'), { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '好的' }] }, humanMsg('帮我搞个文档')]
  const r = await run(preStep, newAgent('F:\\work\\other'), msgs)
  check('不注入', r.injected === null)
}

console.log('\n[7] 插件 notice 不算真人消息')
{
  const { preStep } = makeHost()
  const notice = { id: 'n1', role: 'user', source: { kind: 'plugin:x', form: 'notice', summary: 'x' }, content: [{ type: 'text', text: '帮我做一个网页博客' }] }
  const r = await run(preStep, newAgent(), [notice])
  check('不注入', r.injected === null)
}

console.log('\n[8] 数据/文档类命中对应包')
{
  const { preStep } = makeHost()
  const d = await run(preStep, newAgent('F:\\work\\d1'), [humanMsg('帮我做个数据看板')])
  check('数据 → 数据处理 / 分析', d.injected !== null && d.injected.includes('数据处理 / 分析'))
  const w = await run(preStep, newAgent('F:\\work\\d2'), [humanMsg('帮我写个方案文档给客户')])
  check('文档注入（方案/文档命中文档包或通用包）', w.injected !== null)
  console.log('    ' + (w.injected || '').split('\n')[0])
}

console.log('\n[9] 用户说「别问了直接做」→ 静音')
{
  const { preStep } = makeHost()
  const agent = newAgent()
  const m = await run(preStep, agent, [humanMsg('别问了直接做，帮我搞个网页')])
  check('当轮不注入', m.injected === null)
  const n = await run(preStep, agent, [humanMsg('别问了直接做，帮我搞个网页'), { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '好' }] }, humanMsg('帮我做个博客')])
  check('后续不注入', n.injected === null)
}

console.log('\n[10] 长需求（>120 字）→ 不注入')
{
  const { preStep } = makeHost()
  const long = '帮我做一个网页博客。' + '要求：支持 Markdown 写作、标签分类、RSS、站内搜索、暗色主题、移动端适配、评论用 Giscus、部署到 GitHub Pages，并且保留历史文章迁移脚本。'.repeat(2)
  const r = await run(preStep, newAgent(), [humanMsg(long)])
  check('不注入', r.injected === null)
}

console.log('\n[11] packs 目录坏掉 → 不抛错、不阻断')
{
  const { preStep } = makeHost({ packsDir: 'F:\\definitely\\not\\here' })
  const r = await run(preStep, newAgent(), [humanMsg('帮我做一个网页博客')])
  check('仍走到 next()', r.entered === true)
  check('不注入', r.injected === null)
}

console.log('\n[12] enabled=false → 全程静默')
{
  const { preStep } = makeHost({ enabled: false })
  const r = await run(preStep, newAgent(), [humanMsg('帮我做一个网页博客')])
  check('不注入', r.injected === null)
}

console.log('\n[13] quietDirs 命中 → 不注入')
{
  const { preStep } = makeHost({ quietDirs: ['F:\\work\\quiet'] })
  const r = await run(preStep, newAgent('F:\\work\\quiet\\x'), [humanMsg('帮我做一个网页博客')])
  check('不注入', r.injected === null)
}

/** 数 notice 里的决策点条数（形如 "1) 站点形态：…"）。 */
const countPoints = (text) => (text === null ? -1 : text.split('\n').filter((l) => /^\d+\) /.test(l)).length)

console.log('\n[14] 档位：默认标准 → 3 问')
{
  const { preStep } = makeHost()
  const r = await run(preStep, newAgent('F:\\work\\g2'), [humanMsg('帮我做一个网页博客')])
  check('标准档 = 3 个决策点（实测 ' + countPoints(r.injected) + '）', countPoints(r.injected) === 3)
  check('标题带档位名', r.injected !== null && r.injected.includes('【澄清优先·标准】'))
  check('标准档不出现第二轮', r.injected !== null && !r.injected.includes('第二轮'))
  const tokens = estimateTokens(r.injected || '')
  check('标准档 notice ≤ 220 token（实测 ' + tokens + '）', tokens <= 220)
}

console.log('\n[15] 档位：措辞「问细一点」→ 深入 4 问 + 第二轮')
{
  const { preStep } = makeHost()
  const r = await run(preStep, newAgent('F:\\work\\g3'), [humanMsg('帮我做一个网页博客，问细一点')])
  check('深入档 = 4 个决策点（实测 ' + countPoints(r.injected) + '）', countPoints(r.injected) === 4)
  check('标题带「深入」', r.injected !== null && r.injected.includes('【澄清优先·深入】'))
  check('出现「第二轮」补问块', r.injected !== null && r.injected.includes('第二轮（拿到答案后'))
  check('补问块里有具体问题', r.injected !== null && /第二轮（拿到答案后[^\n]*\n?A\. /.test(r.injected) || (r.injected !== null && r.injected.includes('A. ')))
  check('限一轮最多 2 问', r.injected !== null && r.injected.includes('最多 2 问'))
  const tokens = estimateTokens(r.injected || '')
  check('深入档 notice ≤ 360 token（实测 ' + tokens + '）', tokens <= 360)
  console.log('    --- notice ---\n' + (r.injected || '').split('\n').map((l) => '    ' + l).join('\n'))
}

console.log('\n[16] 档位：措辞「少问点」→ 精简 2 问')
{
  const { preStep } = makeHost()
  const r = await run(preStep, newAgent('F:\\work\\g1'), [humanMsg('帮我做一个网页博客，少问点')])
  check('精简档 = 2 个决策点（实测 ' + countPoints(r.injected) + '）', countPoints(r.injected) === 2)
  check('标题带「精简」', r.injected !== null && r.injected.includes('【澄清优先·精简】'))
  check('精简档尾巴叫停追问', r.injected !== null && r.injected.includes('不要再追问'))
}

console.log('\n[17] 档位文件 → 生效（措辞缺省时）')
{
  const gearPath = fileURLToPath(new URL('../_tmp/gear-smoke.json', import.meta.url))
  mkdirSync(dirname(gearPath), { recursive: true })
  writeFileSync(gearPath, JSON.stringify({ depth: 3 }), 'utf8')
  const { preStep } = makeHost({ gearFile: gearPath })
  const r = await run(preStep, newAgent('F:\\work\\gf'), [humanMsg('帮我做一个网页博客')])
  check('文件 depth=3 → 4 问（实测 ' + countPoints(r.injected) + '）', countPoints(r.injected) === 4)
  check('标题「深入」', r.injected !== null && r.injected.includes('·深入】'))

  writeFileSync(gearPath, '{"depth": 9}', 'utf8')
  const bad = makeHost({ gearFile: gearPath })
  const r2 = await run(bad.preStep, newAgent('F:\\work\\gb'), [humanMsg('帮我做一个网页博客')])
  check('非法 depth 回落到标准 3 问', countPoints(r2.injected) === 3)
}

console.log('\n[18] 会话中途的第二条真人消息 → 不误触发（m00375 回归）')
{
  const { preStep } = makeHost()
  const msgs = [humanMsg('帮我把插件优化一下'), humanMsg('做一个档位调节器来改变每次提问的环节数量')]
  const r = await run(preStep, newAgent('F:\\work\\mid'), msgs)
  check('两条真人消息 → 不注入', r.injected === null)
}

console.log('\n[19] 指挥插件自身（RE_META）→ 不插嘴')
{
  const { preStep } = makeHost()
  for (const t of ['把这个插件发布到市场', '帮我把澄清优先做得更省 token']) {
    const r = await run(preStep, newAgent('F:\\work\\meta' + t.length), [humanMsg(t)])
    check('「' + t + '」不注入', r.injected === null)
  }
}

console.log('\n[20] maxPoints 强制覆盖档位')
{
  const { preStep } = makeHost({ maxPoints: 2 })
  const r = await run(preStep, newAgent('F:\\work\\mp'), [humanMsg('帮我做一个网页博客，问细一点')])
  check('深入档被 maxPoints=2 收窄', countPoints(r.injected) === 2)
}

console.log('\n' + (fail === 0 ? '全部通过 ' : '有失败 ') + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) { console.log(failures.join('\n')); process.exit(1) }