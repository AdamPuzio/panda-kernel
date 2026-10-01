/**
 * Proof-of-concept for the real-logger service adapter — the real, Winston
 * -backed @panda/logger, wired as ctx.services.log.
 */

import { PandaRegistry, resolve, createCommandEntity } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { registerRealLoggerService } from './real-logger-service'

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(createCommandEntity(registry))
  registerRealLoggerService(registry, 'phase2-demo')

  registry.registerAction(
    'loggedAction',
    async (_data, ctx) => {
      ctx.services.log.info('this came from the REAL Winston-backed @panda/logger')
      ctx.services.log.error('and this is an error-level line, same real logger')
      return { logged: true }
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      greet: {
        type: 'panda:command',
        config: { command: 'greet', action: 'myapp:loggedAction' },
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
