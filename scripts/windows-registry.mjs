import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { nativeRegistrySubkey } from './native-platform.mjs';

// A fixed PowerShell program uses .NET registry APIs so Unicode paths do not
// depend on reg.exe's localized output or the terminal code page.
const program = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$subkey = $env:NEXLY_NATIVE_REGISTRY_SUBKEY
$expected = $env:NEXLY_NATIVE_REGISTRY_MANIFEST
$action = $env:NEXLY_NATIVE_REGISTRY_ACTION
$views = @([Microsoft.Win32.RegistryView]::Registry32)
if ([Environment]::Is64BitOperatingSystem) { $views += [Microsoft.Win32.RegistryView]::Registry64 }
$records = @()
foreach ($view in $views) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    $key = $base.OpenSubKey($subkey)
    $value = $null
    try { if ($null -ne $key) { $value = $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } }
    finally { if ($null -ne $key) { $key.Dispose() } }
    $records += [pscustomobject]@{ view = $view.ToString(); manifestPath = $value }
  } finally { $base.Dispose() }
}
if ($action -eq 'query') {
  ConvertTo-Json -InputObject @($records) -Compress
  exit 0
}
if ($action -ne 'register' -and $action -ne 'remove') { throw 'Unknown registry operation.' }
foreach ($record in $records) {
  if ($null -ne $record.manifestPath -and -not [string]::Equals($record.manifestPath, $expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A different native host is already registered; no registry values were changed.'
  }
}
foreach ($view in $views) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    if ($action -eq 'register') {
      $key = $base.CreateSubKey($subkey)
      try { $key.SetValue('', $expected, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
    } else {
      $key = $base.OpenSubKey($subkey, $true)
      if ($null -ne $key) {
        $empty = $false
        try {
          $value = $key.GetValue('', $null)
          if ($null -ne $value) { $key.DeleteValue('', $false) }
          $empty = $key.ValueCount -eq 0 -and $key.SubKeyCount -eq 0
        } finally { $key.Dispose() }
        if ($empty) { $base.DeleteSubKey($subkey, $false) }
      }
    }
  } finally { $base.Dispose() }
}
`;

export function windowsRegistration(action, manifestPath, browser = 'chrome') {
  if (process.platform !== 'win32') throw new Error('Windows 注册表操作仅适用于 Windows。');
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', program], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: {
        ...process.env,
        NEXLY_NATIVE_REGISTRY_SUBKEY: nativeRegistrySubkey(browser),
        NEXLY_NATIVE_REGISTRY_MANIFEST: manifestPath,
        NEXLY_NATIVE_REGISTRY_ACTION: action
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return action === 'query' ? JSON.parse(output.replace(/^\uFEFF/, '').trim()) : undefined;
  } catch (error) {
    throw new Error('浏览器本地桥注册表操作失败；请检查是否已有不同来源的同名配置，以及当前用户的注册表权限。', { cause: error });
  }
}
