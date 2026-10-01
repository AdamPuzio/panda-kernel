/**
 * @panda/kernel — src/npm-resolution.ts
 *
 * Phase 4: real `panda:module` package resolution — replaces the
 * previous registry.registerModuleSource()/resolveModuleSource()
 * in-memory stand-in with actually reading an installed npm package's
 * manifest off disk.
 *
 * Convention established here, since none existed before (see
 * docs/modules.md's "What this does NOT do yet" section, now out of
 * date): a package that wants to be consumable as a `panda:module`
 * declares a `"panda"` field in its own `package.json`:
 *
 *   { "name": "@example/panda-auth", "panda": { "manifest": "panda.manifest.json" } }
 *
 * `manifest` is a path relative to the package root. This mirrors the
 * marker already found in `legacy/panda-scaffold`'s own package.json
 * during the original ecosystem archaeology (`"panda": { "module":
 * "scaffold" }`) — reusing the same "panda" package.json field as a
 * namespace for Panda-specific package metadata, rather than inventing
 * an unrelated new convention.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { PandaManifest } from './types'

export interface NpmModulePackageJson {
  panda?: { manifest?: string }
}

/**
 * Resolves `source` as a real npm package name using Node's own module
 * resolution, starting from `fromDir` (the consuming app's own
 * directory — defaults to `process.cwd()`, matching the convention
 * `@panda/paws` already established for resolving manifest/register
 * file paths). Reads that package's `package.json`, finds its declared
 * `panda.manifest` path (defaulting to `panda.manifest.json` at the
 * package root if not declared), and parses that file as a
 * `PandaManifest`.
 *
 * Returns `undefined` (not throws) if `source` doesn't resolve to an
 * installed package at all — this lets `panda:module`'s configure()
 * cleanly fall through to the pre-registered in-memory stand-in
 * (registry.resolveModuleSource) for cases that aren't real installed
 * packages (tests, demos, anything not yet published), rather than
 * forcing every caller to catch an exception for what's often a
 * perfectly normal, deliberate case.
 */
export function resolveNpmModuleSource(source: string, fromDir: string = process.cwd()): PandaManifest | undefined {
  const require = createRequire(join(fromDir, 'noop.js'))

  let packageJsonPath: string
  try {
    packageJsonPath = require.resolve(`${source}/package.json`)
  } catch {
    return undefined
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as NpmModulePackageJson
  const manifestRelativePath = packageJson.panda?.manifest ?? 'panda.manifest.json'
  const manifestPath = join(dirname(packageJsonPath), manifestRelativePath)

  let manifestContents: string
  try {
    manifestContents = readFileSync(manifestPath, 'utf-8')
  } catch {
    throw new Error(
      `"${source}" was resolved as a real npm package, but its manifest ` +
        `("${manifestRelativePath}", per its package.json "panda.manifest" ` +
        `field or the default) doesn't exist at ${manifestPath}`,
    )
  }

  return JSON.parse(manifestContents) as PandaManifest
}
