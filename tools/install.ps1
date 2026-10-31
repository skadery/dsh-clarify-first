# 把 dsh-clarify-first 装进 DSH 的 desktop profile。
#
# 用法（在普通 PowerShell 里，不需要管理员）：
#   .\tools\install.ps1 -DryRun     # 只打印将要做的事，不改任何文件
#   .\tools\install.ps1             # 真正安装（会先备份 profile 的 package.json）
#
# 做两件事：
#   1. 用 DSH 自带 CLI 执行 `dsh plugin --profile desktop add link:<本目录>`（pnpm 建链接 + 记依赖）
#   2. 把 "dsh-clarify-first" 追加进 profile package.json 的 dsh.profile.bundles
#      —— 桌面版启动器是按 bundles 列表装载插件的，只 pnpm add 不会生效
# 装完需要重启 DSH 才会加载。

param(
  [switch]$DryRun,
  [string]$Profile = 'desktop',
  [string]$DshPath = ''
)

$ErrorActionPreference = 'Stop'
$pluginDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkgPath = Join-Path $pluginDir 'package.json'
$pluginName = (Get-Content $pkgPath -Raw | ConvertFrom-Json).name

if ([string]::IsNullOrWhiteSpace($DshPath)) {
  $candidates = @(
    'F:\DSH\resources\runtime\cli\bin\dsh.cmd',
    (Join-Path ${env:ProgramFiles} 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $DshPath = $c; break } }
}
if ([string]::IsNullOrWhiteSpace($DshPath) -or -not (Test-Path $DshPath)) {
  throw "找不到 DSH 的 CLI（dsh.cmd）。请用 -DshPath 'D:\...\resources\runtime\cli\bin\dsh.cmd' 指定。"
}

$dshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = 'F:\DSHHome' }
$profilePkg = Join-Path $dshHome ('profiles\{0}\package.json' -f $Profile)
if (-not (Test-Path $profilePkg)) { throw "profile 不存在：$profilePkg" }

Write-Host "插件目录 : $pluginDir"
Write-Host "插件名   : $pluginName"
Write-Host "DSH CLI  : $DshPath"
Write-Host "profile  : $profilePkg"
Write-Host ''

$spec = "link:$pluginDir"
Write-Host "[1/2] $DshPath plugin --profile $Profile add `"$spec`""

$json = Get-Content $profilePkg -Raw | ConvertFrom-Json
$bundles = @()
if ($json.dsh -and $json.dsh.profile -and $json.dsh.profile.bundles) { $bundles = @($json.dsh.profile.bundles) }
$needBundle = -not ($bundles -contains $pluginName)
Write-Host "[2/2] 往 dsh.profile.bundles 追加 `"$pluginName`" ：$([bool]$needBundle)"

if ($DryRun) {
  Write-Host ''
  Write-Host 'DRY RUN：以上为计划，未做任何修改。'
  Write-Host "当前 bundles：$($bundles -join ', ')"
  exit 0
}

# ---- 备份
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$profilePkg.bak-$stamp"
Copy-Item $profilePkg $backup
Write-Host "已备份 → $backup"

# ---- 1) pnpm 安装（link）
& $DshPath plugin --profile $Profile add $spec
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败（exit $LASTEXITCODE），profile 未改动 bundles，可用 $backup 回退。" }

# ---- 2) 注册到 bundles（保留原格式缩进：两空格）
$raw = Get-Content $profilePkg -Raw
if ($needBundle) {
  $json = $raw | ConvertFrom-Json
  $json.dsh.profile.bundles = @($bundles + $pluginName)
  $raw = $json | ConvertTo-Json -Depth 20
  Set-Content $profilePkg $raw -Encoding UTF8
  Write-Host "已写入 bundles：$pluginName"
} else {
  Write-Host "bundles 已包含 $pluginName，跳过"
}

# ---- 校验
try {
  $check = Get-Content $profilePkg -Raw | ConvertFrom-Json
  $ok = @($check.dsh.profile.bundles) -contains $pluginName
  Write-Host ("校验：bundles 含插件 = " + $ok)
} catch {
  Write-Host "校验失败，JSON 可能损坏，请用备份还原：Copy-Item '$backup' '$profilePkg' -Force"
  throw
}

Write-Host ''
Write-Host '安装完成。重启 DSH（DeepSeek Harness）后生效：'
Write-Host '  验证：新开一个会话，输入「帮我做一个网页博客」→ 应当先弹出一张包含「站点形态 / 生成方式 / 部署方式」的选项卡。'
Write-Host "  回退：Copy-Item '$backup' '$profilePkg' -Force 并重启（node_modules 里的链接可留可删）。"