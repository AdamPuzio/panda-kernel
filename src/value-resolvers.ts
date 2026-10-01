/**
 * @panda/kernel — value resolver mechanism (draft, see ../HANDLERS.md,
 * ../examples/at-scale/computed-values.md)
 *
 * Recursively walks a config value tree looking for marker objects (a
 * plain object with EXACTLY one key matching a registered resolver's
 * `marker`), and replaces each one with that resolver's output. This is
 * how `panda:module` substitutes `{ "$input": "greeting" }` inside a
 * nested manifest's entity configs before resolving it.
 */

import type { PandaRegistry } from './registry'
import type { PandaValueResolver, PandaValueResolverContext } from './types'
import { baseEntityKey, resolveEntityRef } from './entity-ref'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Async because `$computed` (below) has to `await` a source entity's
 *  `provideValue()` — `$input` doesn't need to be async, but one shared
 *  recursive walk serving every registered resolver has to accommodate
 *  whichever ones do. */
export async function resolveConfigValues(
  value: unknown,
  registry: PandaRegistry,
  ctx: PandaValueResolverContext,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveConfigValues(item, registry, ctx)))
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1) {
      const resolver = registry.tryResolveValueResolver(keys[0])
      if (resolver) return resolver.resolve(value[keys[0]], ctx)
    }
    const resolved: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = await resolveConfigValues(val, registry, ctx)
    }
    return resolved
  }

  return value
}

/** Ships as one of the two built-in value resolvers — see PandaRegistry's
 *  constructor. Any other marker (`$env`, `$secret`, ...) is registered
 *  the same way, with no special status. */
export class InputValueResolver implements PandaValueResolver {
  readonly marker = '$input'

  resolve(value: unknown, ctx: PandaValueResolverContext): unknown {
    const name = value as string
    if (!(name in ctx.inputs)) {
      throw new Error(`"$input" references undeclared input "${name}"`)
    }
    return ctx.inputs[name]
  }
}

export interface ComputedValueSpec {
  from: string
  output: string
}

/** `{ "$computed": { "from": "devServer", "output": "port" } }` — a config
 *  value resolved from another entity's RUNTIME OUTPUT, not a static
 *  input. See examples/at-scale/computed-values.md for the full design
 *  walkthrough (Discoveries 1-4) this implements:
 *   - A value resolver, not a link handler (Discovery 1) — operates
 *     inside `config`, wherever a `$computed` marker appears.
 *   - Never implicitly triggers `run()` (Discovery 3) — calls the source
 *     entity's opt-in `provideValue()` instead; an entity that doesn't
 *     implement it fails clearly, immediately, rather than silently
 *     executing something unintended.
 *   - `getDependencies()` (below) feeds dependency-graph.ts's config-tree
 *     scan (Discovery 4), so the source entity is at least CONSTRUCTED
 *     before this one — whether it's actually been RUN by the time the
 *     value is read is the caller's responsibility (the same finding
 *     `panda:mongodb`'s `uses` relationship surfaced — see kernel
 *     DECISIONS.md), not something this resolver can enforce.
 *   - Caching policy (Discovery 4's "left open" list) is deliberately the
 *     source entity's own `provideValue()` implementation's business, not
 *     this resolver's — a devServer's port should be stable per-process;
 *     something like "current git SHA" might legitimately be re-read each
 *     time, and only the entity itself knows which. */
export class ComputedValueResolver implements PandaValueResolver {
  readonly marker = '$computed'

  getDependencies(value: unknown): string[] {
    const spec = value as ComputedValueSpec
    return spec?.from ? [baseEntityKey(spec.from)] : []
  }

  async resolve(value: unknown, ctx: PandaValueResolverContext): Promise<unknown> {
    const { from, output } = value as ComputedValueSpec
    if (!ctx.instances) {
      throw new Error(`"$computed" reference to "${from}.${output}" resolved with no instances available`)
    }
    const source = resolveEntityRef(from, ctx.instances) as unknown as {
      provideValue?: (output: string) => Promise<unknown>
    }
    if (typeof source.provideValue !== 'function') {
      throw new Error(`"${from}" does not support computed values (no provideValue method)`)
    }
    return source.provideValue(output)
  }
}
