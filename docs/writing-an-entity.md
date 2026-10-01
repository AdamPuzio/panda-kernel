# Writing an Entity

A guide for package authors: how to build a new entity type that others can reference from a manifest.

## The minimum contract

```typescript
import type { JSONSchema, PandaContext, PandaEntityInstance } from '@panda/kernel'

export class MyEntity implements PandaEntityInstance {
  static readonly type = 'myscope:my-entity'

  static readonly configSchema: JSONSchema = {
    type: 'object',
    required: ['someField'],
    properties: {
      someField: { type: 'string' },
    },
  }

  constructor(private config: Record<string, unknown>) {}

  async run(ctx: PandaContext): Promise<unknown> {
    ctx.services.log.info(`Running with ${this.config.someField}`)
    return { done: true }
  }
}
```

Register it once, before resolving any manifest:

```typescript
registry.registerEntity(MyEntity, { namespace: 'myscope' })
```

## Rules to follow

- **`type` should be namespaced** (`myscope:my-entity`) if you're publishing this for others to use — pass `{ namespace }` when registering rather than baking the namespace into the class's own `static type` string, so the same class could theoretically be registered under different namespaces by different consumers if ever needed.
- **`configSchema` is not optional in spirit, even though nothing enforces it yet.** It's how a human, a validator, or an AI agent knows what a valid `config` looks like for your entity without reading your source. Write it accurately.
- **Never require a function inside `config`.** If your entity needs custom behavior from the app author, take a string (a name) in `config` and resolve it through the registry at run time — see how `panda:command`'s stub implementation resolves its `action` field via `registry.resolveAction(...)` in `src/entities/command.ts`.
- **Use `ctx.refs` for dependencies, never reach outside the context.** If your entity needs another entity's instance, require the app author to list it in `uses` and read it from `ctx.refs.<key>` — don't import or construct another entity directly.
- **Use `ctx.services` for ambient capabilities, don't build your own.** Don't create your own logger, tracer, or output styler inside an entity — use `ctx.services.log` / `ctx.services.trace` / `ctx.services.style`, which are provided for you and configurable by the app author.

## Adding a new ambient service (not just consuming existing ones)

If you're building something every entity in an app might want access to (not just your own entity), you can extend the ambient `services` object itself rather than building a per-entity dependency. This uses TypeScript declaration merging so consumers get type-checked access without any change to `@panda/kernel` itself:

```typescript
// in your package, e.g. @panda/metrics
declare module '@panda/kernel' {
  interface PandaServices {
    metrics: MyMetricsInterface
  }
}

export function register(registry: PandaRegistry) {
  registry.registerService('metrics', () => new MyMetricsImplementation())
}
```

An app author who imports your package and calls your `register(registry)` gets `ctx.services.metrics` available to every entity in their manifest, with no kernel changes required. Unlike `log`/`trace`/`style`, there's no guaranteed default for a service you invent — anything depending on it should handle it being absent.

## What's not designed yet for entity authors

- A conformance test harness to verify your entity actually satisfies the contract (planned, not built — see [Status & Roadmap](./status.md)).
- Support for entities that want to accept **contributions** from other packages (e.g. a CLI entity that other packages can add subcommands to) — designed in `../HANDLERS.md` and `../examples/at-scale/plugin-contribution.md`, not yet implemented.
