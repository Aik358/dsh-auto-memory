import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url))
const source = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
const destination = resolve(process.argv[2] ?? '.')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run npm run pack:cli to build the standalone package')
const stage = await mkdtemp(join(tmpdir(), 'auto-memory-cli-pack-'))

try {
  await mkdir(destination, { recursive: true })
  const files = [
    'LICENSE', 'docs/auto-memory-cli.md', 'lib/dsh-home.js', 'lib/file-boundary.js',
    ...['cli', 'client', 'contract', 'discovery', 'legacy-client', 'legacy-discovery', 'settings',
      'tui', 'tui-board', 'tui-data', 'tui-screen', 'tui-text', 'tui-view'].map(name => `lib/terminal/${name}.js`),
    ...['antigravity', 'external-dsh-proxy', 'external-hosts', 'kimi'].map(name => `lib/harness/${name}.js`),
  ]
  for (const file of files) {
    const target = join(stage, file === 'docs/auto-memory-cli.md' ? 'README.md' : file)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(repo, file), target)
  }
  const metadata = {
    name: '@a9i5k4/auto-memory-cli',
    version: source.version,
    description: 'Standalone Auto Memory terminal client for DeepSeek Harness',
    license: source.license,
    repository: source.repository,
    type: 'module',
    engines: { node: '>=24' },
    bin: { 'auto-memory': './lib/terminal/cli.js' },
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n')
  const result = spawnSync(process.execPath, [npm, 'pack', '--pack-destination', destination, '--quiet'],
    { cwd: stage, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(stage, { recursive: true, force: true })
}
