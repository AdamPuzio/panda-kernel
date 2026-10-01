/**
 * @panda/kernel — examples/adapters/real-task-entity.ts
 *
 * `panda:task` wraps the REAL @panda/task library — actual listr2
 * execution, actual rendering — not a simplified stand-in.
 *
 * UPDATE (recovered @panda/factory): this now imports from the package's
 * built `dist` output, same as every other adapter — no longer a
 * deliberate deviation. The `@panda/factory` gap that previously blocked
 * this (its own barrel eagerly re-exports the built-in `file:create`/
 * `npm:install`/etc. task types, which import `@panda/factory` — a
 * package that didn't exist anywhere resolvable in this workspace) is
 * resolved: a real, complete implementation was recovered from the
 * `_delete` archaeology folder into `legacy/panda-factory`, wired into the
 * npm workspace, and `panda-task`'s dependency reference was corrected
 * from a dangling `file:../@panda/factory` path to a normal workspace
 * dependency. See DECISIONS.md for the full account, including a
 * standalone verification that the real `file:create` built-in task type
 * now works end-to-end (writes an actual file via Factory's real
 * Handlebars-templated `writeFile()`).
 *
 * This adapter still proves real listr2 execution runs through the
 * entity contract by defining task STEPS as tiny Task subclasses whose
 * actual work delegates through the same named-action bridge used by the
 * command adapter — not by using @panda/task's own built-in task types,
 * which remain a separate, not-yet-exercised path through this specific
 * entity (the file:create proof above was a standalone check, not wired
 * into this adapter's config shape) — worth doing as a follow-up, not
 * bundled into this fix.
 */

import { Task } from '../../../../legacy/panda-task/dist/index.mjs'
import type { JSONSchema, PandaContext, PandaEntityInstance } from '../../src/types'
import type { PandaRegistry } from '../../src/registry'

export interface TaskStepConfig {
  title: string
  action: string
}

export interface RealTaskConfig {
  name?: string
  steps: TaskStepConfig[]
}

export function createRealTaskEntity(registry: PandaRegistry) {
  return class PandaRealTaskEntity implements PandaEntityInstance {
    static readonly type = 'panda:task'

    static readonly configSchema: JSONSchema = {
      type: 'object',
      required: ['steps'],
      properties: {
        name: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'action'],
            properties: {
              title: { type: 'string' },
              action: { type: 'string', pandaActionRef: true },
            },
          },
        },
      },
    }

    config: Record<string, unknown>

    constructor(config: Record<string, unknown>) {
      this.config = config
    }

    async run(ctx: PandaContext): Promise<unknown> {
      const { steps } = this.config as unknown as RealTaskConfig

      // Each step becomes its own tiny Task subclass — real listr2 gets a
      // real task list to render/execute, but the actual work each step
      // does is resolved via the registry, same bridge as panda:command's
      // `action` field, not @panda/task's own built-in task types.
      const stepClasses = steps.map((step) => {
        return class extends Task {
          static readonly type = `panda:task:step:${step.title}`
          name = step.title
          async run(): Promise<unknown> {
            const action = registry.resolveAction(step.action)
            return action({ step: step.title }, ctx)
          }
        }
      })

      const rootTask = new Task({ tasks: stepClasses as never })
      return rootTask.run({})
    }
  }
}
