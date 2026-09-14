// Run with Bun and a read-only OMP checkout path as the first argument.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const reference = process.argv[2]
assert.ok(reference, 'Pass the read-only oh-my-pi source checkout path')
const source = (path) =>
  pathToFileURL(join(resolve(reference), 'packages/coding-agent/src', path)).href
const { loadExtensions } = await import(source('extensibility/extensions/loader.ts'))
const { EventBus } = await import(source('utils/event-bus.ts'))
const { SessionManager } = await import(source('session/session-manager.ts'))
const scratch = await mkdtemp(join(tmpdir(), 'orca-omp-child-status-'))
const posts = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) {
    body += chunk
  }
  posts.push(JSON.parse(body).payload)
  response.writeHead(200).end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  await build({
    entryPoints: ['src/main/pi/agent-status-extension-source.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(scratch, 'generator.mjs')
  })
  const { getPiAgentStatusExtensionSource } = await import(
    pathToFileURL(join(scratch, 'generator.mjs')).href
  )
  const extensionPath = join(scratch, 'orca-agent-status.ts')
  await writeFile(extensionPath, getPiAgentStatusExtensionSource('omp'))
  process.env.ORCA_PANE_KEY = 'test-parent-pane'
  process.env.ORCA_AGENT_HOOK_PORT = String(server.address().port)
  process.env.ORCA_AGENT_HOOK_TOKEN = 'test-token'
  delete process.env.ORCA_AGENT_HOOK_ENDPOINT
  delete process.env.ORCA_PI_STATUS_OWNED
  const load = async () => {
    const result = await loadExtensions([extensionPath], scratch, new EventBus())
    assert.deepEqual(result.errors, [])
    return result.extensions[0]
  }
  const rootManager = SessionManager.inMemory(scratch)
  const childManager = SessionManager.inMemory(scratch)
  const emit = async (extension, type, manager) => {
    for (const handler of extension.handlers.get(type) ?? []) {
      await handler({ type }, { sessionManager: manager, hasUI: false })
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  const root = await load()
  await emit(root, 'session_start', rootManager)
  await emit(root, 'agent_start', rootManager)
  const child = await load()
  assert.notEqual(root, child)
  await emit(child, 'session_start', childManager)
  await emit(child, 'agent_start', childManager)
  await emit(child, 'agent_end', childManager)
  assert.deepEqual(
    posts.map((post) => post.hook_event_name),
    ['agent_start']
  )
  await emit(root, 'agent_end', rootManager)
  await writeFile(extensionPath, `${getPiAgentStatusExtensionSource('omp')}\n// Reloaded module\n`)
  const reloaded = await load()
  await emit(reloaded, 'session_start', rootManager)
  const previousId = rootManager.getSessionId()
  await rootManager.newSession()
  assert.notEqual(rootManager.getSessionId(), previousId)
  await emit(reloaded, 'agent_start', rootManager)
  await emit(reloaded, 'agent_end', rootManager)
  assert.deepEqual(
    posts.map((post) => post.hook_event_name),
    ['agent_start', 'agent_end', 'agent_start', 'agent_end']
  )
  console.log(
    JSON.stringify({
      platform: process.platform,
      posts: posts.map((post) => post.hook_event_name),
      distinctManagers: rootManager !== childManager,
      scope:
        'Actual OMP loader, EventBus and in-memory SessionManager; synthetic lifecycle callbacks; real native HTTP'
    })
  )
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
