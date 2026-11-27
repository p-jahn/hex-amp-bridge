import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { userPaths } from './plugin/paths'

test('native bridge directories and application-owned discovery paths', () => {
  expect(userPaths('win32', { APPDATA: 'C:\\Roaming', XDG_CONFIG_HOME: 'D:\\Config' }, 'C:\\Users\\Test')).toEqual({
    bridge: 'C:\\Roaming\\hex-amp-bridge',
    ampPlugins: 'D:\\Config\\amp\\plugins',
    hex: 'C:\\Users\\Test\\.config\\hex',
  })
  expect(userPaths('win32', {}, 'C:\\Users\\Test').bridge).toBe('C:\\Users\\Test\\AppData\\Roaming\\hex-amp-bridge')
  expect(userPaths('darwin', { XDG_CONFIG_HOME: '/custom/config' }, '/Users/test')).toEqual({
    bridge: '/Users/test/Library/Application Support/hex-amp-bridge',
    ampPlugins: '/custom/config/amp/plugins',
    hex: '/Users/test/.config/hex',
  })
  expect(userPaths('linux', { XDG_CONFIG_HOME: '/custom/config' }, '/home/test')).toEqual({
    bridge: '/custom/config/hex-amp-bridge',
    ampPlugins: '/custom/config/amp/plugins',
    hex: '/home/test/.config/hex',
  })
  expect(userPaths('linux', {}, '/home/test').bridge).toBe('/home/test/.config/hex-amp-bridge')
  expect(userPaths('linux', { XDG_CONFIG_HOME: 'relative' }, '/home/test')).toEqual(userPaths('linux', {}, '/home/test'))
})

test('setup protects credentials, preserves settings/configs, and refuses collisions', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'hex-amp-bridge-'))
  try {
    const home = join(temporary, 'home')
    await mkdir(home)
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(temporary, 'roaming'),
      XDG_CONFIG_HOME: join(temporary, 'xdg'),
    }
    const paths = userPaths(process.platform, env, home)
    const run = (...args: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, 'setup.ts'), ...args], {
      env, stdout: 'pipe', stderr: 'pipe',
    })
    const discovery = run('--print-paths')
    expect(discovery.exitCode).toBe(0)
    // Guard the isolation before allowing the installer to write anything.
    expect(JSON.parse(discovery.stdout.toString())).toEqual(paths)
    expect(run().exitCode).not.toBe(0)
    const initial = run('--thread', 'T-00000000-0000-0000-0000-000000000001', '--install-hex')
    if (initial.exitCode) throw new Error(initial.stderr.toString())
    const credentialPath = join(paths.bridge, 'credentials.json')
    const originalCredential = await readFile(credentialPath, 'utf8')
    expect(JSON.parse(originalCredential).token).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(join(paths.hex, 'amp-bridge.private.json'), 'utf8')).toBe(originalCredential)
    expect(initial.stdout.toString()).not.toContain(JSON.parse(originalCredential).token)
    expect(await readFile(join(paths.ampPlugins, 'hex-rewrite', 'index.ts'), 'utf8'))
      .toBe(await readFile(join(import.meta.dir, 'plugin', 'index.ts'), 'utf8'))

    if (process.platform === 'win32') {
      const acl = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:HEX_TEST_CREDENTIAL
@{ protected = $acl.AreAccessRulesProtected; inherited = @($acl.Access | Where-Object IsInherited).Count;
 identities = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } | ConvertTo-Json
`], { env: { ...process.env, PSModulePath: undefined, HEX_TEST_CREDENTIAL: credentialPath }, encoding: 'utf8' }))
      expect(acl.protected).toBe(true)
      expect(acl.inherited).toBe(0)
      expect(acl.identities).toHaveLength(2)
      expect(acl.identities).toContain('S-1-5-18')
    } else {
      expect((await stat(credentialPath)).mode & 0o777).toBe(0o600)
      expect((await stat(paths.bridge)).mode & 0o777).toBe(0o700)
    }

    const configPath = join(paths.bridge, 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    config.model = 'openai/gpt-6-luna'
    const customized = JSON.stringify(config, null, 4) + '\n'
    await writeFile(configPath, customized)
    await rm(join(paths.hex, 'hex.config.ts'))
    const existingHex = '// Existing user config\nexport default {}\n'
    await writeFile(join(paths.hex, 'hex.config.js'), existingHex)
    expect(run('--install-hex').exitCode).toBe(0)
    expect(await readFile(configPath, 'utf8')).toBe(customized)
    expect(await readFile(credentialPath, 'utf8')).toBe(originalCredential)
    expect(await readFile(join(paths.hex, 'hex.config.js'), 'utf8')).toBe(existingHex)
    expect(await Bun.file(join(paths.hex, 'hex.config.ts')).exists()).toBe(false)
    expect(run('--model', 'openai/other-model').exitCode).not.toBe(0)
    expect(await readFile(configPath, 'utf8')).toBe(customized)

    const transformed = '// User-customized transform\n'
    await writeFile(join(paths.hex, 'amp-rewrite.ts'), transformed)
    expect(run('--install-hex').exitCode).not.toBe(0)
    expect(await readFile(join(paths.hex, 'amp-rewrite.ts'), 'utf8')).toBe(transformed)
    expect(await readFile(credentialPath, 'utf8')).toBe(originalCredential)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30000)
