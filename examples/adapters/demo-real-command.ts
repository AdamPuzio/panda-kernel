/**
 * Proof-of-concept for the real-command adapter — this is the "does the
 * entity contract survive contact with something that wasn't built for
 * it" test. Uses the REAL, unmodified legacy/panda-command library
 * (actual command-line-args-based parsing, actual option/alias handling),
 * bridged behind the kernel's entity contract via examples/adapters/
 * real-command-entity.ts.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { PandaRegistry, resolve } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { createRealCommandEntity } from './real-command-entity'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(createRealCommandEntity(registry))

  registry.registerService('log', () => ({
    log: (msg: string) => console.log(msg),
    info: (msg: string) => console.log(`INFO: ${msg}`),
    error: (msg: string) => console.error(`ERROR: ${msg}`),
  }))

  registry.registerAction(
    'greetAction',
    async (payload, ctx) => {
      const { data } = payload as { data: { name?: string } }
      ctx.services.log.info(`Hello, ${data.name}! (parsed by the REAL command-line-args engine)`)
      return { greeted: data.name }
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = JSON.parse(
    readFileSync(path.join(__dirname, 'real-command-manifest.json'), 'utf-8'),
  )

  const instances = await resolve(manifest, registry)
  const result = await instances.greet.run(undefined as never)
  console.log('Result:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
