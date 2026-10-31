// 一次把"发布前必须对齐的元数据"填好。
//
// 用法：node tools/prepare-release.mjs --owner <GitHub 用户名或组织> [--repo dsh-clarify-first]
//
// 做三件事：
//   1. 把 repository / homepage / bugs 写进 package.json（市场收录时 url 必须与仓库完全一致）；
//   2. 生成 market/<owner>__<repo>.yml —— 提 PR 时原样复制到 awesome-dsh-plugin 的 data/plugins/ 下；
//   3. 打印下一步（建仓库、推代码、提 PR）。
//
// 只改 package.json 与 market/ 下的 yml，不动其它文件。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error('--' + name + ' 缺少值')
  return v
}

const owner = arg('owner', '')
const repo = arg('repo', 'dsh-clarify-first')

if (owner === '') {
  console.error('缺少 --owner（你的 GitHub 用户名或组织名），例：node tools/prepare-release.mjs --owner octocat')
  process.exit(1)
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
  console.error('owner 不合法：只能是字母/数字/连字符，1~39 位')
  process.exit(1)
}
if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
  console.error('repo 不合法')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const url = 'https://github.com/' + owner + '/' + repo

pkg.repository = { type: 'git', url: 'git+' + url + '.git' }
pkg.homepage = url + '#readme'
pkg.bugs = { url: url + '/issues' }
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

// 市场条目：description.en 是唯一必填字段；含「: 」必须整体加引号，这里统一用双引号。
const entry = `url: ${url}
name: ${owner}/${repo}
category: workflow
description:
  en: "Asks the few key questions that decide the approach before work starts — one shot, about 200 tokens per session, no tool registration and no extra model call."
  zh: "开工前用一次提问把关键选择问清（静态还是动态、Hexo 还是 Hugo），约 200 token/会话，不注册工具、不额外调模型；可在精简/标准/深入三档间切换。"
`

const outDir = join(root, 'market')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, owner + '__' + repo + '.yml')
writeFileSync(outFile, entry, 'utf8')

console.log('已写入 package.json 的 repository/homepage/bugs：')
console.log('  ' + url)
console.log('')
console.log('市场条目已生成：' + outFile)
console.log('---')
console.log(entry)
console.log('---')
console.log('下一步：')
console.log('  1) 在 GitHub 上新建仓库 ' + owner + '/' + repo + '（空仓库，不要 README）')
console.log('  2) pwsh -File tools\\publish.ps1 -Owner ' + owner + ' -Repo ' + repo)
console.log('  3) 仓库满 1 天后，fork awesome-dsh-plugin，把上面这份 yml 放到 data/plugins/' + owner + '__' + repo + '.yml，提 PR')