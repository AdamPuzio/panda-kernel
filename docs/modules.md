# Reusing a Whole Manifest as a Module

Everything on this page is implemented and runnable — see `examples/demo-module.ts` for working code.

## Why

Sometimes you don't want to depend on one entity — you want to depend on an *entire pre-assembled project* someone else published (an auth flow, a deploy pipeline, a CMS setup) and treat it as a single building block. `panda:module` does this: it recursively resolves another manifest and exposes only the pieces that manifest chose to make public.

## Publishing a module

Any manifest can be consumed as a module by other manifests, as long as it declares an `exports` map. To be consumable as a real, installed npm package (not just a test double — see below), the package's own `package.json` also declares where the manifest actually lives:

```json
{
  "name": "@example/panda-auth",
  "panda": { "manifest": "panda.manifest.json" }
}
```

`manifest` is a path relative to the package root, and defaults to `panda.manifest.json` if omitted entirely. This reuses the same `"panda"` package.json field found in `legacy/panda-scaffold`'s own package.json (`"panda": { "module": "scaffold" }`) as a namespace for Panda-specific package metadata.

The manifest file itself (`panda.manifest.json` in this example) looks like any other manifest:

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

## What this does

- **`source` resolves against a real installed npm package** — Node's own module resolution finds it, reads its `package.json`'s `panda.manifest` field (or the default path), and parses that file. See `src/npm-resolution.ts` and `examples/demo-npm-module-resolution.ts` for a real, working example that installs and resolves an actual workspace package (`@panda/example-auth-module`), not a stand-in.
- **`registry.registerModuleSource(name, manifest)` still works**, as an explicit test-double mechanism for sources that aren't (or aren't yet) real installed packages — real resolution is tried first and only falls through to this when it finds nothing. `examples/demo-module.ts` still uses this path.

## What this does NOT do yet

- **`$computed`** (a value resolved from another entity's *runtime output*, rather than a static input) IS implemented — see `examples/computed-demo.ts` and `DECISIONS.md` — just not exercised by anything on this page.
