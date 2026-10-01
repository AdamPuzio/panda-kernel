/**
 * @panda/kernel — entities/module.ts
 *
 * `panda:module` lets an entire published manifest be reused as a single
 * entity inside a bigger one — see examples/at-scale/panda-auth.manifest
 * .json / consumer.manifest.json and module-nesting-at-depth.md for the
 * design. This proves it for real: recursive resolve(), a manifest's own
 * `exports` map, one-hop dotted references (entity-ref.ts), and now
 * `inputs`/parameterization via the `$input` value resolver.
 *
 * NOT implemented here: real npm package resolution (`source` is resolved
 * against registry.registerModuleSource(), an explicit stand-in — see
 * registry.ts). `$computed` is implemented (see value-resolvers.ts,
 * ComputedValueResolver) but not exercised by anything in THIS file — its
 * resolution timing is lazy/caller-driven (a dependent entity resolves it
 * inside its own run(), once its dependency has actually run), unlike
 * `$input`, which this file resolves eagerly during configure() since it
 * never depends on anything having run first.
 */

import type { JSONSchema, PandaContext, PandaEntityInstance, PandaManifestEntity } from '../types'
import type { PandaRegistry } from '../registry'
import { resolve } from '../resolver'
import { resolveConfigValues } from '../value-resolvers'

export interface ModuleConfig {
  source: string
  inputs?: Record<string, unknown>
}

export function createModuleEntity(registry: PandaRegistry) {
  return class PandaModuleEntity implements PandaEntityInstance {
    static readonly type = 'panda:module'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['source'],
      properties: {
        source: { type: 'string' },
        inputs: { type: 'object' },
      },
    }

    exportedInstances: Record<string, PandaEntityInstance> = {}
    config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
    }

    /** Eagerly resolves the nested manifest here (not in run()) — see the
     *  configure() doc comment on PandaEntityInstance for why: dependents
     *  need getExport() available during THIS resolve() pass, before
     *  anyone's run() is ever called. */
    async configure(_ctx: PandaContext): Promise<void> {
      const { source, inputs: suppliedInputs } = this.config as unknown as ModuleConfig
      const nestedManifest = registry.resolveModuleSource(source)

      const resolvedInputs = this.resolveInputs(source, nestedManifest.inputs, suppliedInputs)

      // Materialize a copy of the nested manifest with every `{ "$input":
      // "x" }` marker in its entity configs substituted for a real value,
      // BEFORE recursively resolving it — resolve() itself has no idea
      // inputs exist; by the time it sees this manifest, it's just data.
      const materializedEntities: Record<string, PandaManifestEntity> = {}
      for (const [key, entry] of Object.entries(nestedManifest.entities)) {
        materializedEntities[key] = {
          ...entry,
          config: (await resolveConfigValues(entry.config ?? {}, registry, {
            inputs: resolvedInputs,
          })) as Record<string, unknown>,
        }
      }

      const nestedInstances = await resolve(
        { ...nestedManifest, entities: materializedEntities },
        registry,
      )

      for (const [exportName, localKey] of Object.entries(nestedManifest.exports ?? {})) {
        const instance = nestedInstances[localKey]
        if (!instance) {
          throw new Error(
            `Module "${source}" declares export "${exportName}" -> "${localKey}", ` +
              `but "${localKey}" isn't one of its entities`,
          )
        }
        this.exportedInstances[exportName] = instance
      }
    }

    /** Merges the module's declared input schema (defaults, required-ness)
     *  with whatever the consumer actually supplied, failing clearly if a
     *  required input with no default was never provided. */
    resolveInputs(
      source: string,
      schema: import('../types').PandaManifest['inputs'],
      supplied: Record<string, unknown> | undefined,
    ): Record<string, unknown> {
      const resolved: Record<string, unknown> = { ...supplied }
      for (const [name, inputSchema] of Object.entries(schema ?? {})) {
        if (resolved[name] !== undefined) continue
        if (inputSchema.default !== undefined) {
          resolved[name] = inputSchema.default
        } else if (inputSchema.required) {
          throw new Error(`Module "${source}" requires input "${name}", but none was supplied`)
        }
      }
      return resolved
    }

    /** The one-hop reference mechanism (entity-ref.ts) calls this on
     *  whatever a `uses`/`contributesTo` reference resolves to when it
     *  crosses a module boundary. */
    getExport(name: string): PandaEntityInstance {
      const instance = this.exportedInstances[name]
      if (!instance) throw new Error(`Module does not export "${name}"`)
      return instance
    }

    async run(): Promise<unknown> {
      return { exports: Object.keys(this.exportedInstances) }
    }
  }
}
