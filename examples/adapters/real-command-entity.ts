/**
 * @panda/kernel — examples/adapters/real-command-entity.ts
 *
 * A `panda:command` entity that wraps the REAL, unmodified
 * `legacy/panda-command` library — imported from its BUILT `dist/` output
 * (exactly how a real consumer would `npm install @panda/command` and use
 * it), not the kernel's own minimal stub (src/entities/command.ts) and not
 * the library's raw TypeScript source. This is the "does the entity
 * contract survive contact with something that wasn't built for it" test.
 *
 * Deliberate placement: this file lives in @panda/kernel's examples, not
 * inside legacy/panda-command itself, and legacy/panda-command's source
 * is NOT modified anywhere. This is the operating principle Adam set:
 * the real library must stay fully usable standalone by a developer who
 * has never heard of Panda manifests — `new Command({...})` with real JS
 * functions works exactly as it always has (see the smoke test that
 * proved this before any adapter code was written). The adapter is
 * strictly additive — a bridge that lives alongside the library, not a
 * modification of it. If this pattern proves out, a natural follow-up
 * (a separate decision, not made here) would be whether adapter code like
 * this eventually ships as an optional secondary entry point of the
 * library's own package, or stays a fully separate companion package —
 * either way, the library itself never needs to import or know about
 * @panda/kernel.
 *
 * Known, deliberate limitations of this first pass (not fixed here):
 *  - Only `action` is bridged to a named/registered reference. The real
 *    library's `arguments[].validate`, `options[].validate`,
 *    `flags[].validate`, and `transform` all also accept raw functions in
 *    CommandProps and are passed through AS-IS if present in config —
 *    which means, if someone put a real function in one of those fields,
 *    it would violate the "config must be JSON" rule silently. This
 *    adapter does not yet enforce or bridge those — flagged, not solved.
 *  - The real library's action functions often rely on `this.out()` /
 *    `this.heading()` / `this.rainbow()` (styled console helpers bound to
 *    the Command instance) — bridged actions do NOT have access to `this`
 *    the way native usage does. Use `ctx.services.log`/`ctx.services.style`
 *    instead — this is precisely the problem ambient services were
 *    designed to solve in place of ad hoc per-library helper methods.
 *
 * A second, smaller bridging concern this surfaced: the real library
 * expects `type: String` — an actual JS constructor reference — on each
 * argument/option/flag definition (that's how `command-line-args`, which
 * it wraps, knows how to coerce parsed values). A manifest can't contain
 * `String` itself (only JSON), so this adapter maps the string literals
 * `"String"`/`"Number"`/`"Boolean"` to their real constructors before
 * constructing the real Command — the same shape of problem `action`
 * has, solved the same way: a JSON-safe marker resolved to the real thing
 * at construction time.
 */

import { Command } from '../../../../legacy/panda-command/dist/index.mjs'
import type { JSONSchema, PandaContext, PandaEntityInstance } from '../../src/types'
import type { PandaRegistry } from '../../src/registry'

const TYPE_MARKERS: Record<string, unknown> = { String, Number, Boolean }

function materializeParamTypes(params: unknown): unknown {
  if (!Array.isArray(params)) return params
  return params.map((param) => {
    if (param && typeof param === 'object' && typeof (param as { type?: unknown }).type === 'string') {
      const marker = (param as { type: string }).type
      if (marker in TYPE_MARKERS) return { ...param, type: TYPE_MARKERS[marker] }
    }
    return param
  })
}

export function createRealCommandEntity(registry: PandaRegistry) {
  return class PandaRealCommandEntity implements PandaEntityInstance {
    // Same manifest-facing type name as the kernel's own stub
    // (src/entities/command.ts) — an app registers ONE or the other, never
    // both; this is meant to supersede the stub for real use, not coexist
    // with it.
    static readonly type = 'panda:command'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        command: { type: 'string' },
        description: { type: 'string' },
        // Passed through to the real library's own arguments/options/flags
        // shape as-is — already plain data in ordinary use (a `validate`
        // function embedded in one of these is the known limitation noted
        // above, not handled here).
        arguments: {},
        options: {},
        flags: {},
        action: { type: 'string', pandaActionRef: true },
      },
    }

    command: InstanceType<typeof Command>
    currentCtx?: PandaContext
    config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
      const cfg: Record<string, unknown> = { ...config }
      const actionName = cfg.action

      // Only materialize fields the manifest actually declared — naively
      // assigning `cfg.arguments = materializeParamTypes(cfg.arguments)`
      // unconditionally would ADD an `arguments: undefined` key even when
      // the manifest never mentioned it, which then overwrites the real
      // library's own class-field default (`= []`) during its
      // `Object.entries(cfg).forEach(...)`-based initialize() — a real,
      // concrete bug this adapter hit on the first run, not a hypothetical
      // one. Same care needed for `options`/`flags`.
      if (cfg.arguments !== undefined) cfg.arguments = materializeParamTypes(cfg.arguments)
      if (cfg.options !== undefined) cfg.options = materializeParamTypes(cfg.options)
      if (cfg.flags !== undefined) cfg.flags = materializeParamTypes(cfg.flags)

      if (typeof actionName === 'string') {
        cfg.action = async (data: unknown, details: unknown) => {
          if (!this.currentCtx) {
            throw new Error(
              'Real @panda/command adapter: action invoked before run(ctx) established a context',
            )
          }
          const action = registry.resolveAction(actionName)
          return action({ data, details }, this.currentCtx)
        }
      }

      this.command = new Command(cfg as never)
    }

    async run(ctx: PandaContext): Promise<unknown> {
      this.currentCtx = ctx
      // Always an explicit array (never undefined) — the real library
      // falls back to raw `process.argv` if argv is omitted, which would
      // pick up whatever args the HOST process (e.g. tsx itself) was
      // launched with, not what a manifest-driven caller intends. A
      // manifest-driven run supplies its own simulated argv via
      // ctx.config.argv (see the demo) rather than ever touching the real
      // process argv.
      const argv = (Array.isArray((ctx.config as { argv?: unknown }).argv)
        ? (ctx.config as { argv?: string[] }).argv
        : []) as string[]
      return this.command.run(argv)
    }
  }
}
