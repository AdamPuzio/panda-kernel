/**
 * @panda/kernel — entities/logger.ts
 *
 * Minimal stub entity, NOT a replacement for the real @panda/logger.
 * Exists only so the proof-of-concept manifest has something for
 * `panda:command` to `uses`. Real @panda/logger gets retrofitted to this
 * same contract later — see SPEC.md "next step".
 */

import type { JSONSchema, PandaContext, PandaEntityInstance } from '../types'

export interface LoggerConfig {
  level?: 'info' | 'debug' | 'error'
}

export class PandaLoggerEntity implements PandaEntityInstance {
  static readonly type = 'panda:logger'

  static readonly configSchema: JSONSchema = {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['info', 'debug', 'error'] },
    },
  }

  constructor(private config: LoggerConfig) {}

  async run(_ctx: PandaContext): Promise<unknown> {
    // A logger entity doesn't "run" so much as exist to be depended on —
    // other entities call methods on it via ctx.refs. For this proof, it
    // just confirms it was constructed correctly.
    return { level: this.config.level ?? 'info' }
  }
}
