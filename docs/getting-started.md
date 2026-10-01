# Getting Started

This walks through the exact example in `examples/demo.ts`, built up from scratch, so you understand every piece. By the end you'll have a manifest-driven "deploy" command that logs through a shared logger — the same thing `npx tsx examples/demo.ts` runs.

Requires Node 18+ and `npx tsx` (or any TypeScript runner) — no build step needed for this tutorial.

> **Note:** `@panda/kernel` isn't published yet. The code below shows the intended import shape once it is; to actually run this today, import directly from the package's `src/index.ts` instead (see `examples/demo.ts` for the working version of this exact tutorial).

## 1. Set up a registry

Every Panda app starts with one registry — the place entity types, actions, and services get registered before anything can be resolved.

```typescript
import { PandaRegistry } from '@panda/kernel'

const registry = new PandaRegistry()
```

## 2. Register the entity types you'll use

For this tutorial we're using two entity types that ship with the kernel's proof-of-concept build: `panda:logger` and `panda:command`.

```typescript
import { PandaLoggerEntity, createCommandEntity } from '@panda/kernel'

registry.registerEntity(PandaLoggerEntity)
registry.registerEntity(createCommandEntity(registry))
```

(`createCommandEntity(registry)` looks slightly different from a plain class — this stub command entity needs a reference to the registry so it can resolve its own `action` by name at run time. This detail may change as `panda:command` gets built out further; see [Status & Roadmap](./status.md).)

## 3. Register the one real callback your app needs

Your manifest can't contain functions, so register the actual deploy logic under a name, once:

```typescript
registry.registerAction(
  'deployAction',
  async (data, ctx) => {
    ctx.services.log.info(`Deploying via command "${data.command}"...`)
    return { status: 'deployed' }
  },
  { namespace: 'myapp' },
)
```

That registers it as `myapp:deployAction` — the namespace prevents collisions with anyone else's `deployAction`.

## 4. (Optional) Register a real logger

By default, `ctx.services.log` is a harmless no-op. To see real output, register your own:

```typescript
registry.registerService('log', () => ({
  log: (msg: string) => console.log(msg),
  info: (msg: string) => console.log(`INFO: ${msg}`),
  error: (msg: string) => console.error(`ERROR: ${msg}`),
}))
```

This transparently replaces the kernel's built-in default — nothing else needs to change.

## 5. Write the manifest

```json
{
  "panda": "1",
  "entities": {
    "logger": {
      "type": "panda:logger",
      "config": { "level": "info" }
    },
    "deploy": {
      "type": "panda:command",
      "uses": ["logger"],
      "config": {
        "command": "deploy",
        "description": "Deploy the app",
        "action": "myapp:deployAction"
      }
    }
  }
}
```

Save this as `manifest.json`.

## 6. Resolve and run

```typescript
import { resolve } from '@panda/kernel'
import manifest from './manifest.json'

const instances = await resolve(manifest, registry)
const result = await instances.deploy.run()
console.log('Result:', result)
```

Expected output:

```text
INFO: Deploying via command "deploy"...
Result: { status: 'deployed' }
```

## What just happened

- `resolve()` read the manifest, saw `deploy` `uses: ["logger"]`, and made sure `logger` was constructed first.
- It built one shared `services` object (containing your registered `log` service) and handed it to every entity via `ctx.services`.
- When you called `instances.deploy.run()`, the command entity looked up `myapp:deployAction` by name and called it, passing a context with `ctx.services.log` and `ctx.refs.logger` (the already-resolved logger instance) available.

No entity had to know about any other entity's implementation — they were wired together purely through the manifest.

## Next steps

- [Manifest Reference](./manifest-reference.md) for the full field-by-field shape of a manifest.
- [Writing an Entity](./writing-an-entity.md) to build your own entity type instead of using the stubs.
- [Status & Roadmap](./status.md) to see what's designed for larger use cases (plugins, reusable modules, multi-package apps) but not built yet.
