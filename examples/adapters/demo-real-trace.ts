/**
 * Proof-of-concept for the real-trace service adapter. @panda/trace is
 * deliberately opt-in/silent by default (gated on process.env.TRACE).
 *
 * A real, concrete finding from actually running this (not a hypothetical
 * one): @panda/trace computes its config ONCE, at module-import time
 * (`const traceCfg = traceConfig()` at the top of trace.ts) — so setting
 * `process.env.TRACE` from inside this same file, even textually before
 * the `import` statements, does NOT work, because ES module imports are
 * hoisted above all other top-level code and evaluate first regardless of
 * source order. `TRACE` has to be a real environment variable set before
 * the process starts. Run this with:
 *
 *   TRACE=trace npx tsx examples/adapters/demo-real-trace.ts
 *
 * Note it's `TRACE=trace`, not `TRACE=on` — another real finding, not a
 * typo: `on` alone enables output but leaves the level threshold at its
 * default (`info`), and `trace` (the level this demo logs at) is always
 * below `info` in severity — so `TRACE=on` alone stays silent. The level
 * name itself needs to be part of the value to raise the threshold.
 */

import { PandaRegistry, resolve, createCommandEntity } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { registerRealTraceService } from './real-trace-service'

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(createCommandEntity(registry))
  registerRealTraceService(registry)

  registry.registerAction(
    'tracedAction',
    async (_data, ctx) => {
      ctx.services.trace.trace('this came from the REAL @panda/trace library', ['demo', 'phase2'])
      return { traced: true }
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      greet: {
        type: 'panda:command',
        config: { command: 'greet', action: 'myapp:tracedAction' },
      },
    },
  }

  const instances = await resolve(manifest, registry)
  const result = await instances.greet.run(undefined as never)
  console.log('Result:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
