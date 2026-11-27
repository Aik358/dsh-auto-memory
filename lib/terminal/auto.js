#!/usr/bin/env node
const [, , command] = process.argv

if (command === 'memory') {
  process.argv.splice(2, 1)
  await import('./cli.js')
} else if (command === undefined || command === '--help' || command === '-h') {
  process.stdout.write('Usage: auto memory [options]\n')
} else {
  process.stderr.write('Usage: auto memory [options]\n')
  process.exitCode = 2
}
