# Reusing a Whole Manifest as a Module

Everything on this page is implemented and runnable — see `examples/demo-module.ts` for working code.

## Why

Sometimes you don't want to depend on one entity — you want to depend on an *entire pre-assembled project* someone else published (an auth flow, a deploy pipeline, a CMS setup) and treat it as a single building block. `panda:module` does this: it recursively resolves another manifest and exposes only the pieces that manifest chose to make public.

## Publishing a module

Any manifest can be consumed as a module by other manifests, as long as it declares an `exports` map:

```json
{
  "panda": "1",
  "inputs": {
    "greeting": { "type": "string", "default": "Welcome" }
  },
  "entities": {
    "loginCommand": {
      "type": "panda:command",
      "config": {
        "command": "login",
        "description": { "$input": "greeting" },
        "action": "auth:loginAction"
      }
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

- **`exports`** maps a public name to a local entity key. Only `login` is listed here — `internalDebugCommand` exists for this module's own use but is genuinely unreachable from outside; there's no way for a consumer to get at it, not just a convention asking them not to.
- **`inputs`** declares what this module accepts as parameters, with an optional `default` and/or `required: true`. If a required input has no default and nothing supplies it, resolving the module fails with a clear error before anything is constructed.
- **`{ "$input": "greeting" }`** — anywhere inside this manifest's own entity `config` blocks, this marker gets replaced with the actual resolved input value before the manifest is resolved. This is how a module's own entities read the parameters a consumer passed in.

## Consuming a module

```json
{
  "panda": "1",
  "entities": {
    "auth": {
      "type": "panda:module",
      "config": {
        "source": "@example/panda-auth",
        "inputs": { "greeting": "Hi there" }
      }
    },
    "cli": {
      "type": "panda:cli",
      "uses": ["auth.login"],
      "config": { "name": "myapp" }
    }
  }
}
```

- `auth.login` is a **one-hop dotted reference** — `auth` is the local module entity, `.login` is the export name declared in the module's own `exports` map. This works anywhere a plain entity key would (`uses`, `contributesTo`) — see `examples/at-scale/module-nesting-at-depth.md` for why references are deliberately limited to exactly one hop, even through much deeper module chains.
- If `config.inputs` is omitted entirely, every input falls back to its declared default (or fails if none exists and it's required).

## What this does NOT do yet

- **`source` isn't resolved from real npm packages.** It's currently matched against whatever manifests were pre-registered via `registry.registerModuleSource(name, manifest)` — a deliberate stand-in, not real package resolution. See [Status & Roadmap](./status.md).
- **`$computed`** (a value resolved from another entity's *runtime output*, rather than a static input) isn't implemented — it has a genuinely harder timing problem than `$input`, discussed in `examples/at-scale/computed-values.md`.
