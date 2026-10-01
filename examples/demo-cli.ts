/**
 * Proof-of-concept for the two things built this round:
 *   1. `uses` factored out into the pluggable PandaLinkHandler mechanism
 *      (see link-handlers.ts) instead of being hardcoded in the resolver.
 *   2. `contributesTo` implemented for real — a "plugin" command
 *      (statusPlugin) contributes itself into the `cli` host entity
 *      without the cli's manifest key ever needing to be known to the
 *      plugin ahead of time. This is examples/at-scale/
 *      plugin-contribution.md, actually running.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { PandaRegistry, resolve, createCommandEntity, PandaCliEntity } from '../src/index'
import type { PandaManifest } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const registry = new PandaRegistry()

  registry.registerEntity(createCommandEntity(registry))
  registry.registerEntity(PandaCliEntity)

  registry.registerService('log', () => ({
    log: (msg: string) => console.log(msg),
    info: (msg: string) => console.log(`INFO: ${msg}`),
    error: (msg: string) => console.error(`ERROR: ${msg}`),
  }))

  registry.registerAction('buildAction', async () => ({ status: 'built' }), { namespace: 'myapp' })
  registry.registerAction('deployAction', async () => ({ status: 'deployed' }), { namespace: 'myapp' })
  // Registered under a DIFFERENT namespace than "myapp" — simulating an
  // independently-published plugin package that has no idea what the
  // consuming app is called.
  registry.registerAction('statusAction', async () => ({ status: 'ok' }), { namespace: 'statusPlugin' })

  const manifest: PandaManifest = JSON.parse(
    readFileSync(path.join(__dirname, 'cli-manifest.json'), 'utf-8'),
  )

  const instances = await resolve(manifest, registry)
  const result = await instances.cli.run(undefined as never)
  console.log('Result:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
