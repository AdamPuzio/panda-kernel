# Pluggable Relationship Handlers (Design, Not Yet Built)

Prompted by: "do we design specific handlers for each potential interface, so the system stays extendable as we design new ways to use this?" — yes. This document is the answer to that question.

**Status: design only.** Nothing here is implemented. This extends `SPEC.md` and follows from the gaps identified in `examples/at-scale/README.md` §3 (static inputs/exports, ambient context, contribution/extension points, computed inputs — and whatever relationship shapes get discovered after this one).

## The core decision

Don't hardcode `uses`, `contributes`, `inputs`, and `computed` as four special-cased branches inside `resolve()`. That's exactly the shape of problem the rest of this project is trying to get away from — a fixed, closed set of behaviors baked into one place, that has to be edited (and re-argued-about) every time a new composition pattern is discovered.

Instead, generalize the same registry pattern already used for entity types and actions: **a relationship between entities is itself a pluggable, named thing.** The resolver's job shrinks to "read the manifest, find which handler owns each keyword, hand it the pieces, let it do the wiring." New relationship shapes get added by registering a new handler, not by touching the resolver.

## The contract

```typescript
// @panda/kernel/src/types.ts (addition)

export interface PandaLinkHandler {
  /** The manifest keyword this handler owns, e.g. 'uses', 'contributes', 'computed' */
  readonly keyword: string

  /** Called by the resolver's topo-sort step, BEFORE any entity is
   *  instantiated, to find out which other entity keys this handler's value
   *  depends on. For `uses`, this is just the array itself. Added after
   *  working through the plugin-contribution example (see
   *  examples/at-scale/plugin-contribution.md) — without this, only `uses`
   *  participated in dependency ordering, so a handler like `contributes`
   *  could run before the entity it references had been resolved. */
  getDependencies(value: unknown): string[]

  /** Called once per entity, during resolve, after the entity instance exists
   *  but before its `run()` is invoked. Handlers mutate/extend `ctx` (or, for
   *  contribution-style handlers, reach into another entity's instance) —
   *  they do not replace the resolver's core instantiation/topo-sort logic. */
  apply(params: PandaLinkParams): Promise<void> | void
}

export interface PandaLinkParams {
  /** The raw value attached to this keyword in the manifest entry,
   *  e.g. the array under "uses", or the object under "contributes". */
  value: unknown
  /** The entity instance currently being wired. */
  instance: PandaEntityInstance
  /** The context being built up for this entity — handlers may add to it. */
  ctx: PandaContext
  /** All other already-resolved instances in this manifest, by key. */
  instances: Record<string, PandaEntityInstance>
  /** The registry, in case a handler needs to resolve further types/actions. */
  registry: PandaRegistry
}
```

The resolver becomes, roughly:

```typescript
// Pass 1: topo-sort using every registered handler's getDependencies,
// not just `uses` — this is the fix the plugin-contribution walkthrough
// surfaced (see examples/at-scale/plugin-contribution.md, Step 4).
function getEntityDependencies(entry: PandaManifestEntity, registry: PandaRegistry): string[] {
  const deps: string[] = []
  for (const [keyword, value] of Object.entries(entry)) {
    if (keyword === 'type' || keyword === 'config') continue
    deps.push(...registry.resolveLinkHandler(keyword).getDependencies(value))
  }
  return deps
}

// Pass 2: instantiate in dependency order, then apply every handler.
for (const key of order) {
  // ...instantiate the entity as today...
  for (const [keyword, value] of Object.entries(entry)) {
    if (keyword === 'type' || keyword === 'config') continue // core, not a link
    const handler = registry.resolveLinkHandler(keyword)
    await handler.apply({ value, instance, ctx, instances, registry })
  }
}
```

## What's actually "core" vs. pluggable — precise breakdown

Answering directly: the built-in, non-optional pieces of the kernel are **not** "uses, log, trace, style" as a flat list — those are two different *kinds* of thing, and conflating them is worth avoiding:

| Mechanism | Kind | Pluggable? |
|---|---|---|
| `type`, `config` | Core manifest keywords, consumed directly by the resolver's instantiation step (look up the entity class, pass config to its constructor) | No — not handlers at all, this is the resolver's own base job |
| `uses` | The one always-registered `PandaLinkHandler` | Structurally pluggable (goes through the same interface as `contributes`/`computed`), but shipped and registered by the kernel itself unconditionally, since dependency ordering doesn't work without it |
| `log`, `trace`, `style` (`ctx.*`) | Ambient context, supplied directly by `resolve()` to every entity, independent of any manifest keyword | **Not** a link handler at all — no entity ever writes `"log": [...]` in a manifest. This is a different mechanism (context injection), not a relationship between two named entities |
| `contributes`, `computed`, (future ones) | Optional, registered `PandaLinkHandler`s | Yes — fully pluggable, kernel may ship official implementations of these but they're not privileged over a third party's custom handler |

So the honest answer to "what are the core handlers — uses/log/trace/style?" is: **`uses` is the only core *handler*.** `log`/`trace`/`style` are core, but they're a structurally different mechanism (ambient context, not manifest-keyword-driven wiring) — worth keeping that distinction sharp so a future "let's add a new ambient service" conversation doesn't get treated as "let's write a new handler" and vice versa.

One open question this raises, not yet decided: `PandaContext` today is a fixed interface (exactly `log`/`trace`/`style`/`refs`/`config`). Adding a new ambient capability later (e.g. `ctx.metrics`) means editing that core type — which is the same "have to touch core to extend" problem the handler pattern was designed to avoid, just relocated to ambient services instead of relationships. Worth deciding later whether ambient context should also become an extensible bag (e.g. a registered `ctx.services.metrics`) rather than named fields — but that's a real trade-off against ergonomics/type-safety of the three well-known fields, not an obvious win either way, so it's flagged here rather than pre-decided.

## What each of the discovered shapes looks like as a handler

- **`uses` handler** (already effectively built, just not yet factored out this way) — given an array of entity keys, populates `ctx.refs` with the already-resolved instances. This is the one handler that's load-bearing for topo-sort ordering, so it likely stays a first-class, always-registered handler rather than a fully optional plugin — but it should still go through the same interface as the others, not live as special-cased resolver code.
- **`contributes` handler — RESOLVED as `contributesTo`, not `contributes.from`.** Originally sketched as a keyword on the *host* (`contributes: { "from": ["statusPlugin.command"] }`). Working through deep module nesting (see `examples/at-scale/module-nesting-at-depth.md`) settled this: it must be a keyword on the *contributor* instead — `contributesTo: "someHostKey"` — because the host may live several module layers away, with no local manifest entry to attach a host-side keyword to. The contributor is always local by definition, so the keyword belongs there. Given a config block describing what capability is being contributed, the handler reaches into the target entity's instance (resolved via the one-hop reference grammar below) and calls a contribution method on it (e.g. `hostInstance.registerContribution(thisInstance)`). This requires host entity types (`panda:cli`, `panda:express`, `panda:scaffold`) to themselves implement an optional `registerContribution()` method — i.e., "supports being extended" is an opt-in capability an entity type declares, not something every entity must handle.
- **Entity references are exactly one hop, everywhere — a rule, not just a convention.** `uses`, `contributesTo`, and (new) the values inside a manifest's own `exports` block all use the same reference grammar: either a bare local entity key, or `moduleKey.exportName` resolved against that one module's already-resolved exports — never a multi-hop path reaching through several modules' internals at once (`a.b.c.d` is disallowed). Long chains are built by each layer explicitly re-exporting what it received under its own name, the same way npm re-exports compose one file at a time. This is deliberate, not a limitation: it means each module author controls exactly how much of what's beneath them stays reachable — a CMS module can choose to re-export a raw Express app (maximum extensibility) or withhold it in favor of its own higher-level extension points (tighter control), and either is a correct use of the mechanism. See `module-nesting-at-depth.md` for the full worked chain (Express → web adapter → CMS → ecommerce → end-user plugins).
- **`computed` handler** — given a reference like `{ "from": "devServer", "path": "port" }`, defers resolution: instead of resolving at manifest-load time, it registers a lazy getter/promise on `ctx.config` that only resolves once `instances.devServer.run()` has actually completed. This is the one handler with real sequencing implications (it needs the referenced entity to have run first, not just been instantiated) — worth its own careful design pass when it's actually built, not assumed to be a small tweak.
- **Ambient context (`log`/`trace`/`style`) — deliberately NOT a pluggable handler.** This one stays a kernel core built-in, supplied directly by `resolve()` to every entity unconditionally, rather than something registered per-keyword. Reasoning: ambient services are true infrastructure every entity needs by default; making them opt-in/pluggable would mean some entity types could silently end up without a logger, which defeats the point of them being ambient. This is a deliberate exception, written down so it isn't "discovered" as an inconsistency and re-litigated later — if it turns out ambient context does need to be pluggable (e.g. a future capability nobody's thought of yet that not every entity should get by default), that's a real reason to revisit this specific paragraph, not a reason to make everything pluggable "for consistency."

## Why this is worth doing now, in the design, rather than later

This is precisely the kind of decision that's cheap to make correctly up front and expensive to retrofit — if `uses`/`contributes`/`computed` get hardcoded into `resolve()` first, then generalized later, every existing manifest and every existing entity type has to be touched a second time. Designing the extension point before writing the second and third handlers means the second and third handlers (and the fourth, fifth, whatever gets discovered next) are just "write a class satisfying `PandaLinkHandler` and register it" — no kernel changes required. That's the actual definition of "extendable system" being asked for.

## What this changes about "done" for the kernel

The kernel's own conformance target shifts slightly: it's not "the kernel implements `uses`, `contributes`, `computed`, and ambient context" — it's "the kernel implements the link-handler registry/dispatch mechanism, plus ships `uses` as a built-in handler." Everything else (contributes, computed, and whatever comes after) is then a *separate*, individually buildable, individually testable unit of work — which also means each one can be its own small milestone instead of one big "finish the whole relationship model" effort.

## Next step (still design, not code)

Done: worked through the plugin-contribution example end to end — see `examples/at-scale/plugin-contribution.md`. It confirmed the `contributes` handler design (plugins publish via the same `exports` mechanism as any module; the *consumer* decides `uses` vs. `contributes`; host entity types opt in via a duck-typed `registerContribution()` method) and surfaced the `getDependencies()` gap now reflected in the contract above.

Also done: worked through `computed` — see `examples/at-scale/computed-values.md`. This one turned out to be architecturally different from `uses`/`contributes`, not just a fourth item in the same list:

- **It's not a `PandaLinkHandler` at all.** `uses`/`contributes` are top-level manifest keywords sitting beside `config`; `computed` needs to appear *inside* `config`, at arbitrary nesting depth (`{"$computed": {"from": "devServer", "output": "port"}}`). That requires a **third pluggable mechanism — value resolvers** — that recursively walk a config payload looking for marker objects, distinct from link handlers which only look at the entity-entry level.
- **This unifies with `${inputs.x}`** from the module/exports design (`examples/at-scale/panda-auth.manifest.json`) — both are "resolve this bit of config from elsewhere," and should share one mechanism/marker convention (`{"$input": "..."}`, `{"$computed": {...}}`) rather than one being string interpolation and the other an object marker. Not yet migrated — flagged for later.
- **It crosses the construct/run boundary.** `uses`/`contributes` only need their target entity constructed; `computed` needs it to have actually *run* (a dev server's port doesn't exist until the server started). Decided: resolving a computed value must **never** implicitly trigger `run()` as a side effect — source entities instead opt in via a separate method (e.g. `provideValue(output)`), consistent with how `registerContribution` is already a distinct opt-in method rather than overloading `run()`.
- **Dependency-graph collection needs to scan `config`, not just sibling keywords** — the `getDependencies()` fix added for `contributes` isn't sufficient on its own for markers buried inside config.

So the full pluggable-mechanism inventory is now three, not two: **entity types** (registry), **link handlers** (relationships between whole entities, `uses`/`contributes`), and **value resolvers** (transformations of individual config values, `$input`/`$computed`). Each has its own registry and its own contract.

Remaining before any of this gets implemented: decide the value-resolver contract's exact shape (sketched in `computed-values.md` as `matches()`/`resolve()`) and whether `$computed`/`$input` should be unified now or left as a known-future cleanup.
