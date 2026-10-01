# Manifests at Scale — Design Exploration

Working notes exploring two questions Adam raised, before any of this gets built: (1) what does a manifest look like once it's not just 2 toy entities, and (2) can a whole project, expressed as a manifest, become a single reusable block inside a bigger project's manifest.

**Status: exploratory, not implemented, not yet a spec commitment.** Nothing here should be treated as locked in — the point is to find the cracks before writing code, per the working-pattern discipline. Where something looks like it should become a real SPEC.md addition, it's marked "→ promote to spec."

---

## 1. A larger single-app manifest

Scaling up from the 2-entity proof: a CLI with three commands, a shared task pipeline, a logger, and a styled-output dependency. This is still "one project," just bigger.

```json
{
  "panda": "1",
  "entities": {
    "logger": {
      "type": "panda:logger",
      "config": { "level": "info", "format": "cli" }
    },
    "style": {
      "type": "panda:colors",
      "config": { "theme": { "success": ["green", "bold"], "error": ["red", "bold"] } }
    },
    "buildTask": {
      "type": "panda:task",
      "uses": ["logger"],
      "config": {
        "steps": [
          { "type": "npm:install" },
          { "type": "command", "run": "tsc --build" }
        ]
      }
    },
    "deployTask": {
      "type": "panda:task",
      "uses": ["logger", "style"],
      "config": {
        "steps": [
          { "type": "file:copy", "source": "dist", "target": "deploy/dist" },
          { "type": "command", "run": "rsync -av deploy/ remote:/app" }
        ]
      }
    },
    "build": {
      "type": "panda:command",
      "uses": ["buildTask", "logger"],
      "config": { "command": "build", "action": "myapp:runTask", "task": "buildTask" }
    },
    "deploy": {
      "type": "panda:command",
      "uses": ["deployTask", "logger", "style"],
      "config": {
        "command": "deploy",
        "options": [{ "name": "env", "type": "string", "default": "staging" }],
        "action": "myapp:runTask",
        "task": "deployTask"
      }
    },
    "cli": {
      "type": "panda:cli",
      "uses": ["build", "deploy"],
      "config": { "name": "myapp", "version": "1.0.0" }
    }
  }
}
```

Observations from writing this out:

- **It's already reading like Docker Compose / Kubernetes / Terraform, and that's a good sign** — this is a well-trodden shape for "declare a system as a graph of named, typed, wired resources." That's reassuring evidence the pattern generalizes, not a red flag.
- **A new entity type shows up naturally: `panda:cli`** — something that aggregates multiple `panda:command` entities into one runnable binary, exactly the `CommandCenter` concept from the old docs' roadmap. Confirms that idea was right, it just needed the manifest/kernel underneath it to make sense.
- **`uses` fans out fast.** `deploy` alone depends on 3 things. At real scale (dozens of commands), a flat `uses` list per entity gets noisy. Worth watching whether this needs grouping/namespacing sugar later (e.g., a `defaults.uses` applied to every entity in a folder) — **not solving this now**, just flagging it as a thing that will want attention once a real manifest this size actually gets written.
- **Config passthrough between task and command is awkward as drafted** (`"task": "buildTask"` inside `config` pointing at another manifest key, separately from `uses`). This is a real seam: **should a reference to another entity ever live inside plain `config`, or should every cross-entity reference be forced through `uses` + `ctx.refs`, with nothing but real data allowed in `config`?** I'd lean toward the latter — it's more consistent with "config is real, inert JSON" from SPEC.md. → **promote to spec**: config may contain named references to `registerAction`-style callbacks, but never bare references to other manifest entity keys; any entity-to-entity link must go through `uses`.

---

## 2. The harder question: a whole project as a building block of another project

This is the more interesting design problem, and it's the one that actually delivers on your original vision ("bind everything via JSON... add in as dependencies"). The scenario: someone publishes an `@yourorg/panda-auth` package whose entire implementation is a manifest (login command, token-refresh task, a logger it configures for itself) — and a *different* project wants to drop that whole thing in as one dependency, the same way you'd `npm install` a library, without reaching inside it.

### The core problem this creates

A manifest today is a closed, flat namespace — every key lives in one `entities` map. To let one manifest become a single node inside a bigger one, you need:

1. A way to **reference an entire external manifest as if it were one entity type** in the parent.
2. A way for the inner manifest to **declare a public surface** (which of its internal entities/capabilities the outside world is allowed to depend on) — otherwise every consumer has to know the inner manifest's private key names, which breaks encapsulation the moment the inner project refactors itself.
3. A way to **parameterize** the inner manifest from the outside (the equivalent of constructor arguments / Terraform module `variables`) without the parent needing to edit the inner manifest's file.

### Proposed shape (exploratory)

**The inner project (`@yourorg/panda-auth`) ships its own manifest, and adds an `exports` block:**

```json
{
  "panda": "1",
  "inputs": {
    "tokenSecret": { "type": "string", "required": true },
    "tokenTtl": { "type": "string", "default": "1h" }
  },
  "entities": {
    "logger": { "type": "panda:logger", "config": { "level": "info" } },
    "tokenTask": {
      "type": "panda:task",
      "config": { "secret": "${inputs.tokenSecret}", "ttl": "${inputs.tokenTtl}" }
    },
    "loginCommand": {
      "type": "panda:command",
      "uses": ["tokenTask", "logger"],
      "config": { "command": "login", "action": "auth:loginAction" }
    },
    "internalDebugCommand": {
      "type": "panda:command",
      "config": { "command": "auth:debug", "action": "auth:debugAction" }
    }
  },
  "exports": {
    "login": "loginCommand"
  }
}
```

Note `internalDebugCommand` is deliberately **not** exported — it exists for the package's own use/tests but is invisible to consumers. That's the encapsulation piece: `exports` is the package's public API, same idea as `package.json`'s `exports` field or a module's named exports, just applied to entities instead of JS symbols.

`inputs` + `${inputs.x}` interpolation is the parameterization piece — the equivalent of a constructor argument, resolved once at the moment the parent instantiates this module, not baked into the published package.

**The parent project consumes it via a new entity type, `panda:module`:**

```json
{
  "panda": "1",
  "entities": {
    "auth": {
      "type": "panda:module",
      "config": {
        "source": "@yourorg/panda-auth",
        "inputs": { "tokenSecret": "${env.TOKEN_SECRET}" }
      }
    },
    "cli": {
      "type": "panda:cli",
      "uses": ["auth"],
      "config": { "name": "myapp" }
    }
  }
}
```

Inside the kernel, resolving a `panda:module` entity means: load the named package, run `resolve()` on *its* manifest recursively with its own scoped registry, then expose only the keys listed in its `exports` block back into the parent's `ctx.refs.auth.*` — e.g. `ctx.refs.auth.login` maps to the inner `loginCommand` instance. Nothing outside `exports` is reachable from the parent, by construction, not by convention.

### What this actually requires in the kernel (not built yet — this is the design, the next real milestone)

- `resolve()` needs to become **recursive**: a `panda:module` entity's "instantiation" is itself a nested call to `resolve()` against a separate manifest + its own registry scope (so a `logger` key inside `panda-auth` never collides with a `logger` key in the parent).
- An **interpolation mechanism** for `${inputs.x}` / `${env.x}` — small, but new; nothing in the current proof-of-concept does string interpolation into config values.
- A rule for **what happens to the inner module's own `ctx`** (its logger/tracer/styler) — does it inherit the parent's, or does it get its own, or is that itself configurable? My instinct: it should inherit by default (so a consumer sees one consistent log stream, not two separately-configured loggers), but that's exactly the kind of decision worth writing down as an ADR once you actually build it, not deciding in the abstract now.
- **Versioning.** `"source": "@yourorg/panda-auth"` needs a version somewhere (either `"source": "@yourorg/panda-auth@^2.0"` or resolved via whatever's in `node_modules`, i.e. treat it exactly like an npm dependency). Given these are genuinely meant to be `npm install`ed, piggy-backing on npm's existing version resolution is almost certainly the right call rather than inventing a second version-resolution system.

### Why this matters for the "I want AI to want to use this" goal specifically

This nested-module pattern is what makes the library actually different from "just use Terraform/Compose/Helm" — because the building blocks aren't infrastructure resources, they're **whole opinionated project types** (an auth module, a scaffold, a deploy pipeline) that another manifest — or an AI agent — can drop in by name, parameterize with a few inputs, and get a working, pre-wired subsystem without having to understand or regenerate its internals. That's a materially different value proposition than "here's a component library," which is worth naming clearly once you get to writing the pitch: **Panda modules are pre-assembled, parameterized subsystems, not primitive components.**

---

## Open questions worth sitting with (not deciding yet)

1. Should `exports` be required on every manifest, or optional (with "everything is exported" as the default for simple, non-shared projects)? Leaning toward: required once a manifest is published as a package, optional for app-local manifests that will never be consumed by anyone else.
2. Should a `panda:module` be allowed to depend on (`uses`) entities from its *parent's* scope — i.e., can the auth module ask the parent to hand it a logger the parent already configured, rather than always building/receiving its own? This is the difference between "inputs" (data in) and "shared context" (capabilities in) — Terraform modules only really have the former; you may want both.
3. At what point does a manifest this nested stop being something a human writes by hand and become something only generated/edited by tooling (including AI)? If the answer is "pretty quickly," that's not a problem — it may actually be the point — but it changes what the authoring experience needs to be (a JSON Schema-validated, autocomplete-friendly format matters far more than a human-ergonomic one).

---

## 3. Is inputs/exports the only interface shape? No — at least four are needed

Pushing on whether inputs/exports (the Terraform-module pattern above) is sufficient for every composition scenario surfaces real gaps. Static in / static out covers the common case, but at least three other relationship shapes are needed once real usage shows up:

**a. Static inputs/exports (above).** "Parameterize a subsystem, get back a fixed set of capabilities." Resolved once, at compose time. Stays the default, simplest case.

**b. Ambient shared context.** Already present in the kernel proof without being named as its own category: `ctx.log` / `ctx.trace` / `ctx.style` deliberately bypass inputs/exports entirely — every entity just receives them. This is the right call for things every entity needs without explicit wiring (threading a logger through every module's declared `inputs` would be absurd). Worth naming explicitly as a **second, intentional channel** — ambient services via context — rather than treating inputs/exports as the only mechanism and leaving context as an unexplained special case.

**c. Contribution / extension points — probably the most important gap for Panda specifically.** Inputs/exports models "I depend on you, give me your outputs." It does not model "I want to *extend* you" — e.g. a plugin package that adds new subcommands to an existing CLI, or new action types to an existing Scaffold. That's not consuming an export, it's injecting capability into a host the plugin doesn't own. This is core to the original "add packages as deps and they wire themselves in" vision, but it's structurally different from parameter-passing: the host needs to declare an extension point, and a module registers *into* it rather than being wired as a dependency. (Closer to how VS Code or Webpack plugin systems work than to Terraform, which doesn't really have this concept either.)

**d. Static vs. computed/lazy inputs.** As drafted, `${inputs.tokenSecret}` resolves once, at compose time, from a static value or env var. But some real inputs are naturally **the runtime output of another entity** — "use whatever port the dev server actually picked," "use the current run's git SHA" — not knowable until something else has actually executed. That's a different resolution timing than a static input, and conflating the two is a known sharp edge in Terraform itself (worked around with `depends_on` + computed attributes). Worth distinguishing **static inputs** (data, resolved once) from **computed inputs** (a reference to another entity's runtime result, resolved lazily when actually needed).

**e. (Named so it can be deliberately rejected, not designed) Override/patch composition.** Helm's `values.yaml`-reaches-into-subchart-internals pattern is a widely-criticized anti-pattern precisely because it breaks encapsulation the moment the subchart's internals change. Given `exports` exists specifically to prevent that kind of reach-through, the intended answer to "the module doesn't expose the knob I need" should be "ask the module to add another declared input," never "add an override mechanism that pokes past `exports`." Worth writing down now, before convenience pressure argues for adding it later.

Also worth flagging: repetition (N copies of a module with different inputs, à la Terraform's `for_each`/`count`) and conditional inclusion (only wire this entity in production) are real gaps too, but they read as structural sugar on top of the shapes above rather than a fifth fundamental relationship kind — worth deferring until a real manifest actually needs them.

See [`../HANDLERS.md`](../HANDLERS.md) for how the kernel should be architected so these (and future) relationship shapes are pluggable rather than hardcoded.

## Recommendation on what (if anything) to build next

None of this should be built yet. The 2-entity proof-of-concept answered "does JSON-in/app-out work at all" — yes. This document exists to answer "does the shape hold up under realistic pressure" before spending implementation time — and the honest answer is: mostly yes, with the module/exports/inputs mechanism being real, non-trivial new work (recursive resolve, scoping, interpolation) rather than a small addition. That's worth being deliberate about as its own milestone, not something to bolt onto the current kernel proof casually.
