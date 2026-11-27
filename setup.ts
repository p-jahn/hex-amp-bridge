import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { userPaths } from './plugin/paths'

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    thread: { type: 'string' },
    model: { type: 'string' },
    'install-hex': { type: 'boolean' },
    'print-paths': { type: 'boolean' },
    help: { type: 'boolean' },
  },
})
const paths = userPaths()
if (values.help) {
  console.log('bun setup.ts --thread T-... [--model provider/model] [--install-hex]')
  console.log('Existing configuration and differing installed files are never overwritten.')
  console.log('Use --print-paths to inspect resolved user directories without changing anything.')
  process.exit(0)
}
if (values['print-paths']) {
  console.log(JSON.stringify(paths, null, 2))
  process.exit(0)
}

const configPath = join(paths.bridge, 'config.json')
const config = await Bun.file(configPath).exists()
  ? JSON.parse(await readFile(configPath, 'utf8'))
  : { threadID: values.thread, model: values.model ?? null }
if (!config || typeof config !== 'object' || Array.isArray(config)
  || !/^T-[0-9a-f-]{36}$/i.test(config.threadID)) {
  throw new Error('Provide --thread with an accessible Amp thread ID, or correct the existing user config.json.')
}
if (config.model != null && (typeof config.model !== 'string'
  || !/^[a-z0-9][a-z0-9-]*\/[^\s/]+(?:\/[^\s/]+)*$/.test(config.model))) {
  throw new Error('The model must be a provider/model identifier, null, or omitted.')
}
if ((values.thread !== undefined && values.thread !== config.threadID)
  || (values.model !== undefined && values.model !== config.model)) {
  throw new Error('Existing settings differ from the arguments. Edit the user config.json explicitly; setup preserves it.')
}

async function protect(path: string, directory = false) {
  if (process.platform !== 'win32') {
    await chmod(path, directory ? 0o700 : 0o600)
    return
  }
  const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })
  const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0]
  if (!sid) throw new Error('Could not determine the Windows user SID.')
  const flags = directory ? '(OI)(CI)' : ''
  execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `*${sid}:${flags}F`, `*S-1-5-18:${flags}F`])
}

async function installFile(path: string, bytes: Uint8Array, privateFile = false) {
  if (await Bun.file(path).exists()) {
    if (!Buffer.from(await readFile(path)).equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite a differing file: ${path}`)
    }
    if (privateFile) await protect(path)
    return
  }
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'wx', privateFile ? 0o600 : 0o644)
  await file.close()
  // Set Windows ACLs before writing any credential bytes.
  if (privateFile) await protect(path)
  await writeFile(path, bytes)
}

await mkdir(paths.bridge, { recursive: true, mode: 0o700 })
await protect(paths.bridge, true)
if (!await Bun.file(configPath).exists()) {
  await installFile(configPath, Buffer.from(JSON.stringify(config, null, 2) + '\n'), true)
}
const credentialPath = join(paths.bridge, 'credentials.json')
if (!await Bun.file(credentialPath).exists()) {
  await installFile(credentialPath, Buffer.from(JSON.stringify({ token: randomBytes(32).toString('hex') }) + '\n'), true)
}
await protect(credentialPath)
const credentialBytes = await readFile(credentialPath)
try {
  if (!/^[0-9a-f]{64}$/.test(JSON.parse(credentialBytes.toString('utf8')).token)) throw new Error()
} catch {
  throw new Error('Invalid bridge credentials.json. Existing credentials were not replaced.')
}

for (const extension of ['ts', 'js']) {
  if (await Bun.file(join(paths.ampPlugins, `hex-rewrite.${extension}`)).exists()) {
    throw new Error('A single-file hex-rewrite plugin already exists in the user plugin directory. Migrate it before installing.')
  }
}
for (const file of ['index.ts', 'paths.ts']) {
  await installFile(join(paths.ampPlugins, 'hex-rewrite', file), await readFile(join(import.meta.dir, 'plugin', file)))
}
console.log(`Bridge configuration: ${paths.bridge}`)
console.log(`Amp plugin installed: ${join(paths.ampPlugins, 'hex-rewrite')}`)

if (values['install-hex']) {
  await installFile(join(paths.hex, 'amp-bridge.private.json'), credentialBytes, true)
  await installFile(join(paths.hex, 'amp-rewrite.ts'), await readFile(join(import.meta.dir, 'amp-rewrite.ts')))
  if (!await Bun.file(join(paths.hex, 'hex.config.ts')).exists()
    && !await Bun.file(join(paths.hex, 'hex.config.js')).exists()) {
    await installFile(join(paths.hex, 'hex.config.ts'), await readFile(join(import.meta.dir, 'hex.config.example.ts')))
    console.log('Created Hex config. Approve fetch/program access in Output and select Rewrite with Amp.')
  } else {
    console.log("Preserved Hex config. Ensure it imports ampRewrite from './amp-rewrite.ts' and registers 'amp-rewrite'.")
    console.log('Changed Hex files require user reapproval in Output. Setup never approves access or selects a mode.')
  }
} else {
  console.log('Hex config unchanged. Use --install-hex to install the transform and protected credential copy.')
}
console.log('Reload Amp plugins after installation. Keep only one bridge host listening on 127.0.0.1:47823.')
