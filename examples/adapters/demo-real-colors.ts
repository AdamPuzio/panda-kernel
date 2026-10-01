/**
 * Proof-of-concept for the real-colors service adapter — confirms real
 * ANSI escape codes actually come out (not just that the wrapper compiles
 * and returns *a* string), and that it composes with an entity's own
 * ctx.services.style access, the same as log/trace do.
 */

import { PandaRegistry, resolve, createCommandEntity } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { registerRealColorsService } from './real-colors-service'

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(createCommandEntity(registry))
  registerRealColorsService(registry)

  registry.registerAction(
    'styledAction',
    async (_data, ctx) => {
      const styled = ctx.services.style('Hello, styled world!', ['bold', 'green'])
      console.log(styled)
      return { raw: styled, containsEscapeCode: styled.includes('\x1b[') }
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      greet: {
        type: 'panda:command',
        config: { command: 'greet', action: 'myapp:styledAction' },
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
