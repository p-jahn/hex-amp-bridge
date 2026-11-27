// Run with Bun against the loaded plugin. Makes two billable generation calls.
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { userPaths } from './plugin/paths'

const root = import.meta.dir
const configuration = userPaths().bridge
const credential = join(configuration, 'credentials.json')
const { token } = await Bun.file(credential).json()
const base = 'http://127.0.0.1:47823'
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
async function check(name: string, expected: number, path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, { headers, ...options })
  assert.equal(response.status, expected, name)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  console.log(`PASS ${name}: HTTP ${response.status}`)
  return response
}
const health = await (await check('health', 200, '/health')).json()
const config = await Bun.file(join(configuration, 'config.json')).json()
assert.equal(health.model, config.model ?? null, 'Reload the bridge to apply the configured model')
console.log(`PASS loaded model matches configuration: ${health.model ?? 'Amp default'}`)
await check('missing credential', 401, '/rewrite', { method: 'POST', headers: {}, body: '{}' })
await check('wrong credential of same length', 401, '/rewrite', {
  method: 'POST', headers: { ...headers, authorization: 'Bearer ' + 'z'.repeat(64) }, body: '{}',
})
await check('browser origin', 403, '/rewrite', { method: 'POST', headers: { ...headers, origin: 'https://example.com' }, body: '{}' })
await check('DNS alias', 403, '/health', { headers: { ...headers, host: 'localhost:47823' } })
await check('preflight', 403, '/rewrite', { method: 'OPTIONS', headers: { origin: 'https://example.com' } })
await check('wrong route', 404, '/missing')
await check('wrong method', 405, '/rewrite')
await check('wrong content type', 415, '/rewrite', { method: 'POST', headers: { authorization: headers.authorization }, body: '{}' })
await check('malformed JSON', 400, '/rewrite', { method: 'POST', body: '{' })
for (const body of [null, [], {}, { text: 42 }, { text: 'hello', threadID: 'override' }]) {
  await check('invalid schema', 400, '/rewrite', { method: 'POST', body: JSON.stringify(body) })
}
await check('UTF-8 over limit', 413, '/rewrite', { method: 'POST', body: JSON.stringify({ text: 'é'.repeat(4097) }) })
const empty = await check('whitespace passthrough', 200, '/rewrite', { method: 'POST', body: JSON.stringify({ text: ' \n' }) })
assert.equal((await empty.json()).text, ' \n')

// Import the unchanged transform beside its credential in a protected temp
// directory, just as Hex imports it. This is Bun, not Hex's QuickJS engine.
const temporary = await mkdtemp(join(configuration, 'verify-'))
try {
  await copyFile(join(root, 'amp-rewrite.ts'), join(temporary, 'amp-rewrite.ts'))
  await copyFile(credential, join(temporary, 'amp-bridge.private.json'))
  const { ampRewrite } = await import(pathToFileURL(join(temporary, 'amp-rewrite.ts')).href)
  assert.equal(await ampRewrite.transform(' \n'), ' \n')
  for (const input of [
    'um hello anna can you send the 37 invoices by friday thanks',
    'äh hallo anna bitte schick mir die 37 rechnungen bis freitag danke',
  ]) {
    const started = performance.now()
    const text = await ampRewrite.transform(input)
    assert.ok(text.includes('37'), 'The invoice count must not change')
    assert.ok(/Anna/i.test(text), 'The name must not change')
    assert.ok(text !== input, 'The dictation should be edited')
    if (input.startsWith('äh')) assert.ok(/Rechnungen.*Freitag/i.test(text), 'German must stay German')
    else assert.ok(/invoices.*Friday/i.test(text), 'English must stay English')
    console.log(JSON.stringify({ input, text, elapsedMs: Math.round(performance.now() - started) }))
  }
  await assert.rejects(ampRewrite.transform('x'.repeat(8193)), /HTTP 413/)
  console.log('PASS transform throws on HTTP failure (Hex owns raw-text fallback)')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
console.log('PASS live bridge and Bun-hosted transform checks; installed Hex not exercised')
