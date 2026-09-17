import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyPatch, parsePatch, reversePatch } from 'diff'
import { build } from 'esbuild'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Run with ORCA_BACKGROUND_LAUNCH=1.')
}

const root = fileURLToPath(new URL('../../../', import.meta.url))
const patch = await readFile(new URL('./fix.patch', import.meta.url), 'utf8')
const expectedSourceHashes = {
  before: 'f0326e6be534a321adc765bc0bf95ef72debe5ac701861c82e96b87ec822f022',
  after: '3d6ec639f4849944dc73f7c9d73c243bc34375ce8e2ba1584d6350e91763edbd'
}
const beforeSources = {}
const sourceHashes = {}
for (const parsed of parsePatch(patch)) {
  const path = parsed.newFileName.replace(/^b\//, '')
  const absolute = resolve(root, path)
  const current = await readFile(absolute, 'utf8')
  const before = applyPatch(current, reversePatch(parsed))
  if (before === false) {
    throw new Error(`Source changed; review the proof patch: ${path}`)
  }
  beforeSources[absolute.replaceAll('\\', '/')] = before
  sourceHashes[path] = {
    before: createHash('sha256').update(before).digest('hex'),
    after: createHash('sha256').update(current).digest('hex')
  }
  if (
    sourceHashes[path].before !== expectedSourceHashes.before ||
    sourceHashes[path].after !== expectedSourceHashes.after
  ) {
    throw new Error(`Source hash changed; review this evidence: ${path}`)
  }
}

for (const path of [
  'src/main/crash-reporting/crashpad-capture-read-limit.test.ts',
  'src/main/crash-reporting/minidump-crash-signature.ts',
  'src/shared/node-bounded-file-reader.ts'
]) {
  sourceHashes[path] = {
    current: createHash('sha256')
      .update(await readFile(resolve(root, path)))
      .digest('hex')
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'orca-crashpad-read-limit-'))
const require = createRequire(import.meta.url)
let runnerModuleId
try {
  const runnerPath = join(scratch, 'run-process.cjs')
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'src/shared/child-process/run-process.ts')],
    outfile: runnerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent'
  })
  runnerModuleId = require.resolve(runnerPath)
  const { runProcess } = require(runnerModuleId)
  const baselineConfig = join(scratch, 'before.config.mjs')
  const fixedConfig = join(scratch, 'after.config.mjs')
  const includes = ['src/main/crash-reporting/crashpad-capture-read-limit.test.ts']
  const configImport = JSON.stringify(pathToFileURL(resolve(root, 'config/vitest.config.ts')).href)
  await writeFile(
    baselineConfig,
    `import base from ${configImport};
const beforeSources = ${JSON.stringify(beforeSources)};
export default {...base, test: {...base.test, include: ${JSON.stringify(includes)}, testNamePattern: /^(?!bounds same-open growth)/}, plugins: [{
  name: 'crashpad-read-limit-before-fix', enforce: 'pre',
  transform(_code, id) {
    const before = beforeSources[id.replaceAll('\\\\', '/').split('?')[0]];
    return before === undefined ? null : {code: before, map: null};
  }
}]};\n`
  )

  await writeFile(
    fixedConfig,
    `import base from ${configImport};\nexport default {...base, test: {...base.test, include: ${JSON.stringify(includes)}}};\n`
  )

  async function run(label, config) {
    const report = join(scratch, `${label}.json`)
    const result = await runProcess({
      program: process.execPath,
      args: [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        config,
        '--reporter=json',
        `--outputFile=${report}`
      ],
      cwd: root,
      env: process.env,
      timeoutMs: 90_000,
      maxOutputBytes: 4 * 1024 * 1024
    })
    let parsed
    try {
      parsed = JSON.parse(await readFile(report, 'utf8'))
    } catch (error) {
      throw new Error(`${label} runner failed: ${result.stderr || result.stdout}`, { cause: error })
    }
    return {
      exitCode: result.code,
      timedOut: result.timedOut,
      passed: parsed.numPassedTests,
      failed: parsed.numFailedTests,
      skipped: parsed.numPendingTests,
      failedCases: parsed.testResults.flatMap((suite) =>
        suite.assertionResults
          .filter((test) => test.status === 'failed')
          .map((test) => test.fullName)
      )
    }
  }

  const before = await run('before', baselineConfig)
  const after = await run('after', fixedConfig)
  const passed =
    before.exitCode === 1 &&
    !before.timedOut &&
    before.failed === 3 &&
    before.passed === 4 &&
    before.skipped === 1 &&
    after.exitCode === 0 &&
    !after.timedOut &&
    after.passed === 8 &&
    after.failed === 0 &&
    after.skipped === 0
  const result = {
    comparison:
      'Actual crashpad capture and parser with temporary synthetic files; before reverses only fix.patch in memory; descriptor-growth control is fixed-only',
    sourceHashes,
    before,
    after,
    passed
  }
  await writeFile(
    new URL('./results.json', import.meta.url),
    `${JSON.stringify(result, null, 2)}\n`
  )
  console.log(JSON.stringify(result, null, 2))
  if (!passed) {
    process.exitCode = 1
  }
} finally {
  if (runnerModuleId) {
    delete require.cache[runnerModuleId]
  }
  await rm(scratch, { recursive: true, force: true })
}
