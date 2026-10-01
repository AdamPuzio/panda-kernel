/**
 * Proof-of-concept for the real-scaffold entity — real Handlebars-templated
 * file generation (via Scaffold's own internal Factory), real CLI option
 * parsing (inherited from the real @panda/command it extends), and the
 * `custom` action type bridged through a registered named action.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { PandaRegistry, resolve } from '../../src/index'
import type { PandaManifest } from '../../src/types'
import { createRealScaffoldEntity } from './real-scaffold-entity'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Note: Scaffold resolves target as path.join(targetBase, target) — Node's
// path.join does NOT respect a leading "/" in later arguments the way
// path.resolve does, so an absolute `target` alone would land nested
// inside targetBase unexpectedly. Setting targetBase explicitly and using
// a plain relative filename for target is the correct, intended usage.
const outputFile = path.join('/tmp', 'panda-scaffold-demo-output.txt')

async function main() {
  if (existsSync(outputFile)) rmSync(outputFile)

  const registry = new PandaRegistry()
  registry.registerEntity(createRealScaffoldEntity(registry))

  registry.registerAction(
    'afterGenerate',
    async (payload, ctx) => {
      ctx.services.log?.info?.('custom action ran after real file generation')
      console.log('custom action payload data:', (payload as { data: unknown }).data)
    },
    { namespace: 'myapp' },
  )

  const manifest: PandaManifest = {
    panda: '1',
    entities: {
      generator: {
        type: 'panda:scaffold',
        config: {
          name: 'greet-scaffold',
          command: 'greet-scaffold',
          scaffoldDir: __dirname,
          options: [{ name: 'name', alias: 'n', type: 'String' }],
          actions: [
            { type: 'add', source: 'fixtures/template.txt.hbs', target: 'panda-scaffold-demo-output.txt', targetBase: '/tmp' },
            { type: 'custom', run: 'myapp:afterGenerate' },
          ],
          argv: ['--name', 'World'],
        },
      },
    },
  }

  const instances = await resolve(manifest, registry)
  await instances.generator.run(undefined as never)

  console.log('Generated file contents:', readFileSync(outputFile, 'utf8').trim())
  rmSync(outputFile)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
