# Worked Example: Computed (Lazy, Run-Time-Resolved) Values

Stress-testing the fourth relationship shape from `README.md` §3. This one turned out to be architecturally different from `uses`/`contributes` in ways worth being explicit about before designing a handler for it.

**Status: design walkthrough, not implemented.**

## The scenario

A `devServer` entity picks a random free port when it starts. An `openBrowser` command needs that actual port number — not a static config value, because it isn't known until `devServer` has actually run.

```json
{
  "panda": "1",
  "entities": {
    "devServer": {
      "type": "panda:devServer",
      "config": { "portRange": [3000, 4000] }
    },
    "openBrowser": {
      "type": "panda:command",
      "config": {
        "command": "open",
        "action": "myapp:openBrowserAction",
        "url": { "$computed": { "from": "devServer", "output": "port" } }
      }
    }
  }
}
```

## Discovery 1 — this isn't the same kind of thing as `uses`/`contributes`

`uses` and `contributes` are **top-level manifest keywords**, sitting next to `config`, resolved once by looking at the whole entity entry. `{"$computed": {...}}` above sits **inside** `config`, potentially nested arbitrarily deep (it could just as easily be `config.options[2].defaultValue`). A `PandaLinkHandler` operates on one keyword at the entity level; this needs something that recursively walks a config *value tree* looking for marker objects, wherever they appear.

That means `computed` isn't a fourth `PandaLinkHandler` at all — it's a different, third kind of pluggable mechanism: a **value resolver**, which transforms individual pieces of a config payload rather than wiring relationships between whole entities.

```typescript
export interface PandaValueResolver {
  /** Recognizes whether a given config value is something this resolver
   *  should handle, e.g. an object shaped like { "$computed": {...} }. */
  matches(value: unknown): boolean
  /** Produces the real value, given access to already-resolved instances. */
  resolve(value: unknown, instances: Record<string, PandaEntityInstance>): Promise<unknown>
}
```

## Discovery 2 — this unifies with `${inputs.x}` from the module design

Looking back at the module/exports example (`panda-auth.manifest.json`), `${inputs.tokenSecret}` is doing the exact same job: transforming one piece of a config value into something resolved from elsewhere. It was drafted as ad hoc string interpolation at the time; in hindsight it should be **the same value-resolver mechanism**, just a different resolver registered under a different marker:

- `{"$computed": {"from": "devServer", "output": "port"}}` → resolved from another entity's runtime output
- `{"$input": "tokenSecret"}` (replacing `${inputs.tokenSecret}`) → resolved from the module's declared inputs
- Future: `{"$env": "TOKEN_SECRET"}`, `{"$secret": "..."}`, etc.

Recommendation: standardize on one marker convention (structured `{"$xxx": ...}` objects, not embedded string interpolation) so there's one recursive-config-walking mechanism in the kernel, with multiple resolvers registered against it — rather than two separate ad hoc mechanisms (string interpolation for inputs, object markers for computed) that happen to do conceptually the same thing. **This is a change to the earlier module design**, worth updating `examples/at-scale/panda-auth.manifest.json` when this gets formalized, not urgent to do right now.

## Discovery 3 — the real problem: `computed` crosses the construct/run boundary

`uses` and `contributes` only need their referenced entities to be **constructed**. `computed` needs its referenced entity to have actually **run** — `devServer.port` doesn't exist until `devServer.run()` has executed and picked a port. Nothing so far in the kernel controls run-order across entities at all; today, something external just calls `.run()` on whichever instances it wants, whenever it wants (see `examples/demo.ts` — only `instances.deploy.run()` is ever called).

This raises a real question: **should resolving a computed value implicitly trigger the source entity to run?** Two options, with a clear preference:

- **Option A — implicit, automatic:** the value resolver calls `devServer.run()` itself (memoized so repeat references don't re-run it) as a side effect of resolving `openBrowser`'s config. Fully automatic, matches "declarative JSON, no glue code" — but dangerous: a config reference that merely *reads* a value would silently *cause* a side-effecting entity (starting a server, deploying something) to execute, possibly when the app never intended to run it as part of the current invocation.
- **Option B — explicit opt-in via a separate method, not `run()`:** a source entity that wants to expose computed values implements a distinct, optional method — e.g. `provideValue(output: string): Promise<unknown>` — separate from `run()`. If producing that value requires starting the server, that's the entity's own internal implementation detail (it can call its own run logic internally, cache it), but from the kernel's perspective, "give me a value" and "execute my primary behavior" are two different, independently-invokable things. If an entity doesn't implement `provideValue`, computed references to it fail clearly at resolve time ("devServer does not support computed values") rather than silently triggering unintended execution.

**Recommendation: Option B.** It's consistent with how `registerContribution` was already handled — an entity type opts into extra capabilities via a distinct method, rather than the kernel overloading `run()` to mean multiple things depending on who's asking. It also keeps side effects predictable: nothing runs as a side effect of a config value being read.

## Discovery 4 — dependency-graph collection needs to look inside `config` too

Following from Discovery 1: the topo-sort fix added for `contributes` (every `PandaLinkHandler.getDependencies()`) isn't sufficient here either, since `$computed` markers live inside `config`, not in a sibling keyword. The resolver's dependency-collection pass needs a second source: recursively scan each entity's `config` for value-resolver markers and add their `from`/equivalent entity keys as dependencies too. So building the full dependency graph for one entity means: link-handler keywords (`uses`, `contributes`, ...) **plus** any value-resolver markers found anywhere in `config`.

## What this settles vs. leaves open

**Settled by this walkthrough:**
- `computed` (and `${inputs.x}`) are a third pluggable mechanism — value resolvers — distinct from entity types and link handlers, operating inside config payloads rather than at the entity-entry level.
- Value resolution must go through an opt-in method (`provideValue()` or similar) separate from `run()`, never implicitly triggering `run()` as a side effect.
- Dependency-graph construction needs to scan inside `config`, not just look at sibling keywords.

**Left open, genuinely undecided (don't pre-decide):**
- Exact marker convention (`$computed` vs. something else) and whether to retroactively migrate `${inputs.x}` to it now or later.
- Whether `provideValue()` results should be cached per-resolve-call, per-process, or not at all by default (a devServer's port should be stable for the life of the process; a "current git SHA" value might legitimately be re-read each time — these probably need different caching semantics, which argues caching policy might belong to the entity's own `provideValue()` implementation rather than being a kernel-wide default).
- Whether `$computed` references are allowed to appear inside `uses`/`contributes` values themselves (i.e. dynamic dependency names computed at runtime) — leaning toward **no, disallow this**, to keep the dependency graph fully static and analyzable before anything runs; a manifest whose own shape depends on runtime values is a much harder thing to validate, introspect, or have an AI agent reason about safely.
