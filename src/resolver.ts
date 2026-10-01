/**
 * @panda/kernel — resolver (draft, see ../SPEC.md)
 *
 * Turns a JSON manifest into a fully wired set of running entity instances.
 * This is the piece that never existed in the old ecosystem (CommandCenter
 * was reaching for this and was never built) — it is the entire "bind
 * everything via JSON" promise made real.
 */

import type { PandaContext, PandaEntityInstance, PandaManifest, PandaServices } from './types'
import { PandaRegistry } from './registry'
import { topoSort } from './dependency-graph'

export interface ResolveOptions {
  /** Override any subset of ambient services for this resolve() call —
   *  rarely needed directly; prefer registry.registerService() so the
   *  override is visible to anything introspecting the registry too. */
  services?: Partial<PandaServices>
}


export async function resolve(
  manifest: PandaManifest,
  registry: PandaRegistry,
  options: ResolveOptions = {},
): Promise<Record<string, PandaEntityInstance>> {
  if (manifest.panda !== '1') {
    throw new Error(`Unsupported manifest version "${manifest.panda}"`)
  }

  // Ambient services are process-wide for this resolve() call — built once,
  // shared by reference across every entity's context, not per-entity.
  const services: PandaServices = { ...registry.buildServices(), ...options.services }

  const order = topoSort(manifest, registry)
  const instances: Record<string, PandaEntityInstance> = {}

  for (const key of order) {
    const entry = manifest.entities[key]
    const EntityClass = registry.resolveEntity(entry.type)

    const config = entry.config ?? {}
    const instance = new EntityClass(config)
    instances[key] = instance

    // ctx starts with empty refs — link handlers (uses, contributesTo, and
    // any third-party ones) populate ctx and/or reach into other already-
    // resolved instances below, all through the same uniform mechanism.
    // See HANDLERS.md — nothing here is special-cased per keyword.
    // `instances` is the full manifest-wide instance map, not scoped by
    // `uses` — see PandaContext's doc comment on why `$computed` needs
    // this distinct from `refs`.
    const ctx: PandaContext = { services, refs: {}, config, instances }

    // Optional eager async setup (see PandaEntityInstance.configure in
    // types.ts) — MUST run before this entity's own link handlers are
    // applied, since a dependent's `uses`/`contributesTo` may need this
    // entity's getExport() (or similar) to already be populated, and
    // dependents are wired during this same pass, not at run() time.
    if (instance.configure) await instance.configure(ctx)

    for (const [keyword, value] of Object.entries(entry)) {
      if (keyword === 'type' || keyword === 'config') continue
      const handler = registry.resolveLinkHandler(keyword)
      await handler.apply({ value, key, instance, ctx, instances, registry })
    }

    // Stash the context alongside the instance so `run()` can be called
    // later with everything it needs, without the caller having to pass
    // it. We attach it via a WeakMap-free closure by wrapping `run` —
    // simplest thing that works for the proof.
    const originalRun = instance.run.bind(instance)
    instance.run = () => originalRun(ctx)
  }

  return instances
}

export { PandaRegistry }

