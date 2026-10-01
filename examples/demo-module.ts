/**
 * Proof-of-concept for panda:module — this is examples/at-scale/
 * panda-auth.manifest.json + consumer.manifest.json, actually running:
 * a nested manifest ("@example/panda-auth") declares one exported command
 * (`login`) and one deliberately unexported one (`internalDebugCommand`),
 * and a consumer manifest pulls in the module and wires the exported
 * command into its own `panda:cli` via a one-hop dotted reference
 * ("auth.login") — the exact mechanism from module-nesting-at-depth.md.
 *
 * Also proves `inputs`/parameterization: the module declares a `greeting`
 * input with a default, consumed inside its own config via
 * `{ "$input": "greeting" }`. Run twice — once with the consumer
 * overriding it, once without — to prove both the override and the
 * default path actually work, not just one of them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  PandaRegistry,
  resolve,
  createCommandEntity,
  createModuleEntity,
  PandaCliEntity,
} from '../src/index'
import type { PandaManifest } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadManifest(file: string): PandaManifest {
  return JSON.parse(readFileSync(path.join(__dirname, file), 'utf-8'))
}

function buildRegistry(): PandaRegistry {
  const registry = new PandaRegistry()

  registry.registerEntity(createCommandEntity(registry))
  registry.registerEntity(PandaCliEntity)
  registry.registerEntity(createModuleEntity(registry))

  registry.registerService('log', () => ({
    log: (msg: string) => console.log(msg),
    info: (msg: string) => console.log(`INFO: ${msg}`),
    error: (msg: string) => console.error(`ERROR: ${msg}`),
  }))

  // Registered under the module's own namespace — the auth module doesn't
  // know or care what the consuming app is called. The action logs
  // ctx.config.description, which only holds the real greeting if
  // `{ "$input": "greeting" }` was actually substituted before this
  // command entity was constructed.
  registry.registerAction(
    'loginAction',
    async (_data, ctx) => {
      ctx.services.log.info(`login command description: "${ctx.config.description}"`)
      return { status: 'logged in' }
    },
    { namespace: 'auth' },
  )
  registry.registerAction('debugAction', async () => ({ status: 'debug' }), { namespace: 'auth' })

  // Stand-in for real npm resolution — see registry.ts.
  registry.registerModuleSource('@example/panda-auth', loadManifest('auth-module-manifest.json'))

  return registry
}

async function runScenario(label: string, manifestFile: string) {
  console.log(`\n--- ${label} ---`)
  const registry = buildRegistry()
  const manifest = loadManifest(manifestFile)
  const instances = await resolve(manifest, registry)

  // Prove the input actually reached loginCommand's config by invoking its
  // action directly (loginAction logs ctx.config.description itself).
  const authModule = instances.auth as unknown as { getExport(name: string): { run(ctx: never): Promise<unknown> } }
  await authModule.getExport('login').run(undefined as never)

  const result = await instances.cli.run(undefined as never)
  console.log('Result:', result)

  // Confirm encapsulation actually holds: internalDebugCommand was never
  // exported, so it must be unreachable from the consumer's side.
  try {
    ;(authModule as unknown as { getExport(name: string): unknown }).getExport('internalDebugCommand')
    console.log('UNEXPECTED: internalDebugCommand was reachable — encapsulation broken')
  } catch (err) {
    console.log(`Confirmed encapsulated: ${(err as Error).message}`)
  }
}

async function main() {
  // module-consumer-manifest.json supplies "inputs": { "greeting": "Hi there" }
  await runScenario('consumer overrides the input', 'module-consumer-manifest.json')
  // module-consumer-no-inputs-manifest.json supplies no inputs at all —
  // the module's own declared default ("Welcome") must be used instead.
  await runScenario('consumer supplies no inputs (default should apply)', 'module-consumer-no-inputs-manifest.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
