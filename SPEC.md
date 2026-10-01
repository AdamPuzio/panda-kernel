# @panda/kernel — Spec (Draft v0.1)

Status: **draft, not yet implemented.** This document is the contract to build against before writing kernel code — per the working-pattern plan, design on paper first, then build the smallest possible 2-entity proof.

## Purpose

`@panda/kernel` is the one piece every other `@panda/*` package plugs into. It owns exactly four things:

1. The **entity contract** — the interface every entity implements.
2. The **registry** — where entity types get registered.
3. The **resolver** — turns a JSON manifest into a running, wired-up app.
4. The **shared context** — carries cross-cutting capabilities (logging, tracing, styling) down into every entity, so entities receive these rather than inventing their own.

It does **not** own logging, coloring, or task-execution logic itself — those stay in their own packages (`@panda/logger`, `@panda/colors`, `@panda/task`, etc.) and get handed to entities through the context. If kernel starts accumulating real logging/styling code, that's a signal something has gone wrong — it should stay thin.

## 1. The entity contract

```typescript
// @panda/kernel/src/types.ts

/** JSON Schema, used both for validating config and for AI/tool introspection */
export type JSONSchema = Record<string, unknown>

/** Shared capabilities handed to every entity at run time. Entities receive
 *  these — they do not construct their own logger/tracer/styler. */
export interface PandaContext {
  log: PandaLogger        // from @panda/logger, or a no-op stub if not configured
  trace: PandaTracer       // from @panda/trace, or a no-op stub
  style: PandaStyler        // from @panda/colors, via $infuse() — see below
  refs: Record<string, PandaEntityInstance>  // other resolved entities, by manifest key
  config: Record<string, unknown>            // this entity's own resolved config
}

/** What every @panda/* entity class must implement. */
export interface PandaEntityClass {
  /** Manifest-facing type name, e.g. 'panda:command', 'panda:task' */
  readonly type: string
  /** JSON Schema describing valid `config` for this entity type —
   *  this is what makes an entity self-describing to a human, a validator,
   *  or an AI agent deciding how to fill in a manifest. */
  readonly configSchema: JSONSchema
  /** Factory: build an instance from validated JSON config. No functions
   *  allowed inside `config` — only data and named references (strings)
   *  resolved via the registry (see "Named references", below). */
  new (config: Record<string, unknown>): PandaEntityInstance
}

export interface PandaEntityInstance {
  /** Execute the entity given the shared context. */
  run(ctx: PandaContext): Promise<unknown>
}
```

Key rule carried over from the earlier discussion: **entity config must be real JSON.** Anything that today is a raw function in a config object (`action`, `transform`, `validate`) becomes a **named reference** — a string that the registry resolves to a function the developer registered once in a small bit of glue code, not embedded in the manifest itself. This is the same pattern Scaffold/Task already use for `type: 'npm:install'`, generalized to cover arbitrary user callbacks.

```json
{ "action": "myapp:deployAction" }
```

```typescript
// one-time glue code, not part of the manifest
kernel.registerAction('myapp:deployAction', async (data, ctx) => { ... })
```

## 2. The registry

```typescript
// @panda/kernel/src/registry.ts

class PandaRegistry {
  registerEntity(entityClass: PandaEntityClass): void
  registerAction(name: string, fn: (data: unknown, ctx: PandaContext) => Promise<unknown>): void
  resolveEntity(type: string): PandaEntityClass
  resolveAction(name: string): (data: unknown, ctx: PandaContext) => Promise<unknown>
}
```

Every `@panda/*` package self-registers its entity type(s) on import (e.g. `@panda/command` calls `registry.registerEntity(Command)` in its own index.ts, or exposes a `register(registry)` function the app calls once at startup — TBD which is more ergonomic, decide during the proof-of-concept, don't pre-decide now).

## 3. The manifest + resolver

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
        "options": [{ "name": "env", "type": "string" }],
        "action": "myapp:deployAction"
      }
    }
  }
}
```

- `entities` — a flat map of manifest-local keys to entity declarations.
- `type` — resolved against the registry to find the entity class.
- `uses` — other entity keys this entity depends on; the resolver must topologically order instantiation so dependencies resolve first, and their instances are made available via `ctx.refs`.
- `config` — validated against that entity type's `configSchema` before instantiation (using `ajv` or similar — hence the devDependency).

```typescript
// @panda/kernel/src/resolver.ts

function resolve(manifest: PandaManifest, registry: PandaRegistry, baseCtx?: Partial<PandaContext>): Promise<Record<string, PandaEntityInstance>>
```

`resolve()` is the entire "bind everything via JSON" promise made real: given a manifest and a registry of available entity types, produce a fully wired, running set of instances. This is the piece that never existed (`CommandCenter` was reaching for this and was never built).

## 4. Conformance

Once this shape is implemented, "is an entity package done" becomes: does it export a class satisfying `PandaEntityClass`, does a sample config validate against its own `configSchema`, and does `run()` produce a result — checkable by a shared test harness, not a feeling. (Harness itself is a later step, not part of this draft.)

## What's explicitly deferred (not part of this draft)

- Whether entities self-register on import vs. explicit `register(registry)` calls.
- Whether `PandaContext.style` is provided via `@panda/colors`' `$infuse()` directly, or via a kernel-level wrapper around it — depends on finding/rebuilding the `$infuse()` work.
- Dependency-cycle handling in `uses` (error out for now; don't design around it prematurely).
- Whether the manifest supports environments/overrides (e.g. dev vs. prod config) — YAGNI until the 2-entity proof exists.

## Next step

Build the smallest possible working version of this: one entity type (`panda:command`, ported from the existing `@panda/command`... or a stub), the registry, and `resolve()` wiring exactly one manifest with two entities (a command that `uses` a logger). No polish. The goal is only to prove `resolve(manifestJson)` produces a runnable app.
