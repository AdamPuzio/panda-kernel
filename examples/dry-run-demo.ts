/**
 * Proof-of-concept for #3 — dry-run / validate(). Demonstrates checking a
 * manifest for problems WITHOUT constructing or running anything: the
 * broken manifest below has four distinct, deliberately different kinds of
 * problems, and validate() reports all of them in one pass rather than
 * throwing on the first one (which is what resolve() still does today).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { PandaRegistry, validate, PandaLoggerEntity, createCommandEntity } from '../src/index'
import type { PandaManifest } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadManifest(file: string): PandaManifest {
  return JSON.parse(readFileSync(path.join(__dirname, file), 'utf-8'))
}

function main() {
  const registry = new PandaRegistry()
  registry.registerEntity(PandaLoggerEntity)
  registry.registerEntity(createCommandEntity(registry))
  registry.registerAction('deployAction', async () => ({ status: 'deployed' }), { namespace: 'myapp' })

  console.log('--- validating a valid manifest ---')
  const good = validate(loadManifest('manifest.json'), registry)
  console.log(good)

  console.log('\n--- validating a deliberately broken manifest ---')
  const bad = validate(loadManifest('invalid-manifest.json'), registry)
  console.log(`valid: ${bad.valid}`)
  for (const d of bad.diagnostics) {
    console.log(`  [${d.severity}]${d.entityKey ? ` (${d.entityKey})` : ''} ${d.message}`)
  }
}

main()
