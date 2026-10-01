/**
 * @panda/kernel — examples/adapters/demo-real-express.ts
 *
 * Proves the real-express-entity.ts adapter end to end: resolves a
 * manifest wiring a real Express app with a contributed route AND a
 * contributed middleware, starts it for real, sends a REAL HTTP request at
 * it (not just "did run() resolve without throwing"), confirms the
 * response came from the actual route handler AND that the middleware
 * actually ran first, then shuts the server down cleanly so this script
 * exits instead of hanging (see the file-level doc comment in
 * real-express-entity.ts on why `close()` exists and why a real
 * long-running deployment would never call it).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PandaRegistry } from '../../src/registry'
import { resolve } from '../../src/resolver'
import type { PandaManifest } from '../../src/types'
import { createRealExpressEntities } from './real-express-entity'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const registry = new PandaRegistry()
  const { PandaExpressEntity, PandaExpressRouteEntity, PandaExpressMiddlewareEntity } =
    createRealExpressEntities(registry)
  registry.registerEntity(PandaExpressEntity)
  registry.registerEntity(PandaExpressRouteEntity)
  registry.registerEntity(PandaExpressMiddlewareEntity)

  let middlewareRan = false
  registry.registerAction('demo:logRequest', async (data, ctx) => {
    const { req, next } = data as { req: { method: string; path: string }; next: () => void }
    middlewareRan = true
    ctx.services.log.info(`${req.method} ${req.path}`)
    next()
  })

  registry.registerAction('demo:healthAction', async (data) => {
    const { res } = data as { res: { json: (body: unknown) => void } }
    res.json({ status: 'ok', middlewareRan })
  })

  const manifest = JSON.parse(
    readFileSync(join(__dirname, 'real-express-manifest.json'), 'utf-8'),
  ) as PandaManifest

  const instances = await resolve(manifest, registry)
  const result = (await instances.app.run(undefined as never)) as {
    port: number
    close: () => Promise<void>
  }

  console.log(`Server started on port ${result.port}, sending a real HTTP request...`)

  const response = await fetch(`http://localhost:${result.port}/health`)
  const body = await response.json()

  console.log('Response status:', response.status)
  console.log('Response body:', body)

  if (body.middlewareRan !== true) {
    throw new Error('FAIL: contributed middleware did not run before the contributed route handler')
  }
  if (body.status !== 'ok') {
    throw new Error('FAIL: contributed route handler did not respond as expected')
  }

  console.log('PASS: real Express server, real contributed route, real contributed middleware, all verified via a real HTTP request.')

  await result.close()
  console.log('Server closed cleanly.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
