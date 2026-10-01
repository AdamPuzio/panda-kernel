/**
 * @panda/kernel — entities/command.ts
 *
 * Minimal stub of `panda:command`, deliberately NOT the full @panda/command
 * (no arg parsing, no subcommands, no prompts). Just enough surface to prove
 * that a manifest can declare a command, wire it to a dependency (`uses`),
 * and resolve its `action` as a named reference instead of an embedded
 * function — the core rule from SPEC.md.
 */

import type { JSONSchema, PandaContext, PandaEntityInstance } from '../types'
import type { PandaRegistry } from '../registry'

export interface CommandConfig {
  command: string
  description?: string
  /** Named reference to a registered action — NOT a function, per the
   *  "config must be real JSON" rule. */
  action: string
}

export function createCommandEntity(registry: PandaRegistry) {
  return class PandaCommandEntity implements PandaEntityInstance {
    static readonly type = 'panda:command'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['command', 'action'],
      properties: {
        command: { type: 'string' },
        description: { type: 'string' },
        // `pandaActionRef` is a vendor extension keyword any entity author
        // can add to a string property — validate()/dry-run uses it to
        // confirm the referenced action is actually registered, without
        // needing to hardcode knowledge of panda:command's shape.
        action: { type: 'string', pandaActionRef: true },
      },
    }

    config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
    }

    /** Lets a host entity (e.g. panda:cli) that this command was
     *  contributed to or `uses`d by introspect its name without needing to
     *  know panda:command's internal config shape. */
    getCommandName(): string {
      return (this.config as unknown as CommandConfig).command
    }

    async run(ctx: PandaContext): Promise<unknown> {
      const config = this.config as unknown as CommandConfig
      const action = registry.resolveAction(config.action)
      return action({ command: config.command }, ctx)
    }
  }
}
