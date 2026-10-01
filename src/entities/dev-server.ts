/**
 * @panda/kernel — entities/dev-server.ts
 *
 * A minimal, illustrative entity proving `$computed` end to end — see
 * examples/at-scale/computed-values.md for the full design and
 * DECISIONS.md for the build notes. Deliberately a stub (like
 * entities/command.ts and entities/logger.ts), not a real library
 * wrapper — this is proving a KERNEL MECHANISM, not retrofitting external
 * code, so it belongs alongside the other kernel-owned proof entities
 * rather than in examples/adapters/.
 *
 * Picks a "random" port from a configured range when it runs, and exposes
 * that port via the opt-in `provideValue()` capability (NOT via `run()`'s
 * return value alone) — so another entity's config can reference it with
 * `{ "$computed": { "from": "devServer", "output": "port" } }`.
 */

import type { JSONSchema, PandaContext, PandaEntityInstance } from '../types'

export interface DevServerConfig {
  portRange: [number, number]
}

export class PandaDevServerEntity implements PandaEntityInstance {
  static readonly type = 'panda:dev-server'

  static readonly configSchema: JSONSchema = {
    type: 'object',
    required: ['portRange'],
    properties: {
      portRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    },
  }

  config: DevServerConfig
  port?: number

  constructor(config: Record<string, unknown>) {
    this.config = config as unknown as DevServerConfig
  }

  async run(ctx: PandaContext): Promise<unknown> {
    const [min, max] = this.config.portRange
    this.port = min + Math.floor(Math.random() * (max - min + 1))
    ctx.services.log.info(`panda:dev-server picked port ${this.port}`)
    return { port: this.port }
  }

  /** Deliberately does NOT trigger run() if it hasn't happened yet — per
   *  computed-values.md Discovery 3 (Option B), "give me a value" and
   *  "execute my primary behavior" are two different, independently
   *  invokable things. A caller that asks for the port before this entity
   *  has run gets a clear, immediate error, not a silent implicit run(). */
  async provideValue(output: string): Promise<unknown> {
    if (output !== 'port') {
      throw new Error(`panda:dev-server does not provide a computed value named "${output}"`)
    }
    if (this.port === undefined) {
      throw new Error('panda:dev-server: provideValue("port") called before run(ctx) picked a port')
    }
    return this.port
  }
}
