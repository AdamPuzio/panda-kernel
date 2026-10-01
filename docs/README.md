# @panda/kernel Documentation

**Status: Alpha / Design Preview.** This documents what exists and works today, clearly separated from what's designed but not yet built. Nothing here should be read as a stable, versioned API — it will change. That's a deliberate choice, not an oversight: writing this down now is meant to clarify the design and give early users/collaborators an accurate picture, not to freeze it prematurely.

## Read in this order

1. [**Introduction**](./introduction.md) — what Panda is, the problem it solves, who it's for.
2. [**Core Concepts**](./concepts.md) — the vocabulary: entities, manifests, the registry, services, refs.
3. [**Getting Started**](./getting-started.md) — a hands-on tutorial building the same 2-entity example that exists in `examples/demo.ts`, from scratch.
4. [**Manifest Reference**](./manifest-reference.md) — the JSON shape of a manifest, field by field.
5. [**Validating a Manifest (Dry Run)**](./validating-manifests.md) — checking a manifest for problems without running anything.
6. [**Reusing a Whole Manifest as a Module**](./modules.md) — `panda:module`, `exports`, `inputs`, and one-hop references.
7. [**Writing an Entity**](./writing-an-entity.md) — how to implement a new entity type.
8. [**Status & Roadmap**](./status.md) — an honest list of what's implemented vs. designed-but-not-built, so nobody mistakes a design doc for a shipped feature.

## For maintainers

This is user-facing documentation — write for someone who has never seen the internal design discussion. Internal design rationale, alternatives considered, and open questions live in `../SPEC.md`, `../HANDLERS.md`, and `../examples/at-scale/` — link to them for "why," but don't duplicate them here.
