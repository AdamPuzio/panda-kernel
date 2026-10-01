/**
 * @panda/kernel — one-hop entity reference resolution (draft, see
 * examples/at-scale/module-nesting-at-depth.md)
 *
 * Every place a manifest names another entity — `uses`, `contributesTo` —
 * accepts either a bare local key ("logger") or exactly one hop into a
 * module's exports ("auth.login"). Multi-hop paths reaching through
 * several modules' internals at once ("a.b.c") are deliberately not
 * supported — see module-nesting-at-depth.md for why: long chains are
 * meant to be built by each layer explicitly re-exporting what it received
 * under its own name, not by consumers reaching arbitrarily deep.
 */

import type { PandaEntityInstance } from './types'

/** The manifest-local part of a reference — the only part that's a real
 *  topo-sort dependency (the export name isn't a top-level manifest key). */
export function baseEntityKey(ref: string): string {
  return ref.split('.')[0]
}

export function resolveEntityRef(
  ref: string,
  instances: Record<string, PandaEntityInstance>,
): PandaEntityInstance {
  const [base, exportName, ...rest] = ref.split('.')
  if (rest.length > 0) {
    throw new Error(
      `"${ref}" is a multi-hop reference — only one hop ("key" or "key.export") is supported`,
    )
  }

  const baseInstance = instances[base]
  if (!baseInstance) throw new Error(`references unknown entity "${base}"`)
  if (!exportName) return baseInstance

  const withExports = baseInstance as unknown as { getExport?: (name: string) => PandaEntityInstance }
  if (typeof withExports.getExport !== 'function') {
    throw new Error(`"${base}" does not support exports (no getExport method) — cannot resolve "${ref}"`)
  }
  return withExports.getExport(exportName)
}
