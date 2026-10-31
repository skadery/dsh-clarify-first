# 把本目录变成一个可直接推到 GitHub 的仓库。
#
# 用法（在插件目录下）：
#   pwsh -File tools\publish.ps1 -Owner <你的 GitHub 用户名> -Repo dsh-clarify-first [-Push] [-Tag]
#
# -Owner/-Repo 会先交给 tools\prepare-release.mjs 填 package.json 的 repository 字段并生成市场条目 yml，
# 然后 git init / add / commit。加 -Push 才会真的 push（需要本机已有 GitHub 凭据，如 Git Credential Manager）；
# 加 -Tag 会打 v<version> 标签（想发 Release 的 .tgz 给市场用 tarball 字段时再打）。
#
# 注意：本脚本只做本地提交；push / Release 属于对外操作，默认不动，必须显式 -Push。

param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'dsh-clarify-first',
  [switch]$Push,
  [switch]$Tag
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ('== 1/4 对齐元数据（package.json + 市场条目 yml）')
node tools\prepare-release.mjs --owner $Owner --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'prepare-release 失败' }

Write-Host '== 2/4 自检'
node --check lib\index.js
if ($LASTEXITCODE -ne 0) { throw 'lib/index.js 语法错误' }
node tools\smoke.mjs | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw '冒烟测试未通过，先修再发' }
node tools\route.mjs | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw '路由回归未通过，先修再发' }

Write-Host '== 3/4 git init / add / commit'
if (-not (Test-Path '.git')) {
  git init -b main | Out-Null
}
$url = 'https://github.com/{0}/{1}.git' -f $Owner, $Repo
$remotes = @(git remote)
if ($remotes -notcontains 'origin') { git remote add origin $url }
else { git remote set-url origin $url }

# 本机没有全局 git 身份时，给这个仓库配一个本地身份，否则 commit 会报 "Please tell me who you are"
$who = git config user.name
if ([string]::IsNullOrWhiteSpace($who)) {
  git config user.name $Owner
  git config user.email ('{0}@users.noreply.github.com' -f $Owner)
  Write-Host ('   已设置本地 git 身份：{0} <{0}@users.noreply.github.com>' -f $Owner)
}

git add -A
$staged = @(git diff --cached --name-only)
if ($staged.Count -eq 0) { Write-Host '   没有待提交的改动' }
else {
  Write-Host ('   待提交 {0} 个文件' -f $staged.Count)
  $staged | ForEach-Object { Write-Host ('     ' + $_) }
  $msg = git log --oneline -1 2>$null
  git commit -m "feat: clarify-first v$(node -p "require('./package.json').version") - ask key questions once before work starts" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'git commit 失败' }
}

if ($Tag) {
  $ver = node -p "require('./package.json').version"
  git tag -a ('v' + $ver) -m ('v' + $ver) 2>$null
  Write-Host ('   已打标签 v{0}' -f $ver)
}

Write-Host '== 4/4 收尾'
if ($Push) {
  Write-Host ('   push 到 {0}' -f $url)
  git push -u origin main
  if ($Tag) { git push origin --tags }
  Write-Host '   完成。'
} else {
  Write-Host '   已本地提交，未推送。确认无误后执行：'
  Write-Host ('     git push -u origin main')
  if ($Tag) { Write-Host ('     git push origin --tags') }
}
Write-Host ''
Write-Host '下一步（提 PR 到 awesome-dsh-plugin）：'
Write-Host ('   market\{0}__{1}.yml   复制到 fork 的 data/plugins/ 下，提 PR' -f $Owner, $Repo)
Write-Host '   仓库需满 1 天、加 topic dsh-plugin，CI 才会通过。'