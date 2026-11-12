import { acquireSharedStateLock } from '../../../lib/shared-state-lock.js'

const release = await acquireSharedStateLock(process.argv[2], { timeoutMs: 1000 })
process.send('ready')
process.on('message', message => {
  if (message !== 'release') return
  release()
  process.send('released', () => process.exit(0))
})
process.on('disconnect', () => process.exit(0))
setInterval(() => {}, 1000)
