/**
 * @panda/kernel — registry (draft, see ../SPEC.md)
 */

declare class PandaRegistry {
    private entities;
    private actions;
    private services;
    private linkHandlers;
    private valueResolvers;
    /** Named manifests available to `panda:module` as an explicit TEST-DOUBLE
     *  mechanism — keyed by whatever string a manifest's `config.source`
     *  uses, for sources that aren't (or aren't yet) real installed npm
     *  packages. Real resolution (treating `source` as an npm package name,
     *  reading its `package.json`'s `panda.manifest` field) is implemented
     *  in npm-resolution.ts and tried first — see that file and
     *  docs/modules.md. */
    private moduleSources;
    /** Tracks which service names are still holding their built-in default,
     *  so a real registration can override it exactly once without tripping
     *  the "already registered" guard that applies to everything else. */
    private defaultServiceNames;
    constructor();
    registerEntity(entityClass: PandaEntityClass, options?: PandaRegisterOptions): void;
    registerAction(name: string, fn: PandaActionFn, options?: PandaRegisterOptions): void;
    /** Register an ambient service factory. Real registrations of `log`,
     *  `trace`, or `style` transparently replace the kernel's built-in no-op
     *  default the first time — after that, like everything else, a second
     *  registration under the same name is an error. Anything beyond those
     *  three is a normal named registration with no special-casing. */
    registerService<K extends keyof PandaServices | (string & {})>(name: K, factory: PandaServiceFactory<any>, options?: PandaRegisterOptions): void;
    resolveEntity(type: string): PandaEntityClass;
    resolveAction(name: string): PandaActionFn;
    registerLinkHandler(handler: PandaLinkHandler): void;
    resolveLinkHandler(keyword: string): PandaLinkHandler;
    /** Non-throwing lookup, used by validate() to report an unknown keyword
     *  as a diagnostic rather than throwing. */
    tryResolveLinkHandler(keyword: string): PandaLinkHandler | undefined;
    /** Explicit test-double mechanism for `panda:module` sources that
     *  AREN'T (or aren't yet) real installed npm packages — e.g. demos,
     *  tests, anything not yet published. Real resolution (Phase 4, see
     *  npm-resolution.ts) is tried FIRST by `panda:module`'s configure();
     *  this is only consulted as a fallback when that returns nothing. */
    registerModuleSource(name: string, manifest: PandaManifest): void;
    resolveModuleSource(name: string): PandaManifest;
    registerValueResolver(resolver: PandaValueResolver): void;
    /** Non-throwing — a config value with a single key that ISN'T a
     *  registered marker is just ordinary data, not an error. */
    tryResolveValueResolver(marker: string): PandaValueResolver | undefined;
    /** Non-throwing lookups, used by validate() (see validator.ts) to collect
     *  every problem in a manifest instead of stopping at the first one. */
    tryResolveEntity(type: string): PandaEntityClass | undefined;
    hasAction(name: string): boolean;
    hasService(name: string): boolean;
    /** Materializes every registered service factory into a concrete instance
     *  once. Called by the resolver a single time per `resolve()` call — all
     *  entities in a manifest share one ambient services object, since these
     *  are process-wide capabilities, not per-entity state. */
    buildServices(): PandaServices;
}

/**
 * @panda/kernel — entity contract (draft, see ../SPEC.md)
 */

type JSONSchema = Record<string, unknown>;
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
interface PandaServices {
    log: PandaLogger;
    trace: PandaTracer;
    style: PandaStyler;
}
interface PandaLogger {
    log(msg: string): void;
    info(msg: string): void;
    error(msg: string): void;
}
interface PandaTracer {
    trace(msg: string, tags?: string[]): void;
}
interface PandaStyler {
    /** `styles` is optional and generic (a style name or list of names) —
     *  deliberately NOT typed against any specific styling library's naming
     *  scheme, so kernel core stays uncoupled from any one backend. See
     *  DECISIONS.md — this was widened from a plain `(text) => string` when
     *  retrofitting the real @panda/colors surfaced that the original shape
     *  couldn't carry any real styling capability at all. */
    (text: string, styles?: string | string[]): string;
}
type PandaServiceFactory<K extends keyof PandaServices = keyof PandaServices> = () => PandaServices[K];
/** Shared capabilities handed to every entity at run time. Entities receive
 *  these — they do not construct their own logger/tracer/styler. */
interface PandaContext {
    services: PandaServices;
    /** Other resolved entity instances, keyed by their manifest key. */
    refs: Record<string, PandaEntityInstance>;
    /** This entity's own resolved config. */
    config: Record<string, unknown>;
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
    instances: Record<string, PandaEntityInstance>;
}
interface PandaEntityInstance {
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
    configure?(ctx: PandaContext): Promise<void>;
    run(ctx: PandaContext): Promise<unknown>;
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
    provideValue?(output: string): Promise<unknown>;
}
/** What every @panda/* entity class must implement. */
interface PandaEntityClass {
    /** Manifest-facing type name, e.g. 'panda:command', 'panda:logger' */
    readonly type: string;
    /** JSON Schema describing valid `config` for this entity type. */
    readonly configSchema: JSONSchema;
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
    readonly longRunning?: boolean;
    new (config: Record<string, unknown>): PandaEntityInstance;
}
/**
 * A pluggable relationship between entities — see HANDLERS.md. `uses` and
 * `contributesTo` are the two the kernel ships and registers by default;
 * anything else is registered the same way, through the same mechanism,
 * with no special status. Not hardcoded as branches in the resolver.
 */
interface PandaLinkHandler {
    /** The manifest keyword this handler owns, e.g. 'uses', 'contributesTo' */
    readonly keyword: string;
    /** Called by the resolver's dependency-ordering pass, BEFORE any entity
     *  is instantiated, to find out which other entity keys this handler's
     *  value depends on — e.g. for `uses`, the value itself; for
     *  `contributesTo`, the single target key it names. */
    getDependencies(value: unknown): string[];
    /** Called once per entity, during resolve, after the entity instance
     *  exists (and after every dependency named by getDependencies() has
     *  already been fully processed) but before this entity's own `run()` is
     *  wired up. Handlers mutate `ctx` (e.g. `uses` populates `ctx.refs`) or
     *  reach into another already-resolved instance (e.g. `contributesTo`
     *  calls `registerContribution` on its target). */
    apply(params: PandaLinkParams): Promise<void> | void;
}
interface PandaLinkParams {
    /** The raw value attached to this keyword in the manifest entry. */
    value: unknown;
    /** The manifest key of the entity this value is attached to. */
    key: string;
    /** The entity instance currently being wired. */
    instance: PandaEntityInstance;
    /** The context being built up for this entity — handlers may add to it. */
    ctx: PandaContext;
    /** All other already-resolved instances in this manifest, by key. */
    instances: Record<string, PandaEntityInstance>;
    /** The registry, in case a handler needs to resolve further types/actions. */
    registry: PandaRegistry;
}
/** A single entity declaration inside a manifest. `uses` and `contributesTo`
 *  are the two link-handler keywords the kernel ships by default; any other
 *  key is resolved against whatever link handlers have been registered
 *  (see PandaLinkHandler above) — this is why the index signature exists. */
interface PandaManifestEntity {
    type: string;
    config?: Record<string, unknown>;
    uses?: string[];
    contributesTo?: string;
    [keyword: string]: unknown;
}
/** The top-level JSON manifest shape. */
interface PandaManifest {
    panda: string;
    entities: Record<string, PandaManifestEntity>;
    /** Public API of this manifest when it's consumed as a `panda:module` —
     *  maps an export name to a local entity key (e.g. `{ "login":
     *  "loginCommand" }`). Anything not listed here is invisible to whoever
     *  imports this manifest as a module. */
    exports?: Record<string, string>;
    /** Declared parameters this manifest accepts when consumed as a
     *  `panda:module` — the equivalent of a Terraform module's `variables`.
     *  Consumed inside this manifest's own entity configs via `{ "$input":
     *  "name" }` (see value-resolvers.ts). */
    inputs?: Record<string, PandaInputSchema>;
}
interface PandaInputSchema {
    type?: string;
    required?: boolean;
    default?: unknown;
}
/**
 * A pluggable transformation of a single config VALUE — distinct from a
 * PandaLinkHandler, which wires relationships between whole entities at
 * the manifest-entry level. A value resolver operates INSIDE a config
 * payload, at arbitrary nesting depth, recognized by a marker key (e.g.
 * `{ "$input": "greeting" }`). See HANDLERS.md and examples/at-scale/
 * computed-values.md for why this had to be a separate mechanism.
 */
interface PandaValueResolver {
    /** The marker key this resolver owns, e.g. '$input'. A config value
     *  shaped like `{ "$input": "greeting" }` — a plain object with exactly
     *  this one key — is recognized and replaced by this resolver's output. */
    readonly marker: string;
    resolve(value: unknown, ctx: PandaValueResolverContext): unknown | Promise<unknown>;
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
    getDependencies?(value: unknown): string[];
}
/** Data available while resolving value-resolver markers inside a nested
 *  manifest's config — currently just the merged input values for that
 *  manifest, plus (for `$computed`) the already-resolved instances a
 *  reference might need to reach into. `$input` only ever needs `inputs`;
 *  `$computed` is the one that needs `instances` — kept optional here
 *  rather than splitting into two context types, since a single recursive
 *  walk (resolveConfigValues) has to serve every registered resolver with
 *  one shared context shape. */
interface PandaValueResolverContext {
    inputs: Record<string, unknown>;
    instances?: Record<string, PandaEntityInstance>;
}
type PandaActionFn = (data: unknown, ctx: PandaContext) => Promise<unknown>;
/** Options accepted when registering an action or entity type, controlling
 *  the namespacing decision from HANDLERS.md — automatically derive a
 *  collision-proof prefix from the registering package's name (npm's
 *  registry is already a global, centrally-allocated namespace; no new
 *  central registry infrastructure needs to be built to get this benefit). */
interface PandaRegisterOptions {
    /** e.g. '@company/panda-plugin-deploy' — auto-prefixes the registered
     *  name as "<namespace>:<name>", so two independently-published packages
     *  can never collide even if they pick the same short name. Optional for
     *  now (app-local registrations don't need it) but required in practice
     *  once anything is published for others to depend on. */
    namespace?: string;
}

/**
 * @panda/kernel — resolver (draft, see ../SPEC.md)
 *
 * Turns a JSON manifest into a fully wired set of running entity instances.
 * This is the piece that never existed in the old ecosystem (CommandCenter
 * was reaching for this and was never built) — it is the entire "bind
 * everything via JSON" promise made real.
 */

interface ResolveOptions {
    /** Override any subset of ambient services for this resolve() call —
     *  rarely needed directly; prefer registry.registerService() so the
     *  override is visible to anything introspecting the registry too. */
    services?: Partial<PandaServices>;
}
declare function resolve(manifest: PandaManifest, registry: PandaRegistry, options?: ResolveOptions): Promise<Record<string, PandaEntityInstance>>;

/**
 * @panda/kernel — validate() / dry-run (draft, see ../SPEC.md, docs/status.md #3)
 *
 * Checks a manifest for problems WITHOUT constructing or running anything —
 * no entity is ever instantiated here, so this is guaranteed side-effect
 * free regardless of what any individual entity's constructor might do.
 * This is the fast, safe feedback loop an AI agent (or a human) needs while
 * iterating on a manifest, distinct from resolve() which actually builds
 * and runs the thing.
 */

interface PandaDiagnostic {
    /** Which entity key this problem belongs to, if it's specific to one. */
    entityKey?: string;
    message: string;
    severity: 'error' | 'warning';
}
interface PandaValidationResult {
    valid: boolean;
    diagnostics: PandaDiagnostic[];
}
declare function validate(manifest: PandaManifest, registry: PandaRegistry): PandaValidationResult;

/**
 * @panda/kernel — entities/logger.ts
 *
 * Minimal stub entity, NOT a replacement for the real @panda/logger.
 * Exists only so the proof-of-concept manifest has something for
 * `panda:command` to `uses`. Real @panda/logger gets retrofitted to this
 * same contract later — see SPEC.md "next step".
 */

interface LoggerConfig {
    level?: 'info' | 'debug' | 'error';
}
declare class PandaLoggerEntity implements PandaEntityInstance {
    private config;
    static readonly type = "panda:logger";
    static readonly configSchema: JSONSchema;
    constructor(config: LoggerConfig);
    run(_ctx: PandaContext): Promise<unknown>;
}

/**
 * @panda/kernel — entities/command.ts
 *
 * Minimal stub of `panda:command`, deliberately NOT the full @panda/command
 * (no arg parsing, no subcommands, no prompts). Just enough surface to prove
 * that a manifest can declare a command, wire it to a dependency (`uses`),
 * and resolve its `action` as a named reference instead of an embedded
 * function — the core rule from SPEC.md.
 */

declare function createCommandEntity(registry: PandaRegistry): {
    new (config: Record<string, unknown>): {
        config: Record<string, unknown>;
        /** Lets a host entity (e.g. panda:cli) that this command was
         *  contributed to or `uses`d by introspect its name without needing to
         *  know panda:command's internal config shape. */
        getCommandName(): string;
        run(ctx: PandaContext): Promise<unknown>;
    };
    readonly type: "panda:command";
    readonly configSchema: JSONSchema;
};

/**
 * @panda/kernel — entities/cli.ts
 *
 * `panda:cli` is the first real host entity type: it accepts other command
 * entities either as declared dependencies (`uses`) or as contributions
 * (`contributesTo`, from a plugin package that doesn't know this CLI's
 * manifest key ahead of time) — proving the design in
 * examples/at-scale/plugin-contribution.md actually works in code, not
 * just on paper.
 */

interface ContributableCommand {
    getCommandName(): string;
    run(ctx: PandaContext): Promise<unknown>;
}
declare class PandaCliEntity implements PandaEntityInstance {
    private config;
    static readonly type = "panda:cli";
    static readonly configSchema: JSONSchema;
    private commands;
    constructor(config: Record<string, unknown>);
    /** Opt-in extension point (duck-typed, per HANDLERS.md) — anything with
     *  getCommandName()/run() can be contributed, whether it arrived via
     *  `uses` (and was manually registered below in run()) or via
     *  `contributesTo` (registered here directly by the link handler). */
    registerContribution(entity: ContributableCommand): void;
    run(ctx: PandaContext): Promise<unknown>;
}

declare function createModuleEntity(registry: PandaRegistry): {
    new (config: Record<string, unknown>): {
        exportedInstances: Record<string, PandaEntityInstance>;
        config: Record<string, unknown>;
        /** Eagerly resolves the nested manifest here (not in run()) — see the
         *  configure() doc comment on PandaEntityInstance for why: dependents
         *  need getExport() available during THIS resolve() pass, before
         *  anyone's run() is ever called. */
        configure(_ctx: PandaContext): Promise<void>;
        /** Merges the module's declared input schema (defaults, required-ness)
         *  with whatever the consumer actually supplied, failing clearly if a
         *  required input with no default was never provided. */
        resolveInputs(source: string, schema: PandaManifest["inputs"], supplied: Record<string, unknown> | undefined): Record<string, unknown>;
        /** The one-hop reference mechanism (entity-ref.ts) calls this on
         *  whatever a `uses`/`contributesTo` reference resolves to when it
         *  crosses a module boundary. */
        getExport(name: string): PandaEntityInstance;
        run(): Promise<unknown>;
    };
    readonly type: "panda:module";
    readonly configSchema: JSONSchema;
};

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

interface DevServerConfig {
    portRange: [number, number];
}
declare class PandaDevServerEntity implements PandaEntityInstance {
    static readonly type = "panda:dev-server";
    static readonly configSchema: JSONSchema;
    config: DevServerConfig;
    port?: number;
    constructor(config: Record<string, unknown>);
    run(ctx: PandaContext): Promise<unknown>;
    /** Deliberately does NOT trigger run() if it hasn't happened yet — per
     *  computed-values.md Discovery 3 (Option B), "give me a value" and
     *  "execute my primary behavior" are two different, independently
     *  invokable things. A caller that asks for the port before this entity
     *  has run gets a clear, immediate error, not a silent implicit run(). */
    provideValue(output: string): Promise<unknown>;
}

/**
 * @panda/kernel — value resolver mechanism (draft, see ../HANDLERS.md,
 * ../examples/at-scale/computed-values.md)
 *
 * Recursively walks a config value tree looking for marker objects (a
 * plain object with EXACTLY one key matching a registered resolver's
 * `marker`), and replaces each one with that resolver's output. This is
 * how `panda:module` substitutes `{ "$input": "greeting" }` inside a
 * nested manifest's entity configs before resolving it.
 */

/** Async because `$computed` (below) has to `await` a source entity's
 *  `provideValue()` — `$input` doesn't need to be async, but one shared
 *  recursive walk serving every registered resolver has to accommodate
 *  whichever ones do. */
declare function resolveConfigValues(value: unknown, registry: PandaRegistry, ctx: PandaValueResolverContext): Promise<unknown>;
/** Ships as one of the two built-in value resolvers — see PandaRegistry's
 *  constructor. Any other marker (`$env`, `$secret`, ...) is registered
 *  the same way, with no special status. */
declare class InputValueResolver implements PandaValueResolver {
    readonly marker = "$input";
    resolve(value: unknown, ctx: PandaValueResolverContext): unknown;
}
/** `{ "$computed": { "from": "devServer", "output": "port" } }` — a config
 *  value resolved from another entity's RUNTIME OUTPUT, not a static
 *  input. See examples/at-scale/computed-values.md for the full design
 *  walkthrough (Discoveries 1-4) this implements:
 *   - A value resolver, not a link handler (Discovery 1) — operates
 *     inside `config`, wherever a `$computed` marker appears.
 *   - Never implicitly triggers `run()` (Discovery 3) — calls the source
 *     entity's opt-in `provideValue()` instead; an entity that doesn't
 *     implement it fails clearly, immediately, rather than silently
 *     executing something unintended.
 *   - `getDependencies()` (below) feeds dependency-graph.ts's config-tree
 *     scan (Discovery 4), so the source entity is at least CONSTRUCTED
 *     before this one — whether it's actually been RUN by the time the
 *     value is read is the caller's responsibility (the same finding
 *     `panda:mongodb`'s `uses` relationship surfaced — see kernel
 *     DECISIONS.md), not something this resolver can enforce.
 *   - Caching policy (Discovery 4's "left open" list) is deliberately the
 *     source entity's own `provideValue()` implementation's business, not
 *     this resolver's — a devServer's port should be stable per-process;
 *     something like "current git SHA" might legitimately be re-read each
 *     time, and only the entity itself knows which. */
declare class ComputedValueResolver implements PandaValueResolver {
    readonly marker = "$computed";
    getDependencies(value: unknown): string[];
    resolve(value: unknown, ctx: PandaValueResolverContext): Promise<unknown>;
}

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

interface NpmModulePackageJson {
    panda?: {
        manifest?: string;
    };
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
declare function resolveNpmModuleSource(source: string, fromDir?: string): PandaManifest | undefined;

export { ComputedValueResolver, InputValueResolver, type JSONSchema, type NpmModulePackageJson, type PandaActionFn, PandaCliEntity, type PandaContext, PandaDevServerEntity, type PandaDiagnostic, type PandaEntityClass, type PandaEntityInstance, type PandaInputSchema, type PandaLinkHandler, type PandaLinkParams, type PandaLogger, PandaLoggerEntity, type PandaManifest, type PandaManifestEntity, type PandaRegisterOptions, PandaRegistry, type PandaServiceFactory, type PandaServices, type PandaStyler, type PandaTracer, type PandaValidationResult, type PandaValueResolver, type PandaValueResolverContext, type ResolveOptions, createCommandEntity, createModuleEntity, resolve, resolveConfigValues, resolveNpmModuleSource, validate };
