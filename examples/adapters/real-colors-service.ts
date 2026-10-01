/**
 * @panda/kernel — examples/adapters/real-colors-service.ts
 *
 * Registers the real, unmodified `@panda/colors` library as the ambient
 * `style` service (`ctx.services.style`), replacing the kernel's no-op
 * default. First package in Phase 2 (see panda-opencode/roadmap.md) —
 * smallest, lowest-risk retrofit, since colors has zero runtime deps and
 * no config/entity concept of its own to bridge, just a rendering
 * function to expose.
 *
 * Imported from the library's built `dist/` output, same as the command
 * adapter — matches how a real consumer would depend on it, and avoids
 * type-checking legacy source under the kernel's own strict tsconfig.
 *
 * Real @panda/colors is a Proxy-based, chainable API (`Colors.bold()
 * .underline().cyan('text')`) — richer than the kernel's ambient
 * `PandaStyler` contract (`(text, styles?) => string`, deliberately kept
 * generic/backend-agnostic — see DECISIONS.md for why it was widened from
 * a plain `(text) => string` to carry a styles argument at all, without
 * coupling kernel core to @panda/colors' specific naming). This adapter
 * exposes exactly the piece of the real API that fits that contract
 * (`Colors.render(str, styles)`) — the full chainable/proxy API is a known,
 * deliberate limitation of what's reachable through the ambient service;
 * anyone needing the richer API would import @panda/colors directly.
 */

import Colors from '../../../../legacy/panda-colors/dist/index.mjs'
import type { PandaRegistry } from '../../src/registry'

export function registerRealColorsService(registry: PandaRegistry): void {
  registry.registerService('style', () => (text: string, styles?: string | string[]) =>
    Colors.render(text, styles ?? []),
  )
}
