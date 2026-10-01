/**
 * @panda/kernel — examples/adapters/demo-express-module-nesting.ts
 *
 * Proves Express's Part 4 gap, the one thing explicitly left unproven when
 * panda:express first shipped (see DECISIONS.md, 2026-09-30 panda:express
 * entry, and examples/at-scale/express-integration.md Part 4): can a
 * CONSUMER contribute a route into a panda:express instance that lives
 * INSIDE an imported panda:module, not just a local top-level entity?
 *
 * Scenario, exactly matching express-integration.md's Part 4 example:
 *   - `restApiStarter` (express-module-manifest.json) is a published
 *     module bundling its own panda:express app plus a healthRoute,
 *     exporting the app itself as "app".
 *   - The consumer (express-module-consumer-manifest.json) imports it via
 *     panda:module, and declares its OWN route (`myCustomRoute`) with
 *     `contributesTo: "restApiStarter.app"` — a dotted, one-hop reference
 *     reaching THROUGH the module boundary into its exported entity, not
 *     a local manifest key.
 *
 * This was designed to already work via the existing, generalized
 * `resolveEntityRef` (entity-ref.ts) and `ContributesToLinkHandler`
 * (link-handlers.ts) — neither was written with modules specifically in
 * mind, but neither special-cases "local key" vs "one-hop module export"
 * either. This demo is what actually confirms that holds, rather than
 * leaving it as an assumption.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PandaRegistry } from '../../src/registry'
import { resolve } from '../../src/resolver'
import { createModuleEntity } from '../../src/entities/module'
import type { PandaManifest } from '../../src/types'
import { createRealExpressEntities } from './real-express-entity'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadManifest(file: string): PandaManifest {
  return JSON.parse(readFileSync(join(__dirname, file), 'utf-8')) as PandaManifest
}

async function main() {
  const registry = new PandaRegistry()
  const { PandaExpressEntity, PandaExpressRouteEntity, PandaExpressMiddlewareEntity } =
    createRealExpressEntities(registry)
  registry.registerEntity(PandaExpressEntity)
  registry.registerEntity(PandaExpressRouteEntity)
  registry.registerEntity(PandaExpressMiddlewareEntity)
  registry.registerEntity(createModuleEntity(registry))

  registry.registerAction('restApiStarter:healthAction', async (data) => {
    const { res } = data as { res: { json: (body: unknown) => void } }
    res.json({ status: 'ok', from: 'inside the module' })
  })
  registry.registerAction('myapp:listOrdersAction', async (data) => {
    const { res } = data as { res: { json: (body: unknown) => void } }
    res.json({ orders: [], from: 'contributed from the CONSUMER, into a route living inside the module' })
  })

  // Stand-in for real npm resolution — same pattern as demo-module.ts.
  registry.registerModuleSource('restApiStarter', loadManifest('express-module-manifest.json'))

  const consumerManifest = loadManifest('express-module-consumer-manifest.json')
  const instances = await resolve(consumerManifest, registry)

  // Grab the real Express app instance living INSIDE the module — same
  // getExport() mechanism demo-module.ts already proved for commands, now
  // exercised for the first time against a host entity that accepts
  // contributions.
  const restApiStarterModule = instances.restApiStarter as unknown as {
    getExport(name: string): { run(ctx: never): Promise<{ port: number; close: () => Promise<void> }> }
  }
  const app = restApiStarterModule.getExport('app')

  // Zero-arg call — resolver.ts already rebound run() to close over this
  // entity's own ctx from the NESTED resolve() pass inside panda:module's
  // configure(), exactly as demo-module.ts's getExport('login').run()
  // already established for a one-shot entity; this is the same mechanism
  // now proven for a long-running one.
  const result = await app.run(undefined as never)

  console.log(`Server started on port ${result.port} — testing both routes...`)

  const healthRes = await fetch(`http://localhost:${result.port}/health`)
  const healthBody = await healthRes.json()
  console.log('GET /health (contributed FROM INSIDE the module):', healthBody)

  const ordersRes = await fetch(`http://localhost:${result.port}/orders`)
  const ordersBody = await ordersRes.json()
  console.log('GET /orders (contributed from the CONSUMER, through the module boundary):', ordersBody)

  if (healthBody.status !== 'ok') {
    throw new Error('FAIL: the module\'s own internal route did not respond correctly')
  }
  if (!Array.isArray(ordersBody.orders)) {
    throw new Error('FAIL: the consumer-contributed route (across the module boundary) did not respond correctly')
  }

  console.log('PASS: Express\'s Part 4 gap is closed — a consumer can contribute a route into a panda:express instance living inside an imported panda:module, with no new mechanism needed.')

  await result.close()
  console.log('Server closed cleanly.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
