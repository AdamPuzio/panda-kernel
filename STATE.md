# State of the Kernel — 2026-09-25

A single, canonical "where things stand and how to pick this back up" document. Read this first before diving into `SPEC.md`, `HANDLERS.md`, `DECISIONS.md`, or `docs/`, which hold the detail this summarizes.

## The arc, in brief

This kernel exists because of a specific, named problem: Adam's prior attempts at "Panda" (Entity, then Atom, several rewrites of colors/trace/task/command) kept looping — obsessive refactoring of leaf packages with diminishing returns, without ever building the one thing (a JSON-manifest binder) that would have told him which polish actually mattered. `panda-opencode/working-pattern.md` diagnosed this and set two rules: (1) build the smallest real, working thing before designing further, and (2) log decisions instead of re-litigating them. Everything below is the result of actually following that discipline for one extended session — including one moment, explicitly named at the time, where the discipline slipped (three rounds of pure paper design with no code) and was self-corrected back to building.

## What exists and is verified, right now

All of the following is real code, type-checked clean (`npx tsc --noEmit`), and proven by running actual scripts (`npx tsx examples/...`) — not just designed:

- **The entity contract** (`src/types.ts`) — `PandaEntityClass`/`PandaEntityInstance`, with `configure()` (async, eager setup) and `run()` (the main action) as the two lifecycle hooks.
- **The registry** (`src/registry.ts`) — four independent, pluggable sub-registries: entity types, actions, ambient services, link handlers, plus module sources and value resolvers. Everything registers the same way; nothing is hardcoded as a special case in the resolver.
- **The resolver** (`src/resolver.ts`, `src/dependency-graph.ts`) — turns a JSON manifest into running, wired instances. Dependency ordering considers every registered link handler, not just one hardcoded keyword.
- **Ambient services** (`log`/`trace`/`style`, extensible via `registerService` + TypeScript declaration merging, not a fixed interface).
- **Namespacing** (`{ namespace }` on every register call) — prevents two independently-published packages from colliding on a short name.
- **`validate()` / dry-run** (`src/validator.ts`) — checks a manifest for every kind of problem (unknown types, schema violations via `ajv`, unresolved action references, unknown keywords, unknown/circular dependencies) without ever constructing a single entity. Returns an aggregated report instead of throwing on the first issue.
- **Link handlers**: `uses` (dependency + `ctx.refs`) and `contributesTo` (plugin-style contribution into a host entity via an opt-in `registerContribution()` method) — both are ordinary registered handlers, not resolver special cases.
- **`panda:module` + a manifest's own `exports`/`inputs`** — an entire manifest can be reused as one entity inside a bigger one, with genuine encapsulation (verified with a negative test — an unexported entity is *unreachable*, not just discouraged) and real parameterization (override, default, and required-missing-error, all three checked).
- **One-hop entity references** (`"auth.login"`) — `entity-ref.ts` — deliberately capped at one hop through any module boundary, so long chains are built by explicit re-export at each layer, never by reaching through several packages' internals at once.
- **`$input` value resolver** — the first of a planned family of config-tree transformations, distinct from link handlers (which wire whole entities together) — resolves `{ "$input": "name" }` markers inside a nested manifest's own config.
- **A real, working host/plugin pair**: `panda:cli` (host, implements `registerContribution`) plus a `panda:command` stub contributed into it under an entirely different namespace, simulating an independently-published plugin.
- **The real-command adapter** (`examples/adapters/real-command-entity.ts`) — the actual, unmodified `legacy/panda-command` library (via its built `dist/`, not raw source), wrapped behind the entity contract with zero changes to the library itself. This is the first and only proof so far that the design survives contact with something that wasn't built for it, and it caught one genuine bug in the process (materializing config fields that were never present, silently overwriting the real library's own defaults).

Working examples proving all of this, runnable right now:

```bash
cd @panda/kernel
npx tsx examples/demo.ts                        # the original 2-entity proof
npx tsx examples/demo-cli.ts                     # uses + contributesTo together
npx tsx examples/demo-module.ts                  # panda:module, exports, inputs
npx tsx examples/dry-run-demo.ts                 # validate() catching 4 distinct problems in one pass
npx tsx examples/adapters/demo-real-command.ts   # the real @panda/command library, adapter-wrapped
```

## What's designed, with a concrete worked example, but not implemented

- **`$computed`** — a value resolved from another entity's *runtime output* rather than a static input. Deliberately not built alongside `$input` because it has a genuinely harder timing problem: it needs its source entity to have actually *run*, not just been constructed, and resolving it must never implicitly trigger that run as a side effect. See `examples/at-scale/computed-values.md`.
- **Real npm package resolution** for `panda:module`'s `source` — currently a deliberate in-memory stand-in (`registry.registerModuleSource()`), not real package resolution.

## What's identified as a real gap, not yet designed with an example

Entity-type versioning, a manifest-splitting/include mechanism for large single-app manifests, lifecycle teardown (`dispose()`), and a conformance test harness. None of these are urgent yet — they matter once there are many entity types, large manifests, or resource-holding entities in real use, none of which exist yet.

## What this does NOT solve, and shouldn't be assumed to

Wrapping `@panda/command` via an adapter proves the kernel can coexist with *one* piece of the old, unconsolidated ecosystem in `legacy/`. It does not reconcile it. `@panda/logger`, `@panda/trace`, and `panda-task`'s own internal hand-rolled logger are still three separate, unreconciled things; `@panda/colors` is still unused anywhere. That consolidation work (named back in `gaps-and-questions.md` and `working-pattern.md`) is unchanged by anything built this session — the adapter pattern is a good, proven mechanism for bringing legacy code in *one piece at a time*, but the duplication problem will resurface the moment two more legacy packages get wrapped simultaneously, not because the mechanism is wrong, but because nobody has yet decided which of the three loggers wins.

## Confidence, honestly, as of this checkpoint

High confidence in the core mechanism (built, tested, boring proven patterns). Medium-high confidence in composition-at-scale — every mechanism has now been checked against a scenario designed to break it and held, including three real external-facing tests: one `@panda/*` package that predates the kernel (`@panda/command`), and two libraries Panda doesn't own at all, deliberately chosen for different lifecycle shapes (`express`, a long-running host taking contributions; `mongodb`, a stateful resource other entities `uses`). Neither the `contributesTo` nor the `uses` link handler needed any changes to support either — a genuine positive signal, not just "it compiled." Still-open, still-unproven: whether the working-pattern discipline holds without active enforcement over a longer, unsupervised stretch of time, and whether this becomes something anyone besides its author actually adopts — neither of those is a design question, and neither has evidence yet either way.

## If picking this up again — ranked options, not a mandate

See also [`../../panda-opencode/roadmap.md`](../../panda-opencode/roadmap.md) for the full ecosystem-wide phased plan (legacy consolidation, real-library adapters beyond Express/MongoDB, repo/npm structure, example projects, documentation) — this section is the short version scoped to the kernel itself.

**Phase 0 is done** (npm workspace at the panda root ties every real package together under one `npm install`; versioning convention decided — kernel-retrofitted packages bump to a major version under the same `@panda` scope; `@panda/paws` is scaffolded, spec-first, as the eventual CLI name). **Phase 1 is done** — the legacy consolidation decisions (one task runner, deprecate `panda-task`'s internal logger, wire `@panda/colors` into `@panda/trace`) are made and written up as ADRs in `panda-opencode/DECISIONS.md`. **Phase 2 is fully done — all 5 packages retrofitted.** `@panda/colors`, `@panda/trace`, `@panda/logger`, `@panda/task`, and `@panda/scaffold` are all wired into the kernel entity contract and proven with real, working demos. Both internal legacy refactors from Phase 1's ADRs are done too (trace→colors, task→trace), and `@panda/factory` is recovered. Every single retrofit surfaced at least one genuine, concrete finding — not just "it worked": a widened `PandaStyler` contract, two real `@panda/trace` runtime-behavior discoveries, a resolved `@panda/factory` gap, and — the biggest — `@panda/scaffold`'s retrofit surfaced a stale dependency pin resolving the wrong npm package entirely, a real API rename, and two independent pre-existing bugs in Scaffold's own source that had nothing to do with the retrofit. All documented in `DECISIONS.md`. **Phase 3 is now fully complete — both deliverables done.** `panda:express` (long-running host + contributions, real HTTP request verified) and `panda:mongodb` (stateful resource + `uses`, real insert/query verified against a real, disposable database) — see `DECISIONS.md`, 2026-09-30 entries. **`$computed` (Phase 5) is done** — resolved lazily inside the consuming entity's own `run()`, required a new `PandaContext.instances` field the design doc hadn't anticipated (the worked example needs no `uses` alongside `$computed`, so `ctx.refs` alone wasn't enough). **Phase 6 is done — `@panda/paws` is a real, working CLI**, built directly on the real `@panda/command` (`paws validate`/`paws run --entity`), with an honest, working `--register` escape hatch for the still-real Phase 4 gap (no dynamic npm resolution yet). Surfaced a genuine, previously-unknown bug in the already-published `@panda/command` itself (options after a second positional argument silently dropped) — worked around in `paws`, not fixed at the source; see `panda-opencode/DECISIONS.md`. **`@panda/scaffold`'s internal `Factory` is reconciled with the recovered `@panda/factory`** — the last open item from the Phase 2 Scaffold retrofit; confirmed the same lineage, deleted the internal duplicate, translated the one real API difference (`force`/`skipIfExists` → `ifExists` policy) faithfully, verified via a full rebuild and a clean demo re-run. Ranked options for what's next:

1. **Fix the real `@panda/command` positional-argument bug found while building `paws`** — a genuine, scoped defect in an already-published library, deliberately not fixed in passing while building something else.
2. **Prove Express's Part 4 gap**: contributing a route into a `panda:express` instance that lives inside an imported `panda:module`, not just a local one — designed to already work via the generalized dotted-reference grammar, but not yet exercised by any demo.
3. **Phase 4** (real npm package resolution for `panda:module`) — now the most consequential remaining gap, since `paws` is real and directly blocked by it for anything beyond kernel's own built-in stubs.
4. **Phase 7** (polished example projects) — every phase it depends on (3, 5, 6) is now done.

None of these are urgent in a way that overrides checking in with what actually feels right to pick up next — this list is here so a future session (or a future you) doesn't have to re-derive the options from scratch.
