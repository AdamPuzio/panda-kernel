/**
 * @panda/kernel — examples/adapters/real-trace-service.ts
 *
 * Registers the real, unmodified `@panda/trace` library as the ambient
 * `trace` service (`ctx.services.trace`), replacing the kernel's no-op
 * default.
 *
 * NOTE: per panda-opencode/DECISIONS.md, @panda/trace is *supposed* to get
 * refactored to depend on @panda/colors internally (replacing its own
 * hand-rolled ANSI color code) as part of Phase 2. That refactor means
 * editing legacy/panda-trace's own source — different from wrapping it
 * unmodified, the way this adapter and the colors/command ones do. That's
 * a deliberate, separate step, not done here — this adapter wraps
 * @panda/trace exactly as it exists in legacy/ today (still with its own
 * internal color code, not yet using @panda/colors).
 */

import { Trace } from '../../../../legacy/panda-trace/dist/index.mjs'
import type { PandaRegistry } from '../../src/registry'
import type { PandaTracer } from '../../src/types'

export function registerRealTraceService(registry: PandaRegistry): void {
  registry.registerService('trace', (): PandaTracer => ({
    trace: (msg: string, tags?: string[]) => Trace.trace(msg, tags ?? [], undefined),
  }))
}
