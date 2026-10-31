// dsh-clarify-first —— 首轮需求澄清
//
// 设计约束（见 SPEC.md）：
//  - 只在「本会话第一条真人消息 + 需求欠定义」时注入一条 notice，约 150~200 token，一次性；
//  - 不注册模型工具、不写常驻 systemPrompt 段、不开 HTTP 路由、不调用任何 LLM；
//  - 决策点来自本地 packs/*.json，纯字符串匹配，0 延迟 0 幻觉；
//  - 任何异常一律 next() 放行，绝不阻断对话。

import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-clarify-first'

const DEFAULT_CONFIG = {
  enabled: true,
  minScore: 3,
  maxPoints: 0,      // 0 = 交给档位决定（浅 2 / 标准 3 / 深 4）
  depth: 'auto',     // 'auto' = 标准(2)；也可填 1/2/3
  gearFile: '',      // 档位文件路径，空 = <DSH_HOME>/clarify-first/gear.json（可热改）
  packsDir: '',
  quietDirs: [],
  debug: false,
}

// 档位 → 第一轮问几个决策点
const GEAR_COUNT = { 1: 2, 2: 3, 3: 4 }
const GEAR_NAME = { 1: '精简', 2: '标准', 3: '深入' }

const PLUGIN_TAG = 'plugin:dsh-clarify-first'

// ---------------------------------------------------------------- 词表

const RE_ACTION = /帮我|帮忙|做个|做一个|写个|写一个|搞个|搞一个|建个|实现一个|实现|生成|搭建|创建|设计|开发|弄个|来一个|整个|整理|分析|调研|对比|评测|教我|讲解|讲讲|部署|配置|迁移|升级|改造|重构|剪|画一张|画个/
// 产物名词：命中即说明"这是一件要交付的东西"。带 i 标志，`PPT` / `API` 这类大写也算。
const RE_ARTIFACT = /网页|网站|博客|前端|落地页|官网|文档站|个人站|页面|脚本|插件|小工具|工具|自动化|工作流|批处理|命令行|\bcli\b|后端|接口|\bapi\b|服务端|微服务|数据库|后台|小程序|\bapp\b|文档|报告|\bppt\b|幻灯片|方案|总结|表格|周报|日报|简历|说明书|手册|\bexcel\b|\bword\b|会议纪要|数据|爬虫|清洗|分析|可视化|统计|图表|报表|看板|机器人|\bbot\b|系统|服务|海报|封面|\blogo\b|标志|插画|头像|配图|视觉|图标|详情页|视频|音频|字幕|剪辑|配音|播客|小游戏|游戏|文案|公众号|小红书|推文|朋友圈|邮件|软文|文章|小说|剧本|演讲稿|教程|课程|学习路线|调研|对比|评测|选型|竞品|重构|迁移|升级|部署|运维|备份|监控/i
// 调研/选型类：用户即便点名了两个候选，也还没定"要多深/要不要我拍板"，所以不吃具体性减分。
const RE_RESEARCH = /调研|对比|评测|选型|竞品|哪个好|优劣|可行性/
const RE_VAGUE = /简单|快速|小样|随便|差不多|类似|那种|搞个|弄个|看看吧|你看着办/
const RE_SPECIFIC = /hexo|hugo|astro|next\.?js|\breact\b|\bvue\b|svelte|python|node(?:\.js)?|\brust\b|golang|\bgo\b|\.net|\bjava\b|typescript|\bts\b|\bjs\b|docker|nginx|mysql|postgres|redis|sqlite|tailwind|\bvite\b|\bpnpm\b|\bnpm\b|\byarn\b|fastapi|flask|express|django|spring/i
const RE_PATH = /[A-Za-z]:\\|(?:^|\s)\/(?:usr|home|var|opt|tmp|etc)\/|@[\w./-]+\.(?:md|js|ts|py|json|yml|yaml|txt)/
const RE_FENCE = /```/
const RE_UNITS = /\d+\s*(?:个|条|行|页|字|秒|分钟|次|列|字段|万|千|kb|mb|gb|ms)\b/i
const RE_USE_WITH = /用\s*[\w.+-]+\s*(?:来)?(?:做|写|实现|搭|生成)/
const RE_MUTE = /别问|不用问|不要问|直接做|直接开干|别废话|按你说的|你自己定|不用澄清|先做再说/
const RE_TRIVIAL = /^\s*(?:继续|好|好的|行|可以|嗯|谢谢|多谢|取消|停|不用了|ok|okay|yes|no|y|n|收到|知道了|\d+)\s*[!！。.~]*\s*$/i
// 这段话本身就是在指挥"做个插件/发布/优化这个工具"，不是要交付网页或文档 —— 别插嘴。
const RE_META = /插件市场|上架|提交\s*pr|发布到|这个插件|我的插件|澄清优先|dsh-clarify/i
// 档位措辞（写在首条消息里，优先级高于配置）
const RE_DEPTH_DEEP = /多问点|多问几个|问细|细一点|详细问|问详细|深入|问深|问透|都问|多确认|别嫌烦/
const RE_DEPTH_LIGHT = /少问|简单问|快速问|别太啰嗦|少啰嗦|只问关键|一两问|精简问|别啰嗦/

// ---------------------------------------------------------------- 日志

function makeLog(ctx, cfg) {
  const tryShape = (obj) => {
    try {
      if (obj === undefined || obj === null) return undefined
      if (typeof obj === 'function') return obj
      if (typeof obj.info === 'function') return obj.info.bind(obj)
      if (typeof obj.debug === 'function') return obj.debug.bind(obj)
      if (typeof obj.log === 'function') return obj.log.bind(obj)
    } catch { /* ignore */ }
    return undefined
  }
  let logger
  try { logger = typeof ctx.logger === 'function' ? ctx.logger('clarify-first') : undefined } catch { logger = undefined }
  const info = tryShape(logger)
  return (level, ...args) => {
    if (level !== 'error' && cfg.debug !== true) return
    try {
      if (info) { info('[clarify-first] ' + args.map(String).join(' ')); return }
      if (level === 'error') console.error('[clarify-first]', ...args)
    } catch { /* 日志永远不能让插件挂掉 */ }
  }
}

// ---------------------------------------------------------------- 模板库

function packsDirOf(cfg) {
  if (typeof cfg.packsDir === 'string' && cfg.packsDir.trim() !== '') {
    return isAbsolute(cfg.packsDir) ? cfg.packsDir : join(process.cwd(), cfg.packsDir)
  }
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'packs')
}

function loadPacks(cfg, log) {
  const dir = packsDirOf(cfg)
  const packs = []
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')) } catch (err) {
    log('error', 'packs 目录读取失败', dir, err && err.message)
    return packs
  }
  for (const file of files) {
    try {
      const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (pack === null || typeof pack !== 'object') continue
      if (typeof pack.id !== 'string' || !Array.isArray(pack.points) || pack.points.length === 0) continue
      const points = pack.points
        .filter((p) => p && typeof p.q === 'string' && Array.isArray(p.opts) && p.opts.length >= 2)
        .map((p) => ({
          id: String(p.id ?? p.q),
          q: p.q,
          opts: p.opts
            .filter((o) => o && typeof o.v === 'string' && typeof o.label === 'string')
            .slice(0, 4),
        }))
        .filter((p) => p.opts.length >= 2)
      if (points.length === 0) continue
      packs.push({
        id: pack.id,
        title: typeof pack.title === 'string' ? pack.title : pack.id,
        priority: Number.isFinite(pack.priority) ? pack.priority : 0,
        match: Array.isArray(pack.match) ? pack.match.filter((m) => typeof m === 'string') : [],
        points,
      })
    } catch (err) {
      log('error', 'packs 解析失败', file, err && err.message)
    }
  }
  return packs
}

// ---------------------------------------------------------------- 匹配

function messageText(message) {
  if (message === null || typeof message !== 'object') return ''
  if (!Array.isArray(message.content)) return ''
  let text = ''
  for (const block of message.content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text + '\n'
    }
  }
  return text.trim()
}

function isHuman(message) {
  if (message === null || typeof message !== 'object') return false
  const source = message.source
  if (source !== undefined && source !== null && source.kind !== 'user') return false
  return messageText(message) !== ''
}

function countHits(haystack, needles) {
  const lower = haystack.toLowerCase()
  let n = 0
  for (const needle of needles) {
    if (needle !== '' && lower.includes(needle.toLowerCase())) n++
  }
  return n
}

/** 欠定义打分：任务意图 +2、产物类型 +2、含糊词 +1；出现具体性标记 −3。 */
function underspecScore(text) {
  let score = 0
  const reasons = []
  if (RE_ACTION.test(text)) { score += 2; reasons.push('action') }
  if (RE_ARTIFACT.test(text)) { score += 2; reasons.push('artifact') }
  if (RE_VAGUE.test(text)) { score += 1; reasons.push('vague') }
  const specific = []
  if (RE_SPECIFIC.test(text)) specific.push('stack')
  if (RE_PATH.test(text)) specific.push('path')
  if (RE_FENCE.test(text)) specific.push('code')
  if (RE_UNITS.test(text)) specific.push('units')
  if (RE_USE_WITH.test(text)) specific.push('useWith')
  if (specific.length > 0 && !RE_RESEARCH.test(text)) { score -= 3; reasons.push('specific:' + specific.join('+')) }
  else if (specific.length > 0) reasons.push('specific-ignored(research)')
  return { score, reasons }
}

function pickPack(packs, text) {
  let best = null
  let bestHits = 0
  for (const pack of packs) {
    if (pack.id === 'generic') continue
    const hits = countHits(text, pack.match)
    if (hits === 0) continue
    if (hits > bestHits || (hits === bestHits && best !== null && pack.priority > best.priority)) {
      best = pack
      bestHits = hits
    }
  }
  if (best !== null) return { pack: best, hits: bestHits }
  const generic = packs.find((p) => p.id === 'generic')
  return generic === undefined ? null : { pack: generic, hits: 0 }
}

function gearCount(cfg, depth) {
  const byGear = GEAR_COUNT[depth] === undefined ? GEAR_COUNT[2] : GEAR_COUNT[depth]
  const cap = Number.isFinite(cfg.maxPoints) && cfg.maxPoints > 0 ? cfg.maxPoints : byGear
  return Math.max(1, Math.min(byGear, cap, 5))
}

/** 按 lv 升序稳定排序后取前 n 个：lv1 永远先进，剩下的按原顺序补。 */
function splitPoints(pack, count) {
  const sorted = pack.points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => (a.point.lv - b.point.lv) || (a.index - b.index))
  return {
    picked: sorted.slice(0, count).map((x) => x.point),
    rest: sorted.slice(count).map((x) => x.point),
  }
}

const optLine = (point) => point.opts.map((o) => (o.default === true ? o.label + '(荐)' : o.label)).join('｜')

function renderNotice(pack, cfg, depth) {
  const gear = GEAR_COUNT[depth] === undefined ? 2 : depth
  const { picked, rest } = splitPoints(pack, gearCount(cfg, gear))
  const lines = []

  lines.push('【澄清优先·' + GEAR_NAME[gear] + '】这条请求能做，但几个选择会明显改变做法（「' + pack.title + '」的常用决策点）：')
  picked.forEach((point, i) => lines.push(i + 1 + ') ' + point.q + '：' + optLine(point)))

  // 深入档：第一轮之后还悬着啥。rest 已按 lv 升序，优先拿 lv2，实在没有才拿 lv3。
  const follow = gear === 3 ? rest.slice(0, 2) : []
  if (follow.length > 0) {
    lines.push('第二轮（拿到答案后，只问还悬着的）：' + follow.map((p, i) => String.fromCharCode(65 + i) + '. ' + p.q + '：' + optLine(p)).join('　'))
  }

  if (gear === 1) {
    lines.push('用法：用 ask_user_question 一次问完这 ' + picked.length + ' 问（推荐项注"推荐"），拿到答案直接开工；没问到的按推荐项自行决定，不要再追问。需求已明确就忽略本提示。')
  } else if (gear === 2) {
    lines.push('用法：用 ask_user_question 一次问完这 ' + picked.length + ' 问（推荐项注"推荐"），拿到答案直接开工；不要复述、改写或扩写用户的需求。需求已明确就忽略本提示直接做。')
  } else if (follow.length > 0) {
    lines.push('用法：第一轮用 ask_user_question 一次问完这 ' + picked.length + ' 问（推荐项注"推荐"）；拿到答案后，只对上面「第二轮」里仍悬着、且确实会改变做法的点补问一轮（最多 2 问，已答过的不再问），然后开工。不要复述或扩写需求。需求已明确就忽略本提示。')
  } else {
    lines.push('用法：用 ask_user_question 一次问完这 ' + picked.length + ' 问（推荐项注"推荐"），拿到答案直接开工；剩下的按推荐项自行决定，不再追问。不要复述或扩写需求。需求已明确就忽略本提示。')
  }
  return lines.join('\n')
}

function noticeMessage(content, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: content }],
    source: { kind: PLUGIN_TAG, form: 'notice', summary },
  }
}

// ---------------------------------------------------------------- 档位

/**
 * 档位文件：`{ "depth": 1|2|3 }`。
 * 默认位置 <DSH_HOME>/clarify-first/gear.json（DSH_HOME 取不到时用用户主目录）。
 * 缺失、坏 JSON、越界一律返回 0（= 不设，回落到配置）。
 */
function readGearDepth(cfg) {
  const configured = typeof cfg.gearFile === 'string' ? cfg.gearFile.trim() : ''
  const path = configured !== '' ? configured : join(process.env.DSH_HOME || homedir(), 'clarify-first', 'gear.json')
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const depth = raw === null || typeof raw !== 'object' ? NaN : Number(raw.depth)
    return depth === 1 || depth === 2 || depth === 3 ? depth : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------- 插件

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULT_CONFIG, ...(rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}) }
  const log = makeLog(ctx, cfg)
  const handled = new WeakSet()   // 已注入过的 agent（一次性）
  const muted = new WeakSet()     // 用户明确说别问
  const seenSessions = new Set()  // 兜底：agent 对象换了也认得住同一个会话

  const sessionKey = (agent) => {
    const header = agent === undefined || agent === null || agent.session === undefined || agent.session === null
      ? undefined
      : agent.session.header
    if (header === undefined || header === null) return ''
    const id = header.id === undefined ? header.sessionId : header.id
    return typeof id === 'string' ? id : ''
  }

  let packs = []
  let fileDepth = 0
  const reload = () => {
    packs = loadPacks(cfg, log)
    fileDepth = readGearDepth(cfg)
    log('debug', '已加载模板包 ' + packs.length + ' 个，档位文件=' + (fileDepth === 0 ? '未设' : fileDepth))
  }
  reload()

  const decide = (payload) => {
    if (cfg.enabled !== true) return null
    const agent = payload === undefined || payload === null ? undefined : payload.agent
    const messages = payload === undefined || payload === null ? undefined : payload.messages
    if (agent === undefined || agent === null) return null
    if (handled.has(agent) || muted.has(agent)) return null
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 24) return null
    const key = sessionKey(agent)
    if (key !== '' && seenSessions.has(key)) return null

    // 只看"本会话第一轮"：出现助手回复，或已经有过不止一条真人消息，都不再插手。
    let humanCount = 0
    for (const message of messages) {
      if (message === null || typeof message !== 'object') continue
      if (message.role === 'assistant') return null
      if (isHuman(message)) humanCount++
    }
    if (humanCount !== 1) return null
    let human = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isHuman(messages[i])) { human = messages[i]; break }
    }
    if (human === null) return null

    const header = agent.session === undefined || agent.session === null ? undefined : agent.session.header
    const cwd = header !== undefined && typeof header.cwd === 'string' ? header.cwd : ''
    if (cwd !== '' && Array.isArray(cfg.quietDirs)) {
      for (const dir of cfg.quietDirs) {
        if (typeof dir === 'string' && dir !== '' && cwd.toLowerCase().startsWith(dir.toLowerCase())) return null
      }
    }

    const text = messageText(human)
    if (text.length > 120) return null
    if (RE_TRIVIAL.test(text)) return null
    if (RE_META.test(text)) return null

    if (RE_MUTE.test(text)) { muted.add(agent); return null }

    const { score, reasons } = underspecScore(text)
    if (score < cfg.minScore) { log('debug', '未达阈值', score, reasons.join(',')); return null }

    if (packs.length === 0) { reload() }
    const picked = pickPack(packs, text)
    if (picked === null) return null

    // 档位优先级：首条消息里的措辞 > 档位文件（可热改）> 配置项。
    let depth = 0
    if (RE_DEPTH_DEEP.test(text)) depth = 3
    else if (RE_DEPTH_LIGHT.test(text)) depth = 1
    if (depth === 0) depth = fileDepth
    if (depth === 0) {
      const configured = Number(cfg.depth)
      depth = configured === 1 || configured === 2 || configured === 3 ? configured : 2
    }

    log('debug', '命中', picked.pack.id, 'score=' + score, '档位=' + GEAR_NAME[depth], reasons.join(','), 'hits=' + picked.hits)
    return { pack: picked.pack, score, depth }
  }

  ctx.on('agent/pre-step', (payload, next) => {
    let decision = null
    try {
      decision = decide(payload)
    } catch (err) {
      log('error', 'pre-step 判定异常', err && err.message)
      decision = null
    }
    if (decision === null) return next()

    const agent = payload.agent
    handled.add(agent)
    const key = sessionKey(agent)
    if (key !== '') seenSessions.add(key)
    const text = renderNotice(decision.pack, cfg, decision.depth)
    const summary = '澄清优先提示（' + decision.pack.title + '·' + GEAR_NAME[decision.depth] + '）'

    return Promise.resolve()
      .then(() => next())
      .then((downstream) => {
        if (downstream === null || typeof downstream !== 'object' || downstream.kind !== 'enter') return downstream
        if (!Array.isArray(downstream.messages)) return downstream
        return { ...downstream, messages: [...downstream.messages, noticeMessage(text, summary)] }
      })
      .catch((err) => {
        log('error', 'notice 注入失败', err && err.message)
        handled.delete(agent)
        return next()
      })
  })

  // 模板热更新：改 packs 后无需重启（失败静默）。
  const timer = setInterval(() => { try { reload() } catch { /* ignore */ } }, 60_000)
  if (typeof timer.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'clarify-first: packs 热更新')
}