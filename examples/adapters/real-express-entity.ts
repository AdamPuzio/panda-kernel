/**
 * @panda/kernel — examples/adapters/real-express-entity.ts
 *
 * Phase 3: the first real EXTERNAL (non-Panda-authored) library wrapper —
 * see panda-opencode/roadmap.md Phase 3 and
 * examples/at-scale/express-integration.md, which designed this on paper
 * before any of it was built. Everything sketched there is implemented here
 * for real, importing the actual `express` npm package (a genuine
 * devDependency of this package now — see package.json — not an accidental
 * transitive hoist).
 *
 * Three entity types, following the exact host/contribution shape proven
 * by `panda:cli` (src/entities/cli.ts) and the generalized `contributesTo`
 * link handler (src/link-handlers.ts) — nothing new needed in the resolver
 * or link-handler layer to make this work:
 *
 *  - `panda:express`      — the host. Owns the real Express app instance.
 *                            Accepts contributions via `registerContribution`.
 *  - `panda:express-route`      — contributes a single route.
 *  - `panda:express-middleware` — contributes app-level middleware.
 *
 * Action bridge: same JSON-safe named-reference pattern as every other
 * adapter (`action` in config, resolved via registry.resolveAction at
 * construction time). Deliberately thin — the resolved action receives the
 * real `req`/`res`(/`next` for middleware) directly via `data` and is fully
 * responsible for responding, exactly like a normal Express handler would
 * be. This is a conscious choice, not an oversight: reinventing
 * request/response handling on top of Express's own would violate the
 * "the adapter bridges you to real handler code, it doesn't wrap it in a
 * new abstraction" principle every other adapter this session followed.
 *
 * The one genuinely new thing this surfaces (flagged, not hand-waved, in
 * the design doc): `panda:express` is Phase 3's first LONG-RUNNING entity
 * — see `longRunning` on PandaEntityClass (types.ts). `run()`'s returned
 * promise resolves once the server is *listening*, not when it stops. The
 * process staying alive afterward isn't special kernel behavior — it's the
 * same reason any plain `app.listen(...)` script doesn't exit: an open
 * server handle keeps Node's event loop alive. `close()` is exposed on the
 * resolved value specifically so a demo/test can shut it down cleanly
 * instead of hanging forever — a real script driving a real long-running
 * entity does not call `close()`, it just keeps running.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { JSONSchema, PandaContext, PandaEntityClass, PandaEntityInstance } from '../../src/types'
import type { PandaRegistry } from '../../src/registry'

interface ExpressContribution {
  kind: 'route' | 'middleware'
  apply(app: Express, registry: PandaRegistry, currentCtx: () => PandaContext | undefined): void
}

/** Explicit return type, not inferred — without this, `tsc` tries to name
 *  the inferred type through `@types/express-serve-static-core`, which
 *  exists as two structurally-different, non-deduplicable copies in this
 *  workspace (`@types/express@4.x` wants 4.19.9; Docusaurus's
 *  `webpack-dev-server` transitively wants 5.1.3, for an unrelated
 *  purpose — `@types/connect-history-api-fallback`, nothing to do with
 *  actually using Express). A real, pre-existing workspace-wide version
 *  conflict, not something introduced by or fixable from this file — this
 *  annotation is the standard, correct way to route around a
 *  `TS2742: inferred type cannot be named` error caused by exactly this
 *  shape of problem. */
export function createRealExpressEntities(registry: PandaRegistry): {
  PandaExpressEntity: PandaEntityClass
  PandaExpressRouteEntity: PandaEntityClass
  PandaExpressMiddlewareEntity: PandaEntityClass
} {
  class PandaExpressEntity implements PandaEntityInstance {
    static readonly type = 'panda:express'
    static readonly longRunning = true

    static readonly configSchema: JSONSchema = {
      type: 'object',
      properties: {
        port: { type: 'number', default: 3000 },
      },
    }

    app = express()
    contributions: ExpressContribution[] = []
    currentCtx?: PandaContext
    server?: import('http').Server
    config: { port?: number }

    constructor(config: Record<string, unknown>) {
      this.config = config as { port?: number }
    }

    /** Opt-in extension point — same shape as panda:cli's, per HANDLERS.md.
     *  Anything shaped like ExpressContribution can be contributed, whether
     *  it arrived via `contributesTo` (the only path used in practice —
     *  routes/middleware don't make sense declared via `uses`). */
    registerContribution(entity: ExpressContribution): void {
      this.contributions.push(entity)
    }

    /** Lets a module or a higher-level entity get the raw Express app —
     *  e.g. for testing, or for something that needs direct access. Also
     *  what a consumer would reach via `getExport()` if this entity is
     *  exported from a `panda:module`, matching the design doc's Part 3/4
     *  ("different app flavors" and "contributing into an imported
     *  module's app" both depend on this being reachable). */
    getApp(): Express {
      return this.app
    }

    async run(ctx: PandaContext): Promise<unknown> {
      this.currentCtx = ctx
      for (const c of this.contributions) c.apply(this.app, registry, () => this.currentCtx)

      const port = this.config.port ?? 3000
      return new Promise((resolve, reject) => {
        this.server = this.app.listen(port, () => {
          ctx.services.log.info(`panda:express listening on port ${port}`)
          resolve({
            app: this.app,
            port,
            // Exposed for callers (demos, tests) that need a clean shutdown
            // path — see the file-level doc comment above. NOT part of the
            // manifest-facing contract; a real long-running deployment
            // never calls this.
            close: () => new Promise<void>((res, rej) => {
              this.server?.close((err) => (err ? rej(err) : res()))
            }),
          })
        })
        this.server.on('error', reject)
      })
    }
  }

  class PandaExpressRouteEntity implements PandaEntityInstance {
    static readonly type = 'panda:express-route'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['method', 'path', 'action'],
      properties: {
        method: { type: 'string', enum: ['get', 'post', 'put', 'delete', 'patch'] },
        path: { type: 'string' },
        action: { type: 'string', pandaActionRef: true },
      },
    }

    readonly kind = 'route' as const
    config: { method: string; path: string; action: string }

    constructor(config: Record<string, unknown>) {
      this.config = config as { method: string; path: string; action: string }
    }

    // Routes don't "run" themselves — they're only ever consumed via
    // `contributesTo` -> apply(), matching the design doc's note that this
    // entity's real work happens in apply(), not run(). run() still has to
    // exist to satisfy PandaEntityInstance; it's a correctly-typed no-op.
    async run(): Promise<unknown> {
      return this
    }

    apply(app: Express, registryRef: PandaRegistry, currentCtx: () => PandaContext | undefined): void {
      const { method, path, action: actionName } = this.config
      const handler = (req: Request, res: Response) => {
        const ctx = currentCtx()
        if (!ctx) {
          throw new Error(
            'Real @panda/express adapter: route handler invoked before the host app\'s run(ctx) established a context',
          )
        }
        const action = registryRef.resolveAction(actionName)
        return action({ req, res }, ctx)
      }
      ;(app as unknown as Record<string, (path: string, handler: unknown) => void>)[method](path, handler)
    }
  }

  class PandaExpressMiddlewareEntity implements PandaEntityInstance {
    static readonly type = 'panda:express-middleware'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', pandaActionRef: true },
      },
    }

    readonly kind = 'middleware' as const
    config: { action: string }

    constructor(config: Record<string, unknown>) {
      this.config = config as { action: string }
    }

    async run(): Promise<unknown> {
      return this
    }

    apply(app: Express, registryRef: PandaRegistry, currentCtx: () => PandaContext | undefined): void {
      const actionName = this.config.action
      app.use((req: Request, res: Response, next: NextFunction) => {
        const ctx = currentCtx()
        if (!ctx) {
          throw new Error(
            'Real @panda/express adapter: middleware invoked before the host app\'s run(ctx) established a context',
          )
        }
        const action = registryRef.resolveAction(actionName)
        Promise.resolve(action({ req, res, next }, ctx)).catch(next)
      })
    }
  }

  return { PandaExpressEntity, PandaExpressRouteEntity, PandaExpressMiddlewareEntity }
}
