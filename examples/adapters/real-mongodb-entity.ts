/**
 * @panda/kernel — examples/adapters/real-mongodb-entity.ts
 *
 * Phase 3's second deliverable: a structurally different external library
 * than `panda:express` — see `panda-opencode/roadmap.md` Phase 3, point 2,
 * and `STATE.md`'s confidence assessment naming this exact gap ("proven
 * once" vs. "proven against two different kinds of things").
 *
 * `panda:express` was a HOST that other entities contribute INTO.
 * `panda:mongodb` is the other real shape named in the roadmap: a
 * **stateful resource that other entities `uses`** to get a live handle —
 * no contributions, no accepting incoming work of its own. A dependent
 * gets the resource via `ctx.refs.<key>`, exactly like any other `uses`
 * relationship (see `src/link-handlers.ts`'s `UsesLinkHandler`) — nothing
 * new needed there either, same as Express needed nothing new in
 * `contributesTo`.
 *
 * A real, if easy to miss, distinction from `panda:express`'s
 * `longRunning: true`, worth stating explicitly rather than copy-pasting
 * the flag by default: `panda:mongodb`'s `run()` genuinely FINISHES —
 * "connect, and be ready" is a completed task, unlike Express's "keep
 * accepting and processing new requests forever," which has no completion
 * point at all. That the underlying TCP connection pool happens to keep
 * Node's event loop alive in the background is a driver/runtime detail,
 * not the same kind of "ongoing work" `longRunning` was added to describe
 * — so this entity is deliberately NOT marked `longRunning`. This
 * sharpens what the flag actually means, rather than being a gap: it's
 * about whether the entity's OWN job has a completion point, not whether
 * some background resource happens to stay open.
 *
 * Imports the real `mongodb` npm driver — a devDependency of the
 * *workspace root* (`panda-workspace-root`), not `@panda/kernel`'s own
 * `package.json`, per the correction logged in `DECISIONS.md` after the
 * Express adapter got this wrong on its first pass.
 */

import { MongoClient, type Db } from 'mongodb'
import type { JSONSchema, PandaContext, PandaEntityClass, PandaEntityInstance } from '../../src/types'

export function createRealMongoEntity(): { PandaMongoEntity: PandaEntityClass } {
  class PandaMongoEntity implements PandaEntityInstance {
    static readonly type = 'panda:mongodb'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['url', 'database'],
      properties: {
        url: { type: 'string' },
        database: { type: 'string' },
      },
    }

    config: { url: string; database: string }
    client?: MongoClient
    db?: Db

    constructor(config: Record<string, unknown>) {
      this.config = config as { url: string; database: string }
    }

    /** What a dependent gets via `ctx.refs.<key>.getDb()` after `uses` wires
     *  it in — same "expose the real underlying thing" shape as
     *  `panda:express`'s `getApp()`. Deliberately the real driver's own
     *  `Db` type, not a Panda-invented abstraction over it — consistent
     *  with every other adapter's "bridge to real handler code, don't
     *  reinvent the library" principle. */
    getDb(): Db {
      if (!this.db) {
        throw new Error('panda:mongodb: getDb() called before run(ctx) established a connection')
      }
      return this.db
    }

    async run(ctx: PandaContext): Promise<unknown> {
      this.client = new MongoClient(this.config.url)
      await this.client.connect()
      this.db = this.client.db(this.config.database)
      ctx.services.log.info(`panda:mongodb: connected to ${this.config.database}`)

      // Exposed for callers (demos, tests) that need a clean shutdown path —
      // same reasoning as panda:express's close(). A real long-running app
      // would simply never call this and let the connection pool live for
      // the process's lifetime, same as it wouldn't call panda:express's
      // close() either.
      return {
        db: this.db,
        close: () => this.client!.close(),
      }
    }
  }

  return { PandaMongoEntity }
}
