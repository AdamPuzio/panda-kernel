# Status & Roadmap

An honest accounting of what's real vs. designed, so nobody — including future us — mistakes one for the other. Updated as things move from one column to the other.

## Implemented and working today

| Piece | Where |
|---|---|
| Entity contract (`type`, `configSchema`, `configure`/constructor, optional async `configure(ctx)` lifecycle hook, `run`) | `src/types.ts` |
| Registry: entity types, actions, services, link handlers, module sources | `src/registry.ts` |
| Manifest resolver (dependency ordering across every registered link handler, `ctx.refs`, `ctx.config`) | `src/resolver.ts` |
| Ambient services as a pluggable registry (`registerService`), with `log`/`trace`/`style` as overridable defaults | `src/registry.ts`, `src/types.ts` |
| Namespaced registration (`{ namespace }` on register calls) to prevent name collisions across packages | `src/registry.ts` |
| Three stub entity types proving the whole thing works end to end: `panda:logger`, `panda:command`, `panda:cli` | `src/entities/` |
| **`validate()` — dry-run / validate-only resolution.** Checks a manifest for problems (unregistered types, config that fails its `configSchema`, unresolved action references via an opt-in `pandaActionRef` schema marker, unknown/circular dependencies across *any* link handler, and unrecognized manifest keywords) without ever constructing or running a single entity. Returns a structured, aggregated diagnostic report instead of throwing on the first problem. | `src/validator.ts`, `docs/validating-manifests.md` |
| **Pluggable link handlers (`uses`, `contributesTo`).** `uses` is no longer hardcoded in the resolver — it's the first of potentially many `PandaLinkHandler`s, registered the same way any third party's own handler would be. `contributesTo`, declared on the *contributor* (not the host — see `HANDLERS.md` for why that direction won), is implemented and proven end to end: a `panda:command` entity contributes itself into a `panda:cli` host entity under a different namespace than the "app," simulating an independently-published plugin with no knowledge of the consuming app's manifest key. | `src/link-handlers.ts`, `src/entities/cli.ts`, `examples/demo-cli.ts`, `examples/cli-manifest.json` |
| **`panda:module` + a manifest's own `exports`/`inputs` + one-hop dotted references (`"auth.login"`) + `$input` value resolution.** A nested manifest is fully, recursively resolved via the `configure()` lifecycle hook (added specifically because implementing this surfaced that `getExport()` needs to be available *before* anyone's `run()` is called, not lazily inside `run()` — see `DECISIONS.md`). Consumers can parameterize a module (`config.inputs`), the module's own manifest declares an `inputs` schema (with `required`/`default`), and `{ "$input": "name" }` markers inside the module's own entity configs get substituted before the nested manifest is resolved — proven with both an explicit override and a default-fallback path, plus a required-input-missing error path. Verified end to end, including that a deliberately unexported entity is genuinely unreachable from the consumer, not just unreachable by convention. **Not implemented as part of this:** real npm package resolution (`source` is resolved against an explicit in-memory stand-in, `registry.registerModuleSource()`). | `src/entities/module.ts`, `src/entity-ref.ts`, `src/value-resolvers.ts`, `examples/demo-module.ts`, `examples/auth-module-manifest.json`, `examples/module-consumer-manifest.json`, `examples/module-consumer-no-inputs-manifest.json` |
| **`$computed` — config values resolved from another entity's runtime OUTPUT, not a static input.** `{ "$computed": { "from": "devServer", "output": "port" } }`. Resolved lazily, inside the CONSUMING entity's own `run()` (unlike `$input`, which resolves eagerly) — because the source entity has to have actually run first, which nothing can guarantee ahead of time. Reading a computed value never implicitly triggers `run()` — an entity opts in via a distinct `provideValue()` method; one that doesn't implement it fails clearly. Required a new `PandaContext.instances` field (the full manifest-wide instance map) since the design's own worked example deliberately has no `uses` declaration to populate `ctx.refs` with the source entity. Verified against the exact `devServer`/`openBrowser` scenario from the design doc, plus a negative test proving no implicit auto-run. | `src/value-resolvers.ts` (`ComputedValueResolver`), `src/entities/dev-server.ts`, `src/dependency-graph.ts`, `examples/computed-demo.ts` |

Verified by running `npx tsx examples/demo.ts`, `examples/demo-cli.ts`, `examples/demo-module.ts`, `examples/dry-run-demo.ts`, and every adapter demo in `examples/adapters/` from the `@panda/kernel` directory, and type-checked clean with `npx tsc --noEmit` after each change — **except `real-task-entity.ts`, a known, accepted, documented exception (see below).**

## Phase 2 retrofits — real `@panda/*` packages wired in, per `panda-opencode/roadmap.md`

All four proven this round, real behavior confirmed each time, not just that the code compiles:

| Package | Ambient service | Proven by |
|---|---|---|
| `@panda/colors` | `ctx.services.style` | `demo-real-colors.ts` — real ANSI codes confirmed in output (`\x1B[1;32m...`) |
| `@panda/trace` | `ctx.services.trace` | `demo-real-trace.ts` — real tag/level-filtered output; surfaced two genuine library-behavior findings (env config computed at import time, not runtime; `TRACE=on` alone doesn't raise the level threshold) — see `DECISIONS.md` |
| `@panda/logger` | `ctx.services.log` | `demo-real-logger.ts` — real Winston-backed structured output, clean on the first attempt |
| `@panda/task` | `panda:task` entity | `demo-real-task.ts` — real `listr2` rendering (`❯`/`✔` markers are the library's own output) confirmed running through the entity contract; each step's actual work bridges through the same named-action pattern as `panda:command`. **`@panda/factory` (the dependency this was previously blocked on) has since been recovered — see below.** |

**`@panda/factory` — recovered.** A complete, real implementation (recovered from the `_delete` archaeology folder) now lives in `legacy/panda-factory`, wired into the npm workspace, with `@panda/task`'s dangling dependency reference corrected. `@panda/task`'s built-in task types (`file:create`, etc.) are confirmed working end to end — verified writing a real file via Factory's actual `writeFile()`. `real-task-entity.ts` now imports from `@panda/task`'s built `dist` like every other adapter; `npx tsc --noEmit` is fully clean again. Full account in `DECISIONS.md`.

**`@panda/scaffold` — retrofitted, Phase 2 complete.** Proven with `demo-real-scaffold.ts`: real Handlebars-templated file generation via Scaffold's own internal Factory, real CLI option parsing inherited from the current `@panda/command`, and the `custom` action type bridged through the named-action pattern. Getting here surfaced a genuine version mismatch (Scaffold was pinned to a stale `@panda/command@^0.1.4` resolving from the public npm registry, not this workspace's `0.2.1`) and, after correcting it, two real pre-existing bugs in Scaffold's own source that had nothing to do with this retrofit (`when()` called but never defined on the base action class; a spinner success-message renderer that threw whenever no explicit message was configured, which was apparently always) — see `DECISIONS.md` for the full account. `@panda/scaffold`'s own internal `Factory` (distinct from the recovered `@panda/factory` package) was left as-is; reconciling the two is a separate, undecided question.

## The real-command adapter — the first "does this survive contact with reality" test

`examples/adapters/real-command-entity.ts` wraps the actual, unmodified `legacy/panda-command` library (imported from its built `dist/` output — exactly how a real consumer would use it) behind the entity contract, rather than the kernel's own deliberately minimal stub. This is a meaningfully different kind of proof than everything before it: every other entity type was built *for* the kernel contract, so fitting it was never in question. This is the first test against something that wasn't.

**What it proved works:** the real `command-line-args`-based parsing engine, including short-alias resolution (`-n` → `name`), runs correctly through the adapter — verified with a live check, not just the happy-path demo. The bridging pattern (a named `action` string resolved to a real closure at construction time, capturing `ctx` lazily since it isn't available until `run(ctx)`) worked as designed.

**What it surfaced, a real bug caught immediately by actually running it (not by more design):** naively materializing `arguments`/`options`/`flags` unconditionally added an `arguments: undefined` key into the config even when a manifest never declared `arguments` at all — which then silently overwrote the real library's own class-field default (`= []`) during its own `Object.entries(cfg).forEach(...)`-based initialization, throwing inside its `prepare()` step. Fixed by only touching a field if the manifest actually declared it. This is exactly the kind of gap that only shows up against real, independently-built code — no amount of additional paper design would have caught it.

**A second, smaller friction point, solved the same way as `action`:** the real library expects `type: String` (an actual JS constructor) on each param definition, which can't exist in JSON. Solved with the same "JSON-safe marker resolved to the real thing at construction time" pattern already established for `action` — string literals `"String"`/`"Number"`/`"Boolean"` get mapped to their real constructors before the real `Command` is constructed.

**Known, deliberately unaddressed limitations of this first pass** (documented in the adapter's own file comments): `validate()` functions embedded in individual argument/option/flag definitions aren't bridged (would need the same named-reference treatment as `action`, not yet done); and native usage patterns relying on `this.out()`/`this.heading()`/`this.rainbow()` inside actions don't work through the bridge — `ctx.services.log`/`ctx.services.style` are the replacement, which is precisely the problem ambient services were designed to solve.

**The operating principle this preserves, worth restating:** `legacy/panda-command`'s source was never modified — not even to add `node_modules` inside its own directory changes any source file. A developer who has never heard of Panda manifests can still `npm install @panda/command` and use `new Command({...})` exactly as before; the adapter is purely additive, living alongside the library, not inside it.

## Phase 3 — real EXTERNAL (non-Panda-authored) library wrappers

| Library | Entity types | Proven by |
|---|---|---|
| `express` (real npm package, not a `@panda/*` one) | `panda:express` (host), `panda:express-route`, `panda:express-middleware` (both contribute via the existing, unmodified `contributesTo` handler) | `demo-real-express.ts` — a real running server, a real contributed route, and a real contributed middleware, all verified by sending an actual HTTP request at it, not just checking that `run()` didn't throw |

This is also where `longRunning?: boolean` was added to `PandaEntityClass` (`src/types.ts`) — the first entity type whose `run()` resolving means "started," not "finished." No resolver changes were needed to support it; `resolve()` never awaited `run()` in the first place. `express`/`@types/express` live as devDependencies of the *workspace root* (`panda-workspace-root`, never published), not `@panda/kernel`'s own `package.json` — kernel's manifest has zero entries for Express, same as it has zero entries for every `@panda/*` package it wraps; this was gotten wrong on the first attempt and corrected (see `DECISIONS.md`). Full account, including the deliberately-thin action-bridge design, in `DECISIONS.md`.

**Express's Part 4 gap — closed.** Contributing a route into a `panda:express` instance living *inside* an imported `panda:module` works with zero new mechanism — `examples/adapters/demo-express-module-nesting.ts`, verified with real HTTP requests against both a module-internal route and a consumer-contributed one reaching across the module boundary. See `DECISIONS.md`.

**`panda:mongodb` — Phase 3's second deliverable, done.** `examples/adapters/real-mongodb-entity.ts`, importing the real `mongodb` npm driver (same corrected devDependency placement as `express` — workspace root, not kernel's own `package.json`). A structurally different shape than Express: a stateful resource other entities `uses` to get a live handle (`ctx.refs.mongo.getDb()`), not a host accepting contributions. Deliberately NOT marked `longRunning` — its `run()` genuinely completes ("connect, be ready"), sharpening what that flag actually means (completion point of the entity's own job, not whether a background resource stays open). Surfaced a real, `uses`-specific finding: the resolver orders *construction* via `uses`, not automatic `run()` sequencing — `demo-real-mongodb.ts` is the first demo that has to call `run()` on a dependency before its dependent, and `getDb()` throws clearly if that order is violated. Verified against a real, disposable Docker container (not any pre-existing one on this machine) with a real insert followed by a real query. **Phase 3 is now fully complete.** Full account in `DECISIONS.md`.

**Phase 4 — real npm package resolution for `panda:module`'s `source` — done.** `src/npm-resolution.ts`: a package declares `"panda": { "manifest": "<path>" }` in its own `package.json` (a new convention, established here — reusing the same `"panda"` field found in `legacy/panda-scaffold`'s package.json during the original ecosystem archaeology). Real resolution via Node's own `require.resolve` is tried first; `registry.registerModuleSource()` is now an explicit test-double mechanism, falling through only when `source` isn't a real installed package. Verified against a real, new workspace member (`@panda/example-auth-module`) built purely to prove this — `examples/demo-npm-module-resolution.ts` is the exact same scenario as `demo-module.ts`, with zero calls to `registerModuleSource`, confirming inputs/encapsulation both still work correctly through the real resolution path. A distinct, deliberate error (not a silent fallback) when a package is real but its declared manifest file is missing, verified directly against a real installed package with no `panda.manifest.json`. Full account in `DECISIONS.md`.

## Designed, with a concrete worked example, but not implemented

Nothing currently in this category — the one remaining item (real npm resolution) is now implemented; see above.

## Identified as needed, not yet designed with a concrete example

| Gap | Why it matters |
|---|---|
| Entity-type versioning (e.g. `panda:command@2`) | So an entity type's `configSchema` can change over time without silently breaking old manifests |
| Manifest splitting/include mechanism | A single app's own manifest will get too large to hand-author as entity count grows — distinct from `panda:module`, which is for reuse across projects, not splitting one project's file |
| Lifecycle teardown (`dispose()`) | Cleanup when resolution partially fails mid-way through constructing/running entities |
| Conformance test harness | An objective, automatic way to check "does this entity satisfy the contract," rather than relying on manual review |

## Explicitly out of scope for now (a decision, not an oversight)

- **No state tracking across runs.** Panda is not (currently) meant to be a Terraform-style tool that tracks previously-applied infrastructure state. It resolves and runs a manifest fresh each time.
- **No special trust/permission model for third-party modules.** A module you depend on can run arbitrary code, the same as any npm dependency today — not worse, but not more restricted either.

## Why real packages weren't retrofitted immediately

`@panda/command`, `@panda/scaffold`, `@panda/task`, `@panda/logger`, `@panda/trace`, `@panda/colors` existed as working (if inconsistent with each other) libraries in `legacy/` before Phase 2, but didn't yet implement the `PandaEntityClass`/`PandaEntityInstance` contract. That gap was deliberate at the time — see `panda-opencode/working-pattern.md` — and is now closed; all six are retrofitted as of Phase 2 (see above). Phase 3's job is different in kind, not degree: proving the same contract against libraries Panda doesn't own or control at all.
