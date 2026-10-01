# Worked Example: A Plugin Contributing a Subcommand Into a Host CLI

> **Superseded detail:** this doc sketches `contributes: { "from": [...] }` as a keyword on the *host* entity. Working through deeper module nesting (`module-nesting-at-depth.md`) settled on the opposite direction — `contributesTo` declared on the *contributor* instead, because the host may live several module layers away with no local entry to attach a host-side keyword to. The scenario and reasoning below still hold; mentally substitute `contributesTo` on `statusCommand`/`statusPlugin`'s exported command, pointing at `"cli"`, wherever `contributes.from` appears. See `HANDLERS.md` for the current, correct shape.

Stress-testing the `PandaLinkHandler` contract from `../HANDLERS.md` against a concrete case: a third-party package that adds a subcommand to somebody else's CLI, rather than being consumed as a dependency via inputs/exports.

**Status: design walkthrough, not implemented.** Same discipline as the module/exports exercise — write the concrete case out fully before touching kernel code, because writing it out is what surfaces the gaps.

## The scenario

`@yourorg/panda-plugin-status` is a small package that adds a `status` subcommand to whatever CLI it's dropped into. It doesn't know, and shouldn't need to know, the entity key name the consumer gave their CLI (`cli`, `myApp`, whatever) — that's the same encapsulation requirement `exports` solved for the auth-module case.

## Step 1 — the plugin ships a manifest using `exports`, not a new mechanism

```json
{
  "panda": "1",
  "entities": {
    "statusCommand": {
      "type": "panda:command",
      "config": { "command": "status", "action": "statusPlugin:statusAction" }
    }
  },
  "exports": {
    "command": "statusCommand"
  }
}
```

This is the important discovery from working through this: **the plugin side doesn't need a new "contributes" concept at all.** It's just a module that exports one command, identical in shape to the auth-module example. The plugin author writes this exactly like any other reusable module — they don't need to think about "contribution" as a special case.

## Step 2 — the *consumer* decides to wire that export into their CLI as a contribution

This is where the actual new mechanism lives — on the host side, not the plugin side:

```json
{
  "panda": "1",
  "entities": {
    "statusPlugin": {
      "type": "panda:module",
      "config": { "source": "@yourorg/panda-plugin-status" }
    },
    "build": { "type": "panda:command", "config": { "command": "build", "action": "myapp:buildAction" } },
    "cli": {
      "type": "panda:cli",
      "uses": ["build"],
      "contributes": { "from": ["statusPlugin.command"] },
      "config": { "name": "myapp" }
    }
  }
}
```

`cli` still `uses` its own directly-owned commands normally. `contributes` is new: it says "also attach whatever `statusPlugin` exports under the name `command`." This preserves encapsulation in both directions — the plugin never names the host, and the host never reaches into the plugin's internals, only its declared `exports`.

## Step 3 — what this requires of the entity types and handlers involved

**`panda:module` needs to expose its resolved exports, not just run().** Today's stub only has `run(ctx)`. A module instance needs a way for other handlers to pull a specific exported instance out by name:

```typescript
class PandaModuleEntity implements PandaEntityInstance {
  static readonly type = 'panda:module'
  private exportedInstances: Record<string, PandaEntityInstance> = {}

  async run(ctx: PandaContext) { /* resolves the nested manifest, populates exportedInstances */ }

  /** Used by link handlers (e.g. `contributes`) to pull a named export. */
  getExport(name: string): PandaEntityInstance {
    const instance = this.exportedInstances[name]
    if (!instance) throw new Error(`Module does not export "${name}"`)
    return instance
  }
}
```

**Host entity types must opt in to accepting contributions.** `panda:cli` (and later `panda:scaffold`) implement an additional method beyond the base contract:

```typescript
class PandaCliEntity implements PandaEntityInstance {
  static readonly type = 'panda:cli'
  private commands: PandaEntityInstance[] = []

  constructor(private config: { name: string }) {}

  /** Opt-in extension point — not every entity type needs this. */
  registerContribution(entity: PandaEntityInstance): void {
    this.commands.push(entity)
  }

  async run(ctx: PandaContext) { /* dispatch to whichever registered command matches argv */ }
}
```

This confirms something worth stating plainly: **"supports contribution" is a capability an entity type opts into, not something every entity gets.** A `panda:logger` has no meaningful notion of "being contributed to." That's fine — `registerContribution` is duck-typed/optional, checked at wiring time, not part of the base `PandaEntityInstance` contract.

**The `contributes` handler itself:**

```typescript
class ContributesLinkHandler implements PandaLinkHandler {
  readonly keyword = 'contributes'

  getDependencies(value: unknown): string[] {
    const { from } = value as { from: string[] }
    return from.map((ref) => ref.split('.')[0]) // dependency is the module key, e.g. "statusPlugin"
  }

  async apply({ value, instance, instances }: PandaLinkParams) {
    const { from } = value as { from: string[] }
    for (const ref of from) {
      const [sourceKey, exportName] = ref.split('.')
      const source = instances[sourceKey]
      const contribution = 'getExport' in (source as any)
        ? (source as any).getExport(exportName)
        : source
      if (typeof (instance as any).registerContribution !== 'function') {
        throw new Error(`"${sourceKey}" was contributed but the target entity doesn't accept contributions`)
      }
      ;(instance as any).registerContribution(contribution)
    }
  }
}
```

## Step 4 — this surfaced a real gap in the `PandaLinkHandler` contract itself

Writing `getDependencies()` above wasn't originally part of the contract in `HANDLERS.md` — it had to be added. Reason: topological sort in the resolver currently only looks at `uses` to decide instantiation order. But `contributes: { "from": ["statusPlugin.command"] }` is *also* a dependency — `statusPlugin` must be resolved before `cli`'s contribution wiring runs, exactly like a `uses` dependency would be. If topo-sort only reads `uses`, the resolver could try to wire `cli`'s contribution before `statusPlugin` exists.

**This means `getDependencies(value): string[]` needs to be added to the `PandaLinkHandler` interface in `HANDLERS.md`**, and the resolver's topo-sort needs to consult *every registered handler*, not just the built-in `uses` handler, when building the dependency graph. `uses`'s own `getDependencies` is just `(value) => value` (the array is already the dependency list). This is exactly the kind of thing the "work through one concrete example first" step was for — it wouldn't have been obvious from the abstract contract alone.

## What this confirms about the plugin/contribution model overall

- Plugins that want to extend a host don't need a different publishing mechanism than modules that want to be depended on — same manifest, same `exports`. The difference is entirely in how the *consumer* wires them in (`uses` vs. `contributes`), which is the right place for that decision to live, since only the consumer knows what kind of relationship makes sense.
- Whether an entity type accepts contributions is opt-in per entity type (`registerContribution` present or not), not a base-contract requirement — keeps the core `PandaEntityInstance` interface small.
- The `PandaLinkHandler` contract needed one real addition (`getDependencies`) that wasn't visible until this example was written out — confirms the value of doing these walkthroughs before implementing, rather than assuming the first draft of the contract was complete.
