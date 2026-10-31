// 回归矩阵：34 条真实风格的首轮请求 → 期望的注入/跳过与命中包。
// 用法：node tools/route.mjs        全部断言，失败退出码 1
//      node tools/route.mjs -v     多打印每条的分数与原因
import { apply } from '../lib/index.js'

const verbose = process.argv.includes('-v')
const handlers = new Map()

const fakeCtx = {
  on(e, f) { handlers.set(e, f) },
  logger() { return { info() {}, debug() {} } },
  effect(fn) { const off = fn(); return () => { if (typeof off === 'function') off() } },
}

apply(fakeCtx, { debug: false })
const preStep = handlers.get('agent/pre-step')

// [输入, 期望包显示名, 期望是否注入]
const CASES = [
  ['帮我做一个网页博客', '网页'],
  ['帮我做个个人网站', '网页'],
  ['帮我写个脚本批量改文件名', '脚本'],
  ['帮我做个后端服务', '后端'],
  ['帮我写个爬虫抓豆瓣', '数据处理'],
  ['帮我做个数据看板', '数据处理'],
  ['帮我写个方案文档给客户', '文档'],
  ['帮我做一张海报', '设计'],
  ['帮我画个头像', '图片生成'],
  ['帮我生成一张封面图', '设计'],
  ['帮我剪个视频加字幕', '视频'],
  ['帮我做个贪吃蛇小游戏', '小游戏'],
  ['帮我写个公众号文案', '写作'],
  ['帮我写封邮件请假', '写作'],
  ['帮我调研下 Hexo 和 Hugo 哪个好', '调研'],
  ['帮我部署到服务器上', '部署'],
  ['帮我配个 nginx https', null],
  ['教我学 Rust', null],
  ['帮我重构这段代码', '改造'],
  ['帮我升级 React 版本', null],
  ['帮我做个 PPT', '文档'],
  ['帮我整理会议纪要', '文档'],
  ['帮我分析下这份销售数据', '数据处理'],
  ['帮我做个插件', '脚本'],
  ['帮我搞个自动化', '通用'],
  ['帮我做个登录系统', '后端'],
  ['帮我设计个 logo', '设计'],
  ['帮我写个小说开头', '写作'],
  ['帮我做个技术评测对比', '调研'],
  ['帮我搞个开机自启', '部署'],
  ['今天天气怎么样', null],
  ['继续', null],
  ['帮我写个 Python 脚本，把 D:\\data\\a.csv 合并', null],
  ['帮我把这个项目从 vue2 迁移到 vue3', '改造'],
]

let pass = 0
const fails = []
for (const [text, expect] of CASES) {
  const agent = { session: { header: { cwd: 'F:\\work\\route-matrix' } } }
  const messages = [{ id: 'm', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }]
  const out = await preStep({ agent, messages }, async () => ({ kind: 'enter', messages: [...messages] }))
  const injected = (out.messages || []).filter((m) => m.source && m.source.kind === 'plugin:dsh-clarify-first')
  let got = null
  if (injected.length > 0) {
    const m = /「([^」]+)」/.exec(injected[0].content[0].text)
    got = m === null ? '?' : m[1].split(/\s*\/\s*/)[0].trim()
  }
  const ok = got === expect
  if (ok) pass++
  else fails.push({ text, expect, got })
  if (verbose || !ok) {
    const mark = ok ? '✓' : '✗'
    console.log(`${mark} 期望 ${String(expect).padEnd(9)} 实际 ${String(got).padEnd(9)} ${text}`)
  }
}

console.log(`\n路由矩阵 ${pass} 通过 / ${fails.length} 失败（共 ${CASES.length}）`)
if (fails.length > 0) process.exit(1)
