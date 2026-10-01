/**
 * @panda/kernel — entities/cli.ts
 *
 * `panda:cli` is the first real host entity type: it accepts other command
 * entities either as declared dependencies (`uses`) or as contributions
 * (`contributesTo`, from a plugin package that doesn't know this CLI's
 * manifest key ahead of time) — proving the design in
 * examples/at-scale/plugin-contribution.md actually works in code, not
 * just on paper.
 */

import type { JSONSchema, PandaContext, PandaEntityInstance } from '../types'

interface ContributableCommand {
  getCommandName(): string
  run(ctx: PandaContext): Promise<unknown>
}

export class PandaCliEntity implements PandaEntityInstance {
  static readonly type = 'panda:cli'

  static readonly configSchema: JSONSchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  }

  private commands: ContributableCommand[] = []

  constructor(private config: Record<string, unknown>) {}

  /** Opt-in extension point (duck-typed, per HANDLERS.md) — anything with
   *  getCommandName()/run() can be contributed, whether it arrived via
   *  `uses` (and was manually registered below in run()) or via
   *  `contributesTo` (registered here directly by the link handler). */
  registerContribution(entity: ContributableCommand): void {
    this.commands.push(entity)
  }

  async run(ctx: PandaContext): Promise<unknown> {
    // Commands declared via `uses` are available on ctx.refs but aren't
    // automatically contributed — panda:cli treats "uses" as "commands I
    // own directly" and registers them the same way a contribution would,
    // so both paths converge on one list.
    for (const ref of Object.values(ctx.refs)) {
      const maybeCommand = ref as unknown as Partial<ContributableCommand>
      if (typeof maybeCommand.getCommandName === 'function' && !this.commands.includes(ref as any)) {
        this.registerContribution(ref as unknown as ContributableCommand)
      }
    }

    const names = this.commands.map((c) => c.getCommandName())
    ctx.services.log.info(
      `${this.config.name}: ${this.commands.length} command(s) registered: ${names.join(', ')}`,
    )

    return { commands: names }
  }
}
