import { spawn } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const out = path.join(repo, 'artifacts/_index-gov-20261109/out')
await mkdir(out, { recursive: true })
const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const tests = (await readdir(testDirectory)).filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join(testDirectory, name))
const startedAt = new Date().toISOString()
const result = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', value => { stdout += value; process.stdout.write(value) })
  child.stderr.on('data', value => { stderr += value; process.stderr.write(value) })
  child.once('error', reject)
  child.once('exit', (exitCode, signal) => resolve({ exitCode, signal, stdout, stderr }))
})
const number = name => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0)
const summary = { startedAt, finishedAt: new Date().toISOString(), runtime: process.version, exitCode: result.exitCode, signal: result.signal, files: tests.map(file => path.relative(repo, file).replaceAll('\\', '/')), tests: number('tests'), passed: number('pass'), failed: number('fail'), skipped: number('skipped'), stderr: result.stderr, tapFile: 'artifacts/_index-gov-20261109/out/prototype-tests.tap' }
await writeFile(path.join(out, 'prototype-tests.tap'), result.stdout)
await writeFile(path.join(out, 'prototype-tests.json'), JSON.stringify(summary, null, 2) + '\n')
process.exitCode = result.exitCode ?? 1
