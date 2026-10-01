/**
 * @panda/kernel — entity contract (draft, see ../SPEC.md)
 */

import type { PandaRegistry } from './registry'

export type JSONSchema = Record<string, unknown>

/**
 * Ambient services available on every context, keyed by name. Kernel itself
 * only knows about an empty base shape — individual service packages (e.g.
 * @panda/logger) extend this via TypeScript declaration merging:
 *
 *   declare module '@panda/kernel' {
 *     interface PandaServices { log: PandaLoggerInstance }
 *   }
 *
 * This is the same pattern Fastify/Express-plugin ecosystems use to let
 * independently-published packages extend a shared context type without
 * ever touching the core package's source. Adding a new ambient capability
 * (metrics, secrets, whatever comes next) never requires a kernel change —
 * it's a registration (`registry.registerService`) plus an optional type
 * augmentation for compile-time ergonomics.
 *
 * Kernel guarantees exactly three defaults are always present (`log`,
 * `trace`, `style`) via built-in no-op registrations, so entity authors
 * don't need defensive checks for those three specifically. Anything else
 * registered here is opt-in with no guaranteed fallback.
 */
export interface PandaServices {
  log: PandaLogger
  trace: PandaTracer
  style: PandaStyler
}

export interface PandaLogger {
  log(msg: string): void
  info(msg: string): void
  error(msg: string): void
}

export interface PandaTracer {
  trace(msg: string, tags?: string[]): void
}

export interface PandaStyler {
  /** `styles` is optional and generic (a style name or list of names) —
   *  deliberately NOT typed against any specific styling library's naming
   *  scheme, so kernel core stays uncoupled from any one backend. See
   *  DECISIONS.md — this was widened from a plain `(text) => string` when
   *  retrofitting the real @panda/colors surfaced that the original shape
   *  couldn't carry any real styling capability at all. */
  (text: string, styles?: string | string[]): string
}

export type PandaServiceFactory<K extends keyof PandaServices = keyof PandaServices> =
  () => PandaServices[K]

/** Shared capabilities handed to every entity at run time. Entities receive
 *  these — they do not construct their own logger/tracer/styler. */
export interface PandaContext {
  services: PandaServices
  /** Other resolved entity instances, keyed by their manifest key. */
  refs: Record<string, PandaEntityInstance>
  /** This entity's own resolved config. */
  config: Record<string, unknown>
  /** EVERY entity instance resolved in this manifest, not just the ones
   *  this entity declared via `uses`/`contributesTo`. Added specifically
   *  so an entity's own run() can lazily resolve `$computed` markers in
   *  its config (via resolveConfigValues, see value-resolvers.ts) WITHOUT
   *  also having to declare `uses` for the same entity — the design's own
   *  worked example (examples/at-scale/computed-values.md) deliberately
   *  has no `uses` alongside `$computed`, relying only on the
   *  dependency-graph's config-tree scan (Discovery 4) for construction
   *  ordering. `refs` stays scoped to explicit link-handler declarations;
   *  this is the one exception where "which entities can I reach" isn't
   *  opt-in per relationship. */
  instances: Record<string, PandaEntityInstance>
}

export interface PandaEntityInstance {
  /** Optional async setup phase, called once right after construction and
   *  BEFORE any link handler (uses/contributesTo/...) is applied — either
   *  to this entity, or to anything that depends on it. Most entities
   *  don't need this. It exists for entities that must do eager async work
   *  at resolve time rather than at run() time — the concrete case that
   *  surfaced the need for it: `panda:module` must fully resolve its
   *  nested manifest here, so `getExport()` is already available to
   *  dependents before anyone's `run()` is ever called (dependents are
   *  wired during the SAME resolve() pass that instantiates them, well
   *  before run() happens for anything). Not part of the original design —
   *  added when implementing panda:module surfaced the gap; see
   *  DECISIONS.md. */
  configure?(ctx: PandaContext): Promise<void>
  run(ctx: PandaContext): Promise<unknown>
  /** Optional opt-in capability for entities whose runtime OUTPUT (not
   *  static config) other entities may want to reference via `$computed`
   *  (see value-resolvers.ts, ComputedValueResolver, and
   *  examples/at-scale/computed-values.md Discovery 3). Deliberately
   *  separate from `run()` — the kernel never triggers `run()` as a side
   *  effect of a config value being read; an entity that wants to expose
   *  computed values implements this, produces the value however it needs
   *  to internally (including running its own logic and caching the
   *  result), and entities that don't implement it fail `$computed`
   *  references against them clearly and immediately, rather than
   *  silently executing something unintended. */
  provideValue?(output: string): Promise<unknown>
}

/** What every @panda/* entity class must implement. */
export interface PandaEntityClass {
  /** Manifest-facing type name, e.g. 'panda:command', 'panda:logger' */
  readonly type: string
  /** JSON Schema describing valid `config` for this entity type. */
  readonly configSchema: JSONSchema
  /** Self-declares this entity type as a service/daemon rather than a
   *  one-shot task — see examples/at-scale/express-integration.md Part 2
   *  for why this had to be added. Every entity built before `panda:express`
   *  (command, task, logger, module) does something and finishes; a
   *  running server does not. For a `longRunning` entity, `run()`'s
   *  returned promise resolving means "started successfully", not
   *  "finished" — the process itself stays alive because of the open
   *  server handle, same as any other Node HTTP server. Tooling (a future
   *  `paws run`, or `validate()`) can use this flag to avoid treating a
   *  long-running entity's run() the way a one-shot entity's is treated
   *  (e.g. not printing "done" after it resolves). Optional; defaults to
   *  one-shot (`undefined`/`false`) for every existing entity type. */
  readonly longRunning?: boolean
  new (config: Record<string, unknown>): PandaEntityInstance
}

/**
 * A pluggable relationship between entities — see HANDLERS.md. `uses` and
 * `contributesTo` are the two the kernel ships and registers by default;
 * anything else is registered the same way, through the same mechanism,
 * with no special status. Not hardcoded as branches in the resolver.
 */
export interface PandaLinkHandler {
  /** The manifest keyword this handler owns, e.g. 'uses', 'contributesTo' */
  readonly keyword: string

  /** Called by the resolver's dependency-ordering pass, BEFORE any entity
   *  is instantiated, to find out which other entity keys this handler's
   *  value depends on — e.g. for `uses`, the value itself; for
   *  `contributesTo`, the single target key it names. */
  getDependencies(value: unknown): string[]

  /** Called once per entity, during resolve, after the entity instance
   *  exists (and after every dependency named by getDependencies() has
   *  already been fully processed) but before this entity's own `run()` is
   *  wired up. Handlers mutate `ctx` (e.g. `uses` populates `ctx.refs`) or
   *  reach into another already-resolved instance (e.g. `contributesTo`
   *  calls `registerContribution` on its target). */
  apply(params: PandaLinkParams): Promise<void> | void
}

export interface PandaLinkParams {
  /** The raw value attached to this keyword in the manifest entry. */
  value: unknown
  /** The manifest key of the entity this value is attached to. */
  key: string
  /** The entity instance currently being wired. */
  instance: PandaEntityInstance
  /** The context being built up for this entity — handlers may add to it. */
  ctx: PandaContext
  /** All other already-resolved instances in this manifest, by key. */
  instances: Record<string, PandaEntityInstance>
  /** The registry, in case a handler needs to resolve further types/actions. */
  registry: PandaRegistry
}

/** A single entity declaration inside a manifest. `uses` and `contributesTo`
 *  are the two link-handler keywords the kernel ships by default; any other
 *  key is resolved against whatever link handlers have been registered
 *  (see PandaLinkHandler above) — this is why the index signature exists. */
export interface PandaManifestEntity {
  type: string
  config?: Record<string, unknown>
  uses?: string[]
  contributesTo?: string
  [keyword: string]: unknown
}

/** The top-level JSON manifest shape. */
export interface PandaManifest {
  panda: string
  entities: Record<string, PandaManifestEntity>
  /** Public API of this manifest when it's consumed as a `panda:module` —
   *  maps an export name to a local entity key (e.g. `{ "login":
   *  "loginCommand" }`). Anything not listed here is invisible to whoever
   *  imports this manifest as a module. */
  exports?: Record<string, string>
  /** Declared parameters this manifest accepts when consumed as a
   *  `panda:module` — the equivalent of a Terraform module's `variables`.
   *  Consumed inside this manifest's own entity configs via `{ "$input":
   *  "name" }` (see value-resolvers.ts). */
  inputs?: Record<string, PandaInputSchema>
}

export interface PandaInputSchema {
  type?: string
  required?: boolean
  default?: unknown
}

/**
 * A pluggable transformation of a single config VALUE — distinct from a
 * PandaLinkHandler, which wires relationships between whole entities at
 * the manifest-entry level. A value resolver operates INSIDE a config
 * payload, at arbitrary nesting depth, recognized by a marker key (e.g.
 * `{ "$input": "greeting" }`). See HANDLERS.md and examples/at-scale/
 * computed-values.md for why this had to be a separate mechanism.
 */
export interface PandaValueResolver {
  /** The marker key this resolver owns, e.g. '$input'. A config value
   *  shaped like `{ "$input": "greeting" }` — a plain object with exactly
   *  this one key — is recognized and replaced by this resolver's output. */
  readonly marker: string
  resolve(value: unknown, ctx: PandaValueResolverContext): unknown | Promise<unknown>
  /** Optional — mirrors PandaLinkHandler.getDependencies(). Most value
   *  resolvers (e.g. `$input`) don't reference another entity at all, so
   *  this is optional and defaults to "no dependency." `$computed` is the
   *  one that needs it: `{ "from": "devServer", ... }` means the
   *  dependency-graph pass (dependency-graph.ts) must also scan inside
   *  `config`, not just sibling link-handler keywords, to know `devServer`
   *  has to be CONSTRUCTED before this entity — see computed-values.md
   *  Discovery 4. (Whether `devServer` has actually RUN by the time the
   *  value is read is a separate, caller-level concern — see
   *  provideValue() on PandaEntityInstance.) */
  getDependencies?(value: unknown): string[]
}

/** Data available while resolving value-resolver markers inside a nested
 *  manifest's config — currently just the merged input values for that
 *  manifest, plus (for `$computed`) the already-resolved instances a
 *  reference might need to reach into. `$input` only ever needs `inputs`;
 *  `$computed` is the one that needs `instances` — kept optional here
 *  rather than splitting into two context types, since a single recursive
 *  walk (resolveConfigValues) has to serve every registered resolver with
 *  one shared context shape. */
export interface PandaValueResolverContext {
  inputs: Record<string, unknown>
  instances?: Record<string, PandaEntityInstance>
}

export type PandaActionFn = (data: unknown, ctx: PandaContext) => Promise<unknown>

/** Options accepted when registering an action or entity type, controlling
 *  the namespacing decision from HANDLERS.md — automatically derive a
 *  collision-proof prefix from the registering package's name (npm's
 *  registry is already a global, centrally-allocated namespace; no new
 *  central registry infrastructure needs to be built to get this benefit). */
export interface PandaRegisterOptions {
  /** e.g. '@company/panda-plugin-deploy' — auto-prefixes the registered
   *  name as "<namespace>:<name>", so two independently-published packages
   *  can never collide even if they pick the same short name. Optional for
   *  now (app-local registrations don't need it) but required in practice
   *  once anything is published for others to depend on. */
  namespace?: string
}

