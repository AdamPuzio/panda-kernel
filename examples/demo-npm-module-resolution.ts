/**
 * @panda/kernel — examples/demo-npm-module-resolution.ts
 *
 * Phase 4: proves real npm package resolution for panda:module — NO
 * registry.registerModuleSource() call anywhere in this file. "source":
 * "@panda/example-auth-module" resolves purely via Node's own module
 * resolution against a REAL installed package
 * (@panda/example-auth-module, a workspace member — see its
 * package.json's "panda.manifest" field), reading its
 * panda.manifest.json off disk for real.
 *
 * Deliberately the exact same scenario as demo-module.ts (same
 * loginCommand/internalDebugCommand/exports/inputs shape) so the only
 * variable being tested is HOW the module's manifest was found — the
 * previous demo via registerModuleSource, this one via a real installed
 * package — not a different scenario.
 */

import { PandaRegistry, resolve, createCommandEntity, PandaCliEntity } from '../src/index'
import type { PandaManifest } from '../src/types'

async function main() {
  const registry = new PandaRegistry()

  registry.registerEntity(createCommandEntity(registry))
  registry.registerEntity(PandaCliEntity)
  registry.registerEntity((await import('../src/entities/module')).createModuleEntity(registry))

  registry.registerService('log', () => ({
    log: (msg: string) => console.log(msg),
    info: (msg: string) => console.log(`INFO: ${msg}`),
    error: (msg: string) => console.error(`ERROR: ${msg}`),
  }))

  registry.registerAction(
    'loginAction',
    async (_data, ctx) => {
      ctx.services.log.info(`login command description: "${ctx.config.description}"`)
      return { status: 'logged in' }
    },
    { namespace: 'auth' },
  )
  registry.registerAction('debugAction', async () => ({ status: 'debug' }), { namespace: 'auth' })

  // NOTE: no registry.registerModuleSource() call — "source" below
  // resolves purely via real npm/Node module resolution.
  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      auth: {
        type: 'panda:module',
        config: { source: '@panda/example-auth-module', inputs: { greeting: 'Hi from a REAL npm package' } },
      },
      cli: {
        type: 'panda:cli',
        uses: ['auth.login'],
        config: { name: 'myapp' },
      },
    },
  }

  const instances = await resolve(manifest, registry)

  const authModule = instances.auth as unknown as { getExport(name: string): { run(ctx: never): Promise<unknown> } }
  await authModule.getExport('login').run(undefined as never)

  const result = await instances.cli.run(undefined as never)
  console.log('Result:', result)

  try {
    ;(authModule as unknown as { getExport(name: string): unknown }).getExport('internalDebugCommand')
    console.log('UNEXPECTED: internalDebugCommand was reachable — encapsulation broken')
  } catch (err) {
    console.log(`Confirmed encapsulated: ${(err as Error).message}`)
  }

  console.log('PASS: "@panda/example-auth-module" was resolved as a real, installed npm package — no registerModuleSource() stand-in involved.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
