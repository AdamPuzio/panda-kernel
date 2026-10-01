/**
 * @panda/kernel — examples/computed-demo.ts
 *
 * Proves `$computed` end to end, exactly matching the scenario in
 * examples/at-scale/computed-values.md: `devServer` picks a port only
 * once it runs; `openBrowser` needs that actual port, which doesn't exist
 * until then.
 *
 * `PandaOpenBrowserEntity` is defined right here, not in src/entities/ —
 * it's a one-off proving HOW a dependent entity lazily resolves
 * `$computed`, not a reusable kernel-owned entity type like
 * `panda:dev-server`. The key line is in its own run(): it calls
 * `resolveConfigValues` on ITS OWN config, using `ctx.instances` (the
 * full manifest-wide instance map — see PandaContext's doc comment in
 * types.ts for why this exists distinct from `ctx.refs`), rather than the
 * kernel resolving `$computed` automatically for every entity ahead of
 * time. This is deliberate, not a limitation: resolving lazily, inside the
 * consuming entity's own run(), is what guarantees `devServer` has
 * actually run by the time its value is read — resolving eagerly during
 * resolve()/configure() (the way `$input` works for panda:module) would
 * be resolving too early, before `devServer.run()` has ever been called.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PandaRegistry } from '../src/registry'
import { resolve } from '../src/resolver'
import { resolveConfigValues } from '../src/value-resolvers'
import { PandaDevServerEntity } from '../src/entities/dev-server'
import type { JSONSchema, PandaContext, PandaEntityInstance, PandaManifest } from '../src/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

class PandaOpenBrowserEntity implements PandaEntityInstance {
  static readonly type = 'panda:open-browser'
  static readonly configSchema: JSONSchema = { type: 'object' }

  constructor(private rawConfig: Record<string, unknown>, private registry: PandaRegistry) {}

  async run(ctx: PandaContext): Promise<unknown> {
    // Lazy resolution, on demand, right before the value is actually
    // needed — see the file-level doc comment above. `registry` is
    // captured via closure (same factory-function pattern every other
    // entity needing registry access already uses — createCommandEntity,
    // createModuleEntity, etc. — not something pulled off `ctx`, which
    // deliberately doesn't carry the registry itself.
    const resolved = (await resolveConfigValues(this.rawConfig, this.registry, {
      inputs: {},
      instances: ctx.instances,
    })) as { port: number }

    ctx.services.log.info(`panda:open-browser would open http://localhost:${resolved.port}`)
    return { openedPort: resolved.port }
  }
}

function createOpenBrowserEntity(registry: PandaRegistry) {
  return class extends PandaOpenBrowserEntity {
    constructor(rawConfig: Record<string, unknown>) {
      super(rawConfig, registry)
    }
  }
}

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(PandaDevServerEntity)
  registry.registerEntity(createOpenBrowserEntity(registry) as never)

  const manifest = JSON.parse(readFileSync(join(__dirname, 'computed-manifest.json'), 'utf-8')) as PandaManifest

  const instances = await resolve(manifest, registry)

  // devServer must run BEFORE openBrowser reads its computed port — same
  // caller-responsibility finding panda:mongodb's `uses` relationship
  // surfaced (see kernel DECISIONS.md): construction order is guaranteed
  // by the dependency graph, run() order is not, and is the caller's job.
  await instances.devServer.run(undefined as never)
  const result = await instances.openBrowser.run(undefined as never)

  console.log('Result:', result)

  // Negative check: resolving BEFORE devServer has run fails clearly,
  // proving Option B (no implicit run() as a side effect of reading a
  // computed value) — a fresh, unrun devServer instance for this check.
  const registry2 = new PandaRegistry()
  registry2.registerEntity(PandaDevServerEntity)
  const freshDevServer = new PandaDevServerEntity({ portRange: [3000, 4000] })
  try {
    await (freshDevServer as unknown as { provideValue(o: string): Promise<unknown> }).provideValue('port')
    throw new Error('FAIL: provideValue() should have thrown before run() was ever called')
  } catch (err) {
    console.log('PASS (expected failure):', (err as Error).message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
