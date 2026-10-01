/**
 * @panda/kernel — examples/adapters/real-logger-service.ts
 *
 * Registers the real, unmodified `@panda/logger` library as the ambient
 * `log` service (`ctx.services.log`), replacing the kernel's no-op
 * default. Unlike command/colors/trace, this package has no build step
 * (plain CommonJS `logger.js`, no tsup/dist) — imported directly as-is.
 */

// @ts-expect-error no type declarations ship with this plain-CJS package
import PandaLogger from '../../../../legacy/panda-logger/logger.js'
import type { PandaRegistry } from '../../src/registry'
import type { PandaLogger as PandaLoggerContract } from '../../src/types'

export function registerRealLoggerService(registry: PandaRegistry, name = 'kernel-demo'): void {
  registry.registerService('log', (): PandaLoggerContract => {
    const instance = PandaLogger.getLogger(name)
    return {
      log: (msg: string) => instance.info(msg),
      info: (msg: string) => instance.info(msg),
      error: (msg: string) => instance.error(msg),
    }
  })
}
