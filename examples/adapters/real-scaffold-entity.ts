/**
 * @panda/kernel — examples/adapters/real-scaffold-entity.ts
 *
 * `panda:scaffold` wraps the REAL, unmodified `legacy/panda-scaffold`
 * library — actual Handlebars-templated file generation via its own
 * internal Factory, actual action-type dispatch — imported from its built
 * `dist/` output, same as command/colors/trace/logger.
 *
 * KNOWN, DISCOVERED INCONSISTENCY (flagged, not silently resolved):
 * `legacy/panda-scaffold`'s own package.json pins `@panda/command` at
 * `^0.1.4` (a devDependency, bundled at build time, same zero-runtime-dep
 * pattern as @panda/command itself) — this does NOT semver-match the
 * `0.2.1` sitting in this workspace's `legacy/panda-command`, so `npm ls`
 * confirms it actually resolves the real, OLDER `0.1.4` from the public
 * npm registry, not the local workspace package. This adapter uses
 * Scaffold's EXISTING pre-built `dist/` as-is (not rebuilt), sidestepping
 * the question of which Command version Scaffold should really bundle
 * against — that's a real decision worth making deliberately later (bump
 * Scaffold's devDependency range, then rebuild), not something to resolve
 * silently while retrofitting.
 *
 * Bridging note: Scaffold's `custom` action type (`ScaffoldActionCustom`)
 * expects a real `run` function embedded directly in its config — the
 * same category of problem as `panda:command`'s `action` field. Bridged
 * identically: a `custom` action's `run` field can be a registered action
 * name (string) instead of a function, resolved here before being handed
 * to the real Scaffold.
 *
 * A second real, discovered issue: Scaffold's shipped `dist/index.d.ts`
 * declares `class Scaffold extends Command`, but never resolves/inlines
 * `Command`'s own type — so inherited members like `.run()` don't
 * type-check even though they exist and work correctly at runtime (this
 * is exactly the kind of gap the "entity-type versioning" note in
 * docs/status.md anticipates). Worked around with a narrow, local cast
 * rather than editing the shipped declaration file.
 */

import { Scaffold } from '../../../../legacy/panda-scaffold/dist/index.mjs'
import type { JSONSchema, PandaContext, PandaEntityInstance } from '../../src/types'
import type { PandaRegistry } from '../../src/registry'

interface ScaffoldActionConfig {
  type: string
  source?: string
  target?: string
  run?: string
  [key: string]: unknown
}

export function createRealScaffoldEntity(registry: PandaRegistry) {
  return class PandaRealScaffoldEntity implements PandaEntityInstance {
    static readonly type = 'panda:scaffold'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        command: { type: 'string' },
        scaffoldDir: { type: 'string' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string' },
              source: { type: 'string' },
              target: { type: 'string' },
              // Only meaningful when type === 'custom' — a named action
              // reference, not an embedded function, per the "config must
              // be JSON" rule.
              run: { type: 'string', pandaActionRef: true },
            },
          },
        },
      },
    }

    scaffold: InstanceType<typeof Scaffold>
    currentCtx?: PandaContext
    config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
      const cfg: Record<string, unknown> = { ...config }
      const actions = (cfg.actions as ScaffoldActionConfig[] | undefined) ?? []

      cfg.actions = actions.map((action) => {
        if (action.type === 'custom' && typeof action.run === 'string') {
          const runActionName = action.run
          return {
            ...action,
            run: async (actionCfg: unknown, data: unknown, factory: unknown) => {
              if (!this.currentCtx) {
                throw new Error(
                  'Real @panda/scaffold adapter: custom action ran before run(ctx) established a context',
                )
              }
              const fn = registry.resolveAction(runActionName)
              return fn({ action: actionCfg, data, factory }, this.currentCtx)
            },
          }
        }
        return action
      })

      this.scaffold = new Scaffold(cfg as never)
    }

    async run(ctx: PandaContext): Promise<unknown> {
      this.currentCtx = ctx
      const argv = (Array.isArray((ctx.config as { argv?: unknown }).argv)
        ? (ctx.config as { argv?: string[] }).argv
        : []) as string[]
      return (this.scaffold as unknown as { run(argv: string[]): Promise<unknown> }).run(argv)
    }
  }
}
