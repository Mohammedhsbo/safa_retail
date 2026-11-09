import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { prisma } from './database.js'

const config = loadConfig()
const app = createApp(config)
const server = app.listen(config.port, () => {
  console.info(JSON.stringify({ event: 'server.ready', port: config.port }))
})

async function shutdown(signal: string): Promise<void> {
  console.info(JSON.stringify({ event: 'server.shutdown', signal }))
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
