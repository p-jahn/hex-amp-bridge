import { execFile } from 'node:child_process'
import credential from './amp-bridge.private.json'

let lastWarning = -Infinity

async function warnOnWindows() {
  if (Date.now() - lastWarning < 5 * 60 * 1000) return
  lastWarning = Date.now()
  // Hex has no process.platform. Missing powershell.exe on other platforms is
  // harmless; the script also checks the OS before using Windows-only APIs.
  await new Promise<void>(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { exit 0 }
$app = Get-StartApps | Where-Object { $_.Name -eq 'Hex' } | Select-Object -First 1
if (!$app) { throw 'Hex Start menu registration is unavailable' }
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast duration="short"><visual><binding template="ToastGeneric"><text>Amp cleanup unavailable</text><text>Your original transcript will be pasted without Amp cleanup. Check Amp and the rewrite bridge.</text></binding></visual></toast>')
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.Tag = 'amp-rewrite'
$toast.Group = 'hex-amp-bridge'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app.AppID).Show($toast)
`], { timeout: 5000, maxBuffer: 4096 }, error => {
      if (error && error.code !== 'ENOENT') console.log('Amp cleanup warning could not be shown')
      resolve()
    })
  })
}

export const ampRewrite = {
  name: 'Rewrite with Amp',
  description: 'Tidy dictation through the local Amp plugin bridge',
  timeout: 55000,
  async transform(text: string) {
    if (!text.trim()) return text
    try {
      const response = await fetch('http://127.0.0.1:47823/rewrite', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credential.token}`,
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(48000),
      })
      if (!response.ok) throw new Error(`Amp rewrite failed (HTTP ${response.status})`)
      const result = await response.json()
      if (typeof result.text !== 'string' || !result.text.trim()) {
        throw new Error('Amp returned an invalid rewrite')
      }
      return result.text
    } catch (error) {
      // A blocked/unsupported notification must never replace the rewrite error.
      try { await warnOnWindows() } catch {}
      throw error
    }
  },
}
