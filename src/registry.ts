/**
 * @panda/kernel — registry (draft, see ../SPEC.md)
 */

import type {
  PandaActionFn,
  PandaEntityClass,
  PandaLinkHandler,
  PandaManifest,
  PandaRegisterOptions,
  PandaServiceFactory,
  PandaServices,
  PandaValueResolver,
} from './types'
import { UsesLinkHandler, ContributesToLinkHandler } from './link-handlers'
import { InputValueResolver, ComputedValueResolver } from './value-resolvers'

function namespacedName(name: string, options?: PandaRegisterOptions): string {
  return options?.namespace ? `${options.namespace}:${name}` : name
}

const noopLogger = {
  log: (msg: string) => console.log(msg),
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
}

const noopTracer = {
  trace: (_msg: string, _tags?: string[]) => {},
}

const noopStyler = (text: string) => text

export class PandaRegistry {
  private entities = new Map<string, PandaEntityClass>()
  private actions = new Map<string, PandaActionFn>()
  private services = new Map<string, PandaServiceFactory>()
  private linkHandlers = new Map<string, PandaLinkHandler>()
  private valueResolvers = new Map<string, PandaValueResolver>()
  /** Named manifests available to `panda:module` as an explicit TEST-DOUBLE
   *  mechanism — keyed by whatever string a manifest's `config.source`
   *  uses, for sources that aren't (or aren't yet) real installed npm
   *  packages. Real resolution (treating `source` as an npm package name,
   *  reading its `package.json`'s `panda.manifest` field) is implemented
   *  in npm-resolution.ts and tried first — see that file and
   *  docs/modules.md. */
  private moduleSources = new Map<string, PandaManifest>()
  /** Tracks which service names are still holding their built-in default,
   *  so a real registration can override it exactly once without tripping
   *  the "already registered" guard that applies to everything else. */
  private defaultServiceNames = new Set<string>()

  constructor() {
    // Kernel guarantees these three are always present — see PandaServices
    // in types.ts. Everything else registered via registerService has no
    // guaranteed fallback.
    this.registerService('log', () => noopLogger)
    this.registerService('trace', () => noopTracer)
    this.registerService('style', () => noopStyler)
    this.defaultServiceNames = new Set(['log', 'trace', 'style'])

    // `uses` and `contributesTo` are the two link handlers the kernel ships
    // by default — see HANDLERS.md. Structurally, they're registered
    // through the exact same mechanism a third party's own handler would
    // use; nothing about them is special-cased in the resolver itself.
    this.registerLinkHandler(new UsesLinkHandler())
    this.registerLinkHandler(new ContributesToLinkHandler())

    // `$input` and `$computed` are the two built-in value resolvers — see
    // value-resolvers.ts and HANDLERS.md.
    this.registerValueResolver(new InputValueResolver())
    this.registerValueResolver(new ComputedValueResolver())
  }

  registerEntity(entityClass: PandaEntityClass, options?: PandaRegisterOptions): void {
    const type = namespacedName(entityClass.type, options)
    if (this.entities.has(type)) {
      throw new Error(`Entity type "${type}" is already registered`)
    }
    this.entities.set(type, entityClass)
  }

  registerAction(name: string, fn: PandaActionFn, options?: PandaRegisterOptions): void {
    const key = namespacedName(name, options)
    if (this.actions.has(key)) {
      throw new Error(`Action "${key}" is already registered`)
    }
    this.actions.set(key, fn)
  }

  /** Register an ambient service factory. Real registrations of `log`,
   *  `trace`, or `style` transparently replace the kernel's built-in no-op
   *  default the first time — after that, like everything else, a second
   *  registration under the same name is an error. Anything beyond those
   *  three is a normal named registration with no special-casing. */
  registerService<K extends keyof PandaServices | (string & {})>(
    name: K,
    factory: PandaServiceFactory<any>,
    options?: PandaRegisterOptions,
  ): void {
    const key = namespacedName(name as string, options)
    const isOverridingDefault = this.defaultServiceNames.has(key)
    if (this.services.has(key) && !isOverridingDefault) {
      throw new Error(`Service "${key}" is already registered`)
    }
    this.services.set(key, factory)
    if (isOverridingDefault) this.defaultServiceNames.delete(key)
  }

  resolveEntity(type: string): PandaEntityClass {
    const entityClass = this.entities.get(type)
    if (!entityClass) throw new Error(`No entity registered for type "${type}"`)
    return entityClass
  }

  resolveAction(name: string): PandaActionFn {
    const fn = this.actions.get(name)
    if (!fn) throw new Error(`No action registered with name "${name}"`)
    return fn
  }

  registerLinkHandler(handler: PandaLinkHandler): void {
    if (this.linkHandlers.has(handler.keyword)) {
      throw new Error(`Link handler for keyword "${handler.keyword}" is already registered`)
    }
    this.linkHandlers.set(handler.keyword, handler)
  }

  resolveLinkHandler(keyword: string): PandaLinkHandler {
    const handler = this.linkHandlers.get(keyword)
    if (!handler) throw new Error(`No link handler registered for manifest keyword "${keyword}"`)
    return handler
  }

  /** Non-throwing lookup, used by validate() to report an unknown keyword
   *  as a diagnostic rather than throwing. */
  tryResolveLinkHandler(keyword: string): PandaLinkHandler | undefined {
    return this.linkHandlers.get(keyword)
  }

  /** Explicit test-double mechanism for `panda:module` sources that
   *  AREN'T (or aren't yet) real installed npm packages — e.g. demos,
   *  tests, anything not yet published. Real resolution (Phase 4, see
   *  npm-resolution.ts) is tried FIRST by `panda:module`'s configure();
   *  this is only consulted as a fallback when that returns nothing. */
  registerModuleSource(name: string, manifest: PandaManifest): void {
    if (this.moduleSources.has(name)) {
      throw new Error(`Module source "${name}" is already registered`)
    }
    this.moduleSources.set(name, manifest)
  }

  resolveModuleSource(name: string): PandaManifest {
    const manifest = this.moduleSources.get(name)
    if (!manifest) throw new Error(`No module source registered for "${name}"`)
    return manifest
  }

  registerValueResolver(resolver: PandaValueResolver): void {
    if (this.valueResolvers.has(resolver.marker)) {
      throw new Error(`Value resolver for marker "${resolver.marker}" is already registered`)
    }
    this.valueResolvers.set(resolver.marker, resolver)
  }

  /** Non-throwing — a config value with a single key that ISN'T a
   *  registered marker is just ordinary data, not an error. */
  tryResolveValueResolver(marker: string): PandaValueResolver | undefined {
    return this.valueResolvers.get(marker)
  }

  /** Non-throwing lookups, used by validate() (see validator.ts) to collect
   *  every problem in a manifest instead of stopping at the first one. */
  tryResolveEntity(type: string): PandaEntityClass | undefined {
    return this.entities.get(type)
  }

  hasAction(name: string): boolean {
    return this.actions.has(name)
  }

  hasService(name: string): boolean {
    return this.services.has(name)
  }

  /** Materializes every registered service factory into a concrete instance
   *  once. Called by the resolver a single time per `resolve()` call — all
   *  entities in a manifest share one ambient services object, since these
   *  are process-wide capabilities, not per-entity state. */
  buildServices(): PandaServices {
    const built: Record<string, unknown> = {}
    for (const [name, factory] of this.services.entries()) built[name] = factory()
    return built as unknown as PandaServices
  }
}
