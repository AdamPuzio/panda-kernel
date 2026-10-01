/**
 * Proof-of-concept: resolve a 2-entity manifest (panda:command uses
 * panda:logger) and run it. This is the "does JSON-in, running-app-out
 * actually work" check from working-pattern.md — nothing else should be
 * touched until this runs cleanly.
 *
 * Also demonstrates the two decisions from this session:
 *   #1 — ambient services are a fourth registry (registerService), not a
 *        fixed PandaContext interface. A hypothetical @panda/logger package
 *        would augment PandaServices via `declare module '@panda/kernel'`
 *        (shown below, inline, since there's no separate package yet) and
 *        register a real logger, transparently overriding the kernel's
 *        built-in no-op default.
 *   #2 — actions register under an automatic namespace derived from the
 *        registering package's name, so two independently-published
 *        packages can never collide on a short action name.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { PandaRegistry, resolve, PandaLoggerEntity, createCommandEntity } from '../src/index'
import type { PandaManifest } from '../src/types'

// #1 — declaration merging: this is what @panda/logger's own source would
// contain to extend the shared PandaServices interface. Shown inline here
// since @panda/logger doesn't exist as a package under this contract yet.
declare module '../src/types' {
  interface PandaServices {
    // (log/trace/style already declared in kernel core as the guaranteed
    // defaults — a real new service, e.g. metrics, would add a new key
    // here instead: `metrics: PandaMetrics`)
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const registry = new PandaRegistry()

  // Each entity self-registers against the shared registry.
  registry.registerEntity(PandaLoggerEntity)
  registry.registerEntity(createCommandEntity(registry))

  // #1 — override the kernel's default no-op `log` service with a real one.
  // This simulates what @panda/logger would do on import: register a real
  // implementation under the same well-known name, transparently replacing
  // the no-op default (see registry.ts's defaultServiceNames handling).
  registry.registerService('log', () => ({
    log: (msg: string) => console.log(`[demo-logger] ${msg}`),
    info: (msg: string) => console.log(`[demo-logger] INFO: ${msg}`),
    error: (msg: string) => console.error(`[demo-logger] ERROR: ${msg}`),
  }))

  // #2 — namespaced registration: two packages named "myapp" and
  // "otherapp" could both register a "deployAction" with no collision.
  registry.registerAction(
    'deployAction',
    async (data, ctx) => {
      ctx.services.log.info(`Deploying via command "${(data as { command: string }).command}"...`)
      ctx.services.log.info(
        `Logger dependency resolved: ${JSON.stringify(await ctx.refs.logger.run(ctx))}`,
      )
      return { status: 'deployed' }
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = JSON.parse(
    readFileSync(path.join(__dirname, 'manifest.json'), 'utf-8'),
  )

  const instances = await resolve(manifest, registry)

  const result = await instances.deploy.run(undefined as never)
  console.log('Result:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
