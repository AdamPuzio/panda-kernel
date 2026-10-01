/**
 * @panda/kernel — shared dependency-graph logic (draft, see ../SPEC.md)
 *
 * Factored out of resolver.ts so both resolve() and validate() (dry-run,
 * see docs/validating-manifests.md) use the same dependency-ordering /
 * cycle-detection logic rather than two copies drifting apart.
 *
 * Generalized to collect dependencies from EVERY registered link handler
 * (not just `uses`) — this is the getDependencies() fix the
 * plugin-contribution walkthrough surfaced (examples/at-scale/
 * plugin-contribution.md, Step 4): `contributesTo` is also a dependency
 * (the target must exist before a contribution can be applied to it), and
 * without this generalization only `uses` participated in ordering.
 */

import type { PandaManifest, PandaManifestEntity } from './types'
import type { PandaRegistry } from './registry'

/** Every non-core keyword on an entity entry (anything but `type`/`config`)
 *  is a link-handler keyword — collect what each one declares as a
 *  dependency, PLUS anything a value resolver marker inside `config`
 *  declares (see examples/at-scale/computed-values.md Discovery 4 —
 *  `$computed` markers live inside `config`, not as a sibling keyword, so
 *  they need a second, separate collection pass over the config tree). */
export function getEntityDependencies(entry: PandaManifestEntity, registry: PandaRegistry): string[] {
  const deps: string[] = []
  for (const [keyword, value] of Object.entries(entry)) {
    if (keyword === 'type' || keyword === 'config') continue
    const handler = registry.tryResolveLinkHandler(keyword)
    if (handler) deps.push(...handler.getDependencies(value))
  }
  deps.push(...getConfigValueDependencies(entry.config, registry))
  return deps
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively scans a config value tree for value-resolver markers (a
 *  plain object with exactly one key matching a registered resolver) and
 *  collects whatever entity keys that resolver's own getDependencies()
 *  reports — mirrors resolveConfigValues' own tree walk in
 *  value-resolvers.ts, but for dependency COLLECTION rather than
 *  substitution, and doesn't need to run at the same time. */
function getConfigValueDependencies(value: unknown, registry: PandaRegistry): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => getConfigValueDependencies(item, registry))
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1) {
      const resolver = registry.tryResolveValueResolver(keys[0])
      if (resolver) return resolver.getDependencies?.(value[keys[0]]) ?? []
    }
    return Object.values(value).flatMap((val) => getConfigValueDependencies(val, registry))
  }
  return []
}

/** Topologically sorts entity keys so dependencies resolve first. Throws on
 *  an unknown reference or a circular dependency. */
export function topoSort(manifest: PandaManifest, registry: PandaRegistry): string[] {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const order: string[] = []

  function visit(key: string) {
    if (visited.has(key)) return
    if (visiting.has(key)) {
      throw new Error(`Circular dependency detected at "${key}"`)
    }
    const entry = manifest.entities[key]
    if (!entry) throw new Error(`Manifest references unknown entity "${key}"`)

    visiting.add(key)
    for (const dep of getEntityDependencies(entry, registry)) visit(dep)
    visiting.delete(key)

    visited.add(key)
    order.push(key)
  }

  for (const key of Object.keys(manifest.entities)) visit(key)
  return order
}
