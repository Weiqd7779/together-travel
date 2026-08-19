import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createTravelServer } from './app.mjs'

const serverDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(serverDirectory, '..')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '0.0.0.0'
const dbPath = resolve(process.env.DB_PATH ?? join(projectRoot, 'var', 'together-travel.sqlite'))
const staticDir = resolve(process.env.STATIC_DIR ?? join(projectRoot, 'dist'))

const server = createTravelServer({ dbPath, staticDir })
server.listen(port, host, () => {
  console.log(`同行 App 已啟動：http://localhost:${port}`)
  console.log(`SQLite：${dbPath}`)
})

function stop() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
