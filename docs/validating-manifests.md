# Validating a Manifest (Dry Run)

`resolve()` builds and runs your entities. `validate()` checks a manifest for problems without constructing or running anything — no entity's constructor is ever called, so this is safe to run repeatedly while you (or an AI agent) are iterating on a manifest, regardless of what any individual entity might do when actually instantiated.

## Basic usage

```typescript
import { validate } from '@panda/kernel'

const result = validate(manifest, registry)

if (!result.valid) {
  for (const d of result.diagnostics) {
    console.log(`[${d.severity}]${d.entityKey ? ` (${d.entityKey})` : ''} ${d.message}`)
  }
}
```

`result` is:

```typescript
interface PandaValidationResult {
  valid: boolean
  diagnostics: Array<{
    entityKey?: string          // which entity this problem belongs to, if any
    message: string
    severity: 'error' | 'warning'
  }>
}
```

Unlike `resolve()`, which currently throws on the first problem it finds, `validate()` reports every problem it can find in one pass — useful for showing a complete list of issues rather than a fix-one-rerun-fix-the-next loop.

## What gets checked

- Every `uses` reference points at an entity key that actually exists in the manifest.
- There's no circular `uses` dependency.
- Every entity's `type` is registered in the registry you pass in.
- Every entity's `config` satisfies that entity type's declared `configSchema` (via [ajv](https://ajv.js.org/)).
- Any config field an entity type has opted into marking as an action reference (see below) points at an action that's actually registered.

## Marking a config field as an action reference

`validate()` doesn't hardcode knowledge of any specific entity type's shape — it can't know on its own that `panda:command`'s `action` field is supposed to name a registered action rather than just being an arbitrary string. Entity authors opt into this check with a small vendor extension in their `configSchema`:

```typescript
static readonly configSchema: JSONSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', pandaActionRef: true },
  },
}
```

Any string property marked `pandaActionRef: true` gets checked against `registry.hasAction(...)` during validation. This is opt-in — if your entity type doesn't reference actions by name, you don't need it.

## What's deliberately not checked yet

- `validate()` does not currently check anything beyond one entity's own `config` against its own schema — cross-entity checks beyond `uses`/action-reference resolution (e.g. "does this task's `steps` array make sense") are the entity author's own responsibility for now.
- There's no dry-run equivalent for the designed-but-unimplemented features (`panda:module`, `contributes`, `$computed`) — see [Status & Roadmap](./status.md).
