# Introduction

## What is Panda?

Panda is a system for building CLIs, scaffolds, and small apps out of independent, reusable pieces — called **entities** — wired together with a plain JSON file called a **manifest**, instead of hand-written glue code.

The pitch in one sentence: **describe what you want built, in JSON, and let Panda assemble it from packages that already know how to do their part.**

## The problem this solves

Normally, building a CLI tool or a project scaffold means writing code that imports several libraries (an arg parser, a logger, a task runner, a file-templating tool) and manually wires them together — instantiating each one, passing configuration by hand, and writing the glue that connects them. Every project re-does this wiring from scratch, and the wiring code isn't reusable even though the pieces underneath often are.

Panda's approach: package authors publish **entities** — self-describing building blocks (a command, a logger, a deploy pipeline, an entire pre-built subsystem like "auth") — each with a declared JSON schema for its configuration. An app author (or an AI agent) writes one manifest file declaring which entities they want and how they relate, and Panda's **kernel** resolves that manifest into a fully wired, running application.

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

No subclassing, no manual instantiation, no hand-written wiring code beyond the one or two real callbacks your app actually needs (registered by name, referenced from the manifest — see [Core Concepts](./concepts.md)).

## Who this is for

- **Developers** who want to assemble a CLI, scaffold, or small app from existing, well-tested building blocks instead of writing wiring code for the tenth time.
- **Package authors** who want to publish a reusable capability (a command, a task pipeline, a whole pre-configured subsystem) that other projects can drop in via a manifest, without those projects needing to understand its internals.
- **AI agents**, deliberately. A JSON manifest, validated against each entity's published JSON Schema, is something an agent can generate, validate, and reason about far more reliably than free-form glue code. This isn't an afterthought — it's a primary design goal (see [Status & Roadmap](./status.md) for what's needed to fully realize this, like a dry-run/validate mode).

## What Panda is not (yet, or possibly ever)

Being direct about scope, since overpromising here would undermine trust in the rest of the docs:

- It is **not** a general infrastructure-as-code tool (like Terraform) — there's no persistent state tracking across runs. Manifests describe how to construct and run a set of entities fresh each time; they don't track what was previously deployed.
- It is **not** a finished product yet. Most of what makes the vision compelling — plugin composition, whole-project reuse via `panda:module`, dry-run validation — is designed (see the docs linked from [Status & Roadmap](./status.md)) but not implemented.

Start with [Core Concepts](./concepts.md) next.
