/**
 * @panda/kernel — validate() / dry-run (draft, see ../SPEC.md, docs/status.md #3)
 *
 * Checks a manifest for problems WITHOUT constructing or running anything —
 * no entity is ever instantiated here, so this is guaranteed side-effect
 * free regardless of what any individual entity's constructor might do.
 * This is the fast, safe feedback loop an AI agent (or a human) needs while
 * iterating on a manifest, distinct from resolve() which actually builds
 * and runs the thing.
 */

import Ajv from 'ajv'

import type { PandaManifest } from './types'
import type { PandaRegistry } from './registry'
import { getEntityDependencies, topoSort } from './dependency-graph'

export interface PandaDiagnostic {
  /** Which entity key this problem belongs to, if it's specific to one. */
  entityKey?: string
  message: string
  severity: 'error' | 'warning'
}

export interface PandaValidationResult {
  valid: boolean
  diagnostics: PandaDiagnostic[]
}

// `strict: false` because entity authors are allowed to add custom
// vendor keywords to their configSchema (e.g. `pandaActionRef`, below) —
// ajv would otherwise reject the schema itself as invalid.
const ajv = new Ajv({ strict: false, allErrors: true })

/**
 * Recursively finds config values whose schema property was marked
 * `{ "pandaActionRef": true }`, so validate() can confirm the referenced
 * action is actually registered — without needing to hardcode knowledge of
 * any specific entity type's config shape (e.g. panda:command's `action`
 * field). Any entity author can opt into this check by adding the marker
 * to their own configSchema.
 */
function findActionRefs(
  schema: unknown,
  config: unknown,
  basePath = '',
): Array<{ path: string; value: string }> {
  const found: Array<{ path: string; value: string }> = []
  const s = schema as { type?: string; properties?: Record<string, any> } | undefined
  if (!s || s.type !== 'object' || !s.properties || typeof config !== 'object' || config === null) {
    return found
  }

  for (const [key, propSchema] of Object.entries(s.properties)) {
    const path = basePath ? `${basePath}.${key}` : key
    const value = (config as Record<string, unknown>)[key]

    if (propSchema?.pandaActionRef && typeof value === 'string') {
      found.push({ path, value })
    } else if (propSchema?.type === 'object' && typeof value === 'object' && value !== null) {
      found.push(...findActionRefs(propSchema, value, path))
    }
  }

  return found
}

export function validate(manifest: PandaManifest, registry: PandaRegistry): PandaValidationResult {
  const diagnostics: PandaDiagnostic[] = []

  if (manifest.panda !== '1') {
    diagnostics.push({ message: `Unsupported manifest version "${manifest.panda}"`, severity: 'error' })
    return { valid: false, diagnostics }
  }

  // Every non-core keyword must correspond to a registered link handler
  // (checked before dependency collection, since an unrecognized keyword
  // has no getDependencies() to call).
  for (const [key, entry] of Object.entries(manifest.entities)) {
    for (const keyword of Object.keys(entry)) {
      if (keyword === 'type' || keyword === 'config') continue
      if (!registry.tryResolveLinkHandler(keyword)) {
        diagnostics.push({
          entityKey: key,
          message: `Unknown manifest keyword "${keyword}" (no link handler registered for it)`,
          severity: 'error',
        })
      }
    }
  }

  // Every dependency declared by any link handler (uses, contributesTo, or
  // any third-party one) must point at a real entity key — checked before
  // the cycle check, so an unknown-reference error is reported clearly
  // rather than surfacing only as a generic cycle-detection failure.
  let hasUnknownReference = false
  for (const [key, entry] of Object.entries(manifest.entities)) {
    for (const dep of getEntityDependencies(entry, registry)) {
      if (!manifest.entities[dep]) {
        hasUnknownReference = true
        diagnostics.push({
          entityKey: key,
          message: `references unknown entity "${dep}"`,
          severity: 'error',
        })
      }
    }
  }

  // Skip cycle detection if there's already an unknown reference — topoSort
  // would just rediscover the same problem with a less specific message.
  if (!hasUnknownReference) {
    try {
      topoSort(manifest, registry)
    } catch (err) {
      diagnostics.push({ message: (err as Error).message, severity: 'error' })
    }
  }

  // Every type must be registered, config must satisfy its configSchema,
  // and any config field marked as an action reference must resolve.
  for (const [key, entry] of Object.entries(manifest.entities)) {
    const EntityClass = registry.tryResolveEntity(entry.type)
    if (!EntityClass) {
      diagnostics.push({ entityKey: key, message: `Unknown entity type "${entry.type}"`, severity: 'error' })
      continue
    }

    const config = entry.config ?? {}
    const validateConfig = ajv.compile(EntityClass.configSchema)
    if (!validateConfig(config)) {
      for (const err of validateConfig.errors ?? []) {
        diagnostics.push({
          entityKey: key,
          message: `config${err.instancePath} ${err.message}`,
          severity: 'error',
        })
      }
    }

    for (const ref of findActionRefs(EntityClass.configSchema, config)) {
      if (!registry.hasAction(ref.value)) {
        diagnostics.push({
          entityKey: key,
          message: `config.${ref.path} references unknown action "${ref.value}"`,
          severity: 'error',
        })
      }
    }
  }

  return { valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics }
}
