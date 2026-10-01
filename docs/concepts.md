# Core Concepts

Five terms cover everything in Panda today. Read this before the tutorial — the tutorial assumes you know what these words mean.

## Entity

An **entity** is one building block — a command, a logger, a task, anything that does one job. Every entity is a class that satisfies a small contract:

```typescript
interface PandaEntityClass {
  readonly type: string           // e.g. 'panda:command' — how manifests refer to it
  readonly configSchema: object   // a JSON Schema describing valid config
  new (config: Record<string, unknown>): PandaEntityInstance
}

interface PandaEntityInstance {
  run(ctx: PandaContext): Promise<unknown>
}
```

That's the whole contract. An entity's `config` must be plain, serializable JSON — no functions embedded in it (see "Actions," below, for how entities still get custom behavior without breaking that rule).

## Manifest

A **manifest** is the JSON file that declares which entities you want and how they relate:

```json
{
  "panda": "1",
  "entities": {
    "logger": { "type": "panda:logger", "config": { "level": "info" } },
    "deploy": {
      "type": "panda:command",
      "uses": ["logger"],
      "config": { "command": "deploy", "action": "myapp:deployAction" }
    }
  }
}
```

- `entities` is a flat map: your own name for the entity (`logger`, `deploy`) → its declaration.
- `type` picks which registered entity class to instantiate.
- `uses` lists other entity keys this one depends on — Panda resolves them in the right order and makes them available to you (see "Refs," below).
- `config` is that entity's own configuration, validated against its `configSchema`.

## Registry

The **registry** is where entity types, actions, and services get registered before a manifest can be resolved. Nothing is available to a manifest unless something registered it first:

```typescript
const registry = new PandaRegistry()
registry.registerEntity(MyCommandEntity)
registry.registerAction('deployAction', async (data, ctx) => { /* ... */ }, { namespace: 'myapp' })
```

## Actions — how entities get real behavior without breaking the "config is JSON" rule

You can't put a function inside a manifest — manifests are plain JSON. So instead of an entity's `config` containing a callback directly, it contains the **name** of a callback you registered separately:

```json
{ "action": "myapp:deployAction" }
```

```typescript
registry.registerAction('deployAction', async (data, ctx) => {
  ctx.services.log.info('deploying...')
}, { namespace: 'myapp' })
```

This one small piece of real code (the registration) is the only "glue code" you write — everything else is declared in the manifest. The `namespace` option auto-prefixes the registered name (`myapp:deployAction`) so two different packages can register an action with the same short name without colliding.

## Context (`ctx`) — what every entity receives when it runs

Every entity's `run(ctx)` method receives:

- **`ctx.services`** — ambient capabilities every entity gets automatically: `ctx.services.log`, `ctx.services.trace`, `ctx.services.style`. You never construct these yourself; Panda provides them (with harmless no-op defaults if nothing registered a real implementation). Package authors can register additional services (see [Writing an Entity](./writing-an-entity.md)).
- **`ctx.refs`** — the already-resolved instances of anything listed in this entity's `uses`, keyed by the same name used in the manifest. E.g. if `deploy` `uses: ["logger"]`, then inside its action, `ctx.refs.logger` is the actual logger entity instance.
- **`ctx.config`** — this entity's own resolved configuration (the same object passed to its constructor).

## Putting it together

1. Package authors write entity classes and register them (`registerEntity`).
2. App authors write one small file registering the handful of real callbacks their app needs (`registerAction`), then write a manifest declaring what they want built.
3. `resolve(manifest, registry)` reads the manifest, constructs everything in the right order, and hands back running instances.

Next: [Getting Started](./getting-started.md) walks through all three steps with real, runnable code.
