param(
  [Parameter(Mandatory=$true)][string]$ScriptId,
  [Parameter(Mandatory=$true)][string]$DeploymentId,
  [string]$ZipPath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (!(Test-Path (Join-Path $HOME '.clasprc.json'))) {
  throw 'Немає приватного файла авторизації clasp. У PowerShell запустіть: npx -y @google/clasp@3.4.1 login (лише ваш особистий Google-акаунт).'
}
if ($ScriptId -notmatch '^[A-Za-z0-9_-]{15,}$' -or $DeploymentId -notmatch '^[A-Za-z0-9_-]{15,}$') {
  throw 'Перевірте Script ID та Deployment ID (це різні ідентифікатори, не ID таблиці).'
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ("crm-clasp-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  if ($ZipPath) {
    $zip = (Resolve-Path $ZipPath).Path
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
  } else {
    Set-Location $repo
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Тести не пройдені.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Збірка не пройдена.' }
    & node scripts/verify-cloud-release.js
    if ($LASTEXITCODE -ne 0) { throw 'Збірка не пройшла перевірку перед розгортанням.' }
    Copy-Item -Path (Join-Path $repo 'dist/apps-script/*') -Destination $temp -Force
  }
  $expected = @('Code.gs', 'Server.gs', 'Index.html', 'appsscript.json')
  $present = @(Get-ChildItem -LiteralPath $temp -File | ForEach-Object Name)
  if ( @(Compare-Object $expected $present).Count -gt 0 ) { throw 'Архів повинен містити рівно чотири файли Apps Script у корені.' }
  & node (Join-Path $repo 'scripts/verify-cloud-release.js') $temp
  if ($LASTEXITCODE -ne 0) { throw 'Збірка не пройшла перевірку перед розгортанням.' }
  $manifest = Get-Content -Raw (Join-Path $temp 'appsscript.json') | ConvertFrom-Json
  if ($manifest.webapp.access -ne 'MYSELF' -or $manifest.webapp.executeAs -ne 'USER_ACCESSING') { throw 'Відхилено: небезпечні налаштування вебзастосунку.' }
  $config = @{ scriptId = $ScriptId; rootDir = '.' } | ConvertTo-Json -Compress
  Set-Content -LiteralPath (Join-Path $temp '.clasp.json') -Value $config -Encoding utf8
  Set-Location $temp
  Write-Host 'Оновлення наявного Apps Script; дані в Google Sheets не змінюються цим сценарієм.'
  & npx --yes '@google/clasp@3.4.1' push --force *> $null
  if ($LASTEXITCODE -ne 0) { throw 'clasp push завершився помилкою. Не створено нове розгортання.' }
  & npx --yes '@google/clasp@3.4.1' create-deployment --deploymentId $DeploymentId --description "CRM $(Get-Date -Format 'yyyy-MM-dd_HH-mm')" *> $null
  if ($LASTEXITCODE -ne 0) { throw 'clasp create-deployment завершився помилкою. Чернетковий код завантажений; перевірте чинне розгортання.' }
  Write-Host 'Успішно. Перевірте свій старий URL /exec.'
} finally {
  Set-Location $repo
  $cleanupPath = [IO.Path]::GetFullPath($temp)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (!$cleanupPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($cleanupPath) -notmatch '^crm-clasp-[a-f0-9]{32}$') {
    throw 'Відхилено очищення поза тимчасовою папкою випуску.'
  }
  Remove-Item -LiteralPath $cleanupPath -Recurse -Force -ErrorAction SilentlyContinue
}
