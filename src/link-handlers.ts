/**
 * @panda/kernel — built-in link handlers (draft, see ../HANDLERS.md)
 *
 * `uses` and `contributesTo` are the two relationship shapes the kernel
 * ships and registers by default (see PandaRegistry's constructor). Both
 * satisfy the exact same PandaLinkHandler contract a third party's own
 * handler would — no special-cased resolver logic, per HANDLERS.md.
 */

import type { PandaLinkHandler, PandaLinkParams } from './types'
import { baseEntityKey, resolveEntityRef } from './entity-ref'

export class UsesLinkHandler implements PandaLinkHandler {
  readonly keyword = 'uses'

  getDependencies(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]).map(baseEntityKey) : []
  }

  apply({ value, ctx, instances }: PandaLinkParams): void {
    for (const ref of (value as string[] | undefined) ?? []) {
      ctx.refs[ref] = resolveEntityRef(ref, instances)
    }
  }
}

/**
 * `contributesTo` is declared on the CONTRIBUTOR, not the host — see
 * HANDLERS.md and examples/at-scale/module-nesting-at-depth.md for why
 * this direction won out over the originally-sketched host-side
 * `contributes: { from: [...] }`. The host entity type opts in by
 * implementing a `registerContribution(entity)` method; nothing else is
 * required of it beyond that. The target can be a local key or a one-hop
 * module export (e.g. `"restApiStarter.app"`), same as `uses`.
 */
export class ContributesToLinkHandler implements PandaLinkHandler {
  readonly keyword = 'contributesTo'

  getDependencies(value: unknown): string[] {
    return typeof value === 'string' ? [baseEntityKey(value)] : []
  }

  apply({ value, instance, instances }: PandaLinkParams): void {
    const targetRef = value as string
    const target = resolveEntityRef(targetRef, instances) as unknown as {
      registerContribution?: (entity: unknown) => void
    }
    if (typeof target.registerContribution !== 'function') {
      throw new Error(
        `"${targetRef}" was contributed to but does not accept contributions ` +
          `(no registerContribution method)`,
      )
    }
    target.registerContribution(instance)
  }
}
