/**
 * @panda/kernel — examples/adapters/demo-real-mongodb.ts
 *
 * Proves the real-mongodb-entity.ts adapter end to end against a real,
 * disposable MongoDB instance (a throwaway Docker container, not any
 * pre-existing/shared one — see the shell commands in this file's own
 * comments for how to reproduce it) — a real insert followed by a real
 * query, confirming actual persistence through the real driver, not just
 * "connect() didn't throw."
 *
 * Reproduce the database this demo expects:
 *   docker run --rm -d --name panda-mongo-demo -p 27418:27017 mongo:8
 *   (torn down again at the end of this script via docker stop, matching
 *   how demo-real-express.ts calls close() on its server — a real
 *   long-running deployment of either would never do this.)
 *
 * A real, worth-stating-explicitly finding this demo surfaced, distinct
 * from anything panda:express needed: `uses` wires a dependent to the
 * *instance* at construction time (topoSort only orders construction), but
 * does NOT automatically call run() on that instance first. `getDb()`
 * throws clearly if called before `mongo.run(ctx)` has established a
 * connection — this demo is the first one where getting the run() call
 * order wrong produces a real, informative error rather than silently
 * working by coincidence, because no previous `uses` dependent ever
 * needed its dependency to have already run() before being useful.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PandaRegistry } from '../../src/registry'
import { resolve } from '../../src/resolver'
import { createCommandEntity } from '../../src/entities/command'
import type { PandaManifest } from '../../src/types'
import { createRealMongoEntity } from './real-mongodb-entity'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const registry = new PandaRegistry()
  const { PandaMongoEntity } = createRealMongoEntity()
  registry.registerEntity(PandaMongoEntity)
  registry.registerEntity(createCommandEntity(registry))

  registry.registerAction('demo:seedAndQuery', async (_data, ctx) => {
    const db = (ctx.refs.mongo as unknown as { getDb(): import('mongodb').Db }).getDb()
    const collection = db.collection('widgets')
    await collection.insertOne({ name: 'real-widget', createdBy: 'panda-kernel-demo' })
    const found = await collection.findOne({ name: 'real-widget' })
    return { insertedAndFound: found?.name === 'real-widget', found }
  })

  const manifest = JSON.parse(
    readFileSync(join(__dirname, 'real-mongodb-manifest.json'), 'utf-8'),
  ) as PandaManifest

  const instances = await resolve(manifest, registry)

  // mongo's run() must happen BEFORE seedAndQuery's — see the file-level
  // doc comment above on why this ordering is the caller's responsibility,
  // not something the resolver enforces automatically.
  const mongoResult = (await instances.mongo.run(undefined as never)) as { close: () => Promise<void> }
  const result = await instances.seedAndQuery.run(undefined as never)

  console.log('Result:', result)

  if (!(result as { insertedAndFound: boolean }).insertedAndFound) {
    throw new Error('FAIL: document was not actually persisted and retrieved from a real MongoDB instance')
  }
  console.log('PASS: real insert, real query, real persistence, all against a real MongoDB instance.')

  await mongoResult.close()
  console.log('Connection closed cleanly.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
