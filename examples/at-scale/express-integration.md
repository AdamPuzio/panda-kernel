# Worked Example: Wrapping Express, and Building App "Flavors" on Top

Answers: (1) how do you bind an existing external library/framework into Panda, using Express as the concrete case, and (2) how do "different types of applications" (a REST API, a webhook receiver, an admin dashboard) all share Express as a common foundation, the way thousands of real npm frameworks (NestJS, Feathers, etc.) actually do sit on top of Express today.

**Status: design walkthrough, not implemented.** Same discipline as the other worked examples.

## Part 1 — wrapping Express itself as `panda:express`

The core problem is the same one solved for actions: Express is fundamentally imperative (`app.get(path, handler)`, `app.use(middleware)`) and a manifest can't contain functions. So routes and middleware become **contributions** — this is exactly the plugin-contribution pattern from `plugin-contribution.md`, not a new mechanism.

```typescript
class PandaExpressEntity implements PandaEntityInstance {
  static readonly type = 'panda:express'
  static readonly configSchema = {
    type: 'object',
    properties: { port: { type: 'number', default: 3000 } },
  }

  private app = express()
  private contributions: Array<{ kind: 'route' | 'middleware'; apply: (app: Express) => void }> = []

  constructor(private config: { port?: number }) {}

  /** Opt-in extension point, same shape as panda:cli's in plugin-contribution.md */
  registerContribution(entity: { kind: 'route' | 'middleware'; apply: (app: Express) => void }) {
    this.contributions.push(entity)
  }

  async run(ctx: PandaContext): Promise<unknown> {
    for (const c of this.contributions) c.apply(this.app)
    return new Promise((resolve) => {
      this.app.listen(this.config.port ?? 3000, () => {
        ctx.services.log.info(`Express listening on port ${this.config.port ?? 3000}`)
        resolve({ app: this.app })
      })
    })
  }

  /** Lets a module or a downstream entity get the raw Express app — e.g.
   *  for testing, or for a higher-level entity that needs direct access. */
  getApp() {
    return this.app
  }
}
```

Two small companion entity types produce the things that get contributed:

```typescript
class PandaExpressRouteEntity implements PandaEntityInstance {
  static readonly type = 'panda:express-route'
  static readonly configSchema = {
    type: 'object',
    required: ['method', 'path', 'action'],
    properties: {
      method: { type: 'string', enum: ['get', 'post', 'put', 'delete', 'patch'] },
      path: { type: 'string' },
      action: { type: 'string', pandaActionRef: true },
    },
  }
  kind = 'route' as const
  constructor(private config: { method: string; path: string; action: string }) {}
  async run() { /* routes don't "run" themselves — see below */ return this }
  apply(app: Express) {
    // resolved action closes over ctx at registration time — see note below
  }
}
```

A manifest assembling a tiny app:

```json
{
  "panda": "1",
  "entities": {
    "healthRoute": {
      "type": "panda:express-route",
      "config": { "method": "get", "path": "/health", "action": "myapp:healthAction" }
    },
    "authMiddleware": {
      "type": "panda:express-middleware",
      "config": { "action": "myapp:authMiddlewareAction" }
    },
    "app": {
      "type": "panda:express",
      "contributes": { "from": ["healthRoute", "authMiddleware"] },
      "config": { "port": 3000 }
    }
  }
}
```

This is a direct, unmodified application of `contributes` — nothing new needed here. Dependency ordering already works correctly because `getDependencies()` (added during the plugin-contribution walkthrough) makes `contributes` participate in topo-sort, so `healthRoute`/`authMiddleware` are constructed before `app.run()` gathers and applies them.

## Part 2 — a genuinely new wrinkle: `run()` for a server isn't a one-shot task

Every entity built so far (`panda:command`, `panda:logger`, the stub `panda:task`s in the module examples) does something and finishes. `panda:express`'s `run()` starts a server that keeps running — the returned promise in the sketch above only resolves once at startup, but the *process* doesn't end when `run()` "completes." This is a real, previously-unconsidered category: **service/daemon-style entities**, distinct from one-shot command/task entities.

This connects directly to something flagged in the earlier top-level design review: Panda was scoped as "ephemeral build/scaffold/CLI orchestration tooling," explicitly *not* a system that tracks persistent, long-running state. Express is the first concrete example that pushes on that boundary — a running web server is neither "ephemeral" nor something you'd want Panda tracking drift/state for the way Terraform tracks infrastructure, but it's also not a task that finishes. Worth naming plainly rather than quietly working around: **the entity contract as currently specced (`run(ctx): Promise<unknown>`) doesn't yet distinguish "runs and completes" from "starts and keeps running."** A reasonable resolution (not decided, flagging for a real decision later): an entity type can declare itself as `long-running: true` in its class (or similar), and `resolve()`/whatever drives the top-level app knows not to expect these to ever resolve their promise, or to treat their resolution as "started successfully" rather than "finished." Doesn't need solving today, but it's a real gap this example surfaced, not a hypothetical one.

## Part 3 — "different types of applications, all built on Express" = published modules, not subclasses

This is the actual answer to the second half of the question, and it's worth being explicit that it's a real design choice, not the only possible one: **a "REST API app," a "webhook receiver," and an "admin dashboard" each become their own published `panda:module` package — not their own entity *type* that inherits from or wraps `panda:express` in code.**

Concretely: `@yourorg/panda-rest-api-starter` ships a manifest that:
- Declares its own `panda:express` entity.
- Declares a curated, opinionated set of contributing entities that come bundled — JSON body-parsing middleware, standard error-handling middleware, maybe a default health-check route.
- Wires them all together via `contributes`, exactly like Part 1.
- Exposes the express entity itself via `exports`, so a *consumer* of this module can add their own app-specific routes into the same already-partially-assembled Express instance:

```json
{
  "panda": "1",
  "entities": {
    "app": {
      "type": "panda:express",
      "contributes": { "from": ["jsonMiddleware", "errorMiddleware", "healthRoute"] }
    },
    "jsonMiddleware": { "type": "panda:express-middleware", "config": { "action": "restApiStarter:jsonAction" } },
    "errorMiddleware": { "type": "panda:express-middleware", "config": { "action": "restApiStarter:errorAction" } },
    "healthRoute": { "type": "panda:express-route", "config": { "method": "get", "path": "/health", "action": "restApiStarter:healthAction" } }
  },
  "exports": { "app": "app" }
}
```

A `@yourorg/panda-webhook-app-starter` module would look structurally identical but bundle signature-verification middleware and a webhook-receiving route instead — a genuinely different "flavor" of application, sharing the same `panda:express` foundation, published as a completely separate, independent package. This is the direct Panda-native analog of how NestJS, Feathers, and hundreds of other real frameworks all sit on top of Express in code — except here, each "flavor" is a composable, inspectable JSON manifest rather than a framework's own opinionated source tree.

## Part 4 — the real gap this surfaces: contributing *into* something inside an imported module

Here's where it gets genuinely new, and where the existing `contributes`/module design doesn't quite reach yet. A consumer of `@yourorg/panda-rest-api-starter` wants to add their *own* route into the app that module already assembled:

```json
{
  "panda": "1",
  "entities": {
    "restApiStarter": {
      "type": "panda:module",
      "config": { "source": "@yourorg/panda-rest-api-starter" }
    },
    "myCustomRoute": {
      "type": "panda:express-route",
      "config": { "method": "get", "path": "/orders", "action": "myapp:listOrdersAction" }
    }
  }
}
```

The problem: `contributes` as designed in `plugin-contribution.md` is a keyword attached to a **local** entity entry (the host). But the actual `panda:express` instance the consumer wants to contribute into isn't a local entity — it lives inside `restApiStarter`, reachable only via `restApiStarter.getExport('app')`. There's no local manifest key to attach `contributes` to.

**Resolution (new, not yet in `HANDLERS.md`):** generalize the entity-reference grammar itself, rather than inventing a separate mechanism. Everywhere a manifest currently expects a plain local entity key (`uses: ["logger"]`, `contributes: { "from": ["statusPlugin.command"] }`), allow the same dotted `moduleKey.exportName` syntax uniformly — which the `contributes.from` case already informally used, but only there. Extending that same syntax to be legal wherever any entity reference appears means the consumer's manifest could write:

```json
{
  "myCustomRoute": {
    "type": "panda:express-route",
    "contributes": { "into": "restApiStarter.app", "from": ["myCustomRoute"] }
  }
}
```

— or, more simply, flip the direction so the *contribution* itself declares its target rather than requiring a local host entry:

```json
{
  "myCustomRoute": {
    "type": "panda:express-route",
    "config": { "method": "get", "path": "/orders", "action": "myapp:listOrdersAction" },
    "contributesTo": "restApiStarter.app"
  }
}
```

This second shape (`contributesTo` on the *contributor*, rather than `contributes.from` on the *host*) is worth strongly considering over the original design — it reads more naturally ("this route contributes itself to that app") and sidesteps the "no local key for the host" problem entirely, since the contributor is always local by definition. **This is a real, unresolved design question surfaced by this exact example, not present in `HANDLERS.md` today — worth a deliberate decision before implementing `contributes` at all**, since it affects the shape of the mechanism, not just an extension of it.

## Summary — direct answers to the two questions asked

1. **Binding an external library (Express):** wrap it as one entity type (`panda:express`) that owns the actual library instance internally, exposes an opt-in `registerContribution()` extension point (same mechanism as the CLI-plugin example, not a new one), and treats routes/middleware as small, separate entity types that get contributed in via the manifest rather than being config fields. Actions (named, registered callbacks) are still the only place real handler code lives.
2. **Different application "flavors" on the same foundation:** each flavor is a separately published `panda:module` — its own manifest bundling `panda:express` plus a curated, opinionated set of contributions — not a new entity type that subclasses or wraps Express in code. This is composition over inheritance, consistent with every other design decision made this session, and it surfaced one genuine, still-open gap: how a consumer contributes into something that lives *inside* an imported module, which needs either a generalized dotted-reference grammar or a `contributesTo`-on-the-contributor redesign — worth deciding deliberately, not implementing either speculatively.

Also surfaced, independent of the module question: **the entity contract doesn't yet distinguish one-shot entities from long-running/service entities**, and Express is the first concrete case that makes this unavoidable to eventually address.
