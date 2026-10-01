/**
 * Proof-of-concept for the real-task entity — real listr2 execution
 * running through the entity contract, with each step's actual work
 * delegated through the named-action bridge (not @panda/task's own
 * built-in task types, which are blocked on the @panda/factory gap).
 */

import { PandaRegistry, resolve } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { createRealTaskEntity } from './real-task-entity'

async function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(createRealTaskEntity(registry))

  registry.registerAction('buildStep', async (data) => {
    console.log(`  -> running real step: ${(data as { step: string }).step}`)
    return { ok: true }
  }, { namespace: 'myapp' })

  registry.registerAction('testStep', async (data) => {
    console.log(`  -> running real step: ${(data as { step: string }).step}`)
    return { ok: true }
  }, { namespace: 'myapp' })

  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      pipeline: {
        type: 'panda:task',
        config: {
          name: 'demo-pipeline',
          steps: [
            { title: 'build', action: 'myapp:buildStep' },
            { title: 'test', action: 'myapp:testStep' },
          ],
        },
      },
    },
  }

  const instances = await resolve(manifest, registry)
  const result = await instances.pipeline.run(undefined as never)
  console.log('Result:', result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
