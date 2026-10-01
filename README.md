# @panda/kernel

Panda's entity contract, registry, and manifest resolver — the binder that assembles `@panda/*` entities into a running app from a single JSON manifest.

**Picking this back up after a break? Read [`STATE.md`](./STATE.md) first** — a single "where things stand" summary of what's built and verified, what's designed but not built, and ranked options for what to do next. Everything else here is detail that summary points into.

**New here?** Start with [`docs/README.md`](./docs/README.md) — user-facing documentation (introduction, concepts, tutorial, reference), clearly marked Alpha/Design Preview. The rest of this README and the other top-level `.md` files (`SPEC.md`, `HANDLERS.md`, `DECISIONS.md`, `examples/at-scale/`) are internal design notes, not user documentation.

**Status: proof-of-concept passing, plus two scaling decisions implemented.** See [`SPEC.md`](./SPEC.md) for the draft contract and [`HANDLERS.md`](./HANDLERS.md) for the pluggable relationship/value-resolver design. A minimal manifest (`panda:command` `uses` `panda:logger`) resolves and runs successfully — see `examples/manifest.json` + `examples/demo.ts` (run with `npx tsx examples/demo.ts`).

**Implemented this session, following the top-level design review in `panda-opencode/`:**
- **Ambient services are a fourth registry (`registerService`), not a fixed `PandaContext` interface.** `log`/`trace`/`style` are guaranteed defaults (kernel ships no-op implementations, transparently overridable); anything else (metrics, secrets, whatever comes next) is a normal named registration, with TypeScript declaration merging (`declare module '@panda/kernel' { interface PandaServices {...} }`) providing compile-time ergonomics without ever requiring a kernel core change. `demo.ts` demonstrates overriding the default `log` service.
- **Namespaced registration.** `registerAction`/`registerEntity`/`registerService` all accept an optional `{ namespace }`, auto-prefixing as `"<namespace>:<name>"` — derived from the registering package's own name (npm's registry is already a global, centrally-allocated namespace; no new central registry needed). `demo.ts` registers `deployAction` under `namespace: 'myapp'`, producing `myapp:deployAction`.
- **`validate()` — dry-run / validate-only resolution.** Checks a manifest for problems (unregistered types, config schema violations via `ajv`, unresolved action references via an opt-in `pandaActionRef` schema marker, unknown/circular `uses` references) without constructing or running a single entity — see `examples/dry-run-demo.ts` and `docs/validating-manifests.md`.

**What's still a stub, on purpose:**
- `panda:command` here is a deliberate minimal stub (no arg parsing, subcommands, or prompts) — just enough to prove the wiring. The real `@panda/command` (in `legacy/panda-command`) still needs to be retrofitted to this contract.
- `panda:logger` here is a stub too — the real `@panda/logger` needs the same retrofit, including its own `declare module` augmentation once it exists as a real package.
- Link handlers (`uses`/`contributes`) and value resolvers (`$computed`/`$input`) are designed in `HANDLERS.md` and `examples/at-scale/` but not yet implemented in `src/` — `uses` is currently still hardcoded in the resolver rather than factored out as the first registered `PandaLinkHandler`.
- No dry-run/validate-only mode yet (next agenda item, per `panda-opencode/` discussion) — everything here fully constructs and can run.

**Do not pull in colors/trace/logger/task from `legacy/` yet.** Per `panda-opencode/working-pattern.md`, decide what changes each needs to conform to this contract one at a time, starting with whichever is needed for the next milestone.


