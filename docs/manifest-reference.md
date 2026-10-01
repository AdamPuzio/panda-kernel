# Manifest Reference

The current, implemented shape of a manifest. (Designed additions — `panda:module`, `contributes`, `$computed`/`$input` — are documented in [Status & Roadmap](./status.md) and `../examples/at-scale/`, not here, since they don't work yet.)

## Top level

```json
{
  "panda": "1",
  "entities": { "...": "..." }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `panda` | string | Yes | Manifest format version. Only `"1"` is currently supported; `resolve()` throws on anything else. |
| `entities` | object | Yes | A flat map of your own names for each entity → its declaration (see below). |

## Entity declaration

```json
{
  "type": "panda:command",
  "uses": ["logger"],
  "config": { "command": "deploy", "action": "myapp:deployAction" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | Which registered entity type to instantiate (e.g. `"panda:command"`). Must match an entity registered via `registry.registerEntity(...)` before `resolve()` is called. |
| `uses` | string[] | No | Other entity keys (from this same manifest) that this entity depends on. Panda resolves dependencies before dependents, and makes each one available via `ctx.refs.<key>` at run time. Circular `uses` references are an error. |
| `config` | object | No | This entity's own configuration, passed to its constructor and (in a full implementation) validated against its `configSchema`. Must be plain JSON — no functions. References to other entities' behavior go through named actions (see [Core Concepts](./concepts.md#actions)), not through `config` directly. |

## Naming rules

- Entity keys (`logger`, `deploy` above) are your own choice — they only need to be unique within one manifest.
- `type` values and action names registered with a `namespace` become `"<namespace>:<name>"` — always use the full namespaced name when referencing them from a manifest (e.g. `"action": "myapp:deployAction"`, not `"action": "deployAction"`).

## A complete example

```json
{
  "panda": "1",
  "entities": {
    "logger": {
      "type": "panda:logger",
      "config": { "level": "info" }
    },
    "deploy": {
      "type": "panda:command",
      "uses": ["logger"],
      "config": {
        "command": "deploy",
        "description": "Deploy the app",
        "action": "myapp:deployAction"
      }
    }
  }
}
```
