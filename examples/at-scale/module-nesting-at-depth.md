# Worked Example: Deep Module Nesting (Express → Web Adapter → CMS → Ecommerce → Plugins)

Stress-tests the design against: Express adapter (L0) → generic web-app adapter built on it (L1) → CMS built on that (L2) → ecommerce app built on the CMS (L3) → end users/plugin authors adding custom routes on top (L4+). This resolves the open `contributes`/`contributesTo` fork from `express-integration.md` — working through real depth forced an actual decision rather than leaving it open.

**Status: design walkthrough. Resolves an open question from the previous doc — treat that resolution as decided, not tentative.**

## Verdict up front: yes, it still works — but on two conditions, both worth being explicit about, because they're the actual answer, not a footnote

## Decision: the reference grammar must be exactly one hop, used uniformly everywhere

Last doc left open whether `contributes` (host declares `from`) or `contributesTo` (contributor declares its target) was the right direction, and punted on whether dotted references could cross multiple module boundaries at once (e.g. `ecommerceApp.cms.webApp.app`). Tracing the 4-layer chain settles both:

**Multi-hop dotted paths that reach through several layers' internals at once are wrong — they'd break encapsulation and be fragile** (if any intermediate layer renames its internal entity key, every downstream manifest referencing the deep path breaks, and every layer's internal structure leaks to everyone above it). Instead: **every entity reference — in `uses`, in `contributesTo`, and now also in `exports`' own values — is exactly one hop**, resolved against the immediately-referenced module's own already-resolved exports. Long chains are built the same way real npm re-exports work: `export { app } from './webApp'`, one file at a time — nobody writes an import reaching through four unrelated packages' internals at once.

Concretely, each layer's manifest looks like this:

```json
// @yourorg/panda-web-adapter (L1) — wraps panda:express directly
{
  "panda": "1",
  "entities": {
    "app": { "type": "panda:express", "config": { "port": 3000 } }
  },
  "exports": { "app": "app" }
}
```

```json
// @yourorg/panda-cms (L2) — built on the web adapter
{
  "panda": "1",
  "entities": {
    "webApp": { "type": "panda:module", "config": { "source": "@yourorg/panda-web-adapter" } },
    "contentRoutes": { "type": "panda:express-route", "config": { "...": "..." }, "contributesTo": "webApp.app" }
  },
  "exports": { "app": "webApp.app" }
}
```

```json
// @yourorg/panda-ecommerce (L3) — built on the CMS
{
  "panda": "1",
  "entities": {
    "cms": { "type": "panda:module", "config": { "source": "@yourorg/panda-cms" } },
    "productRoutes": { "type": "panda:express-route", "config": { "...": "..." }, "contributesTo": "cms.app" }
  },
  "exports": { "app": "cms.app" }
}
```

```json
// end user's own manifest (L4) — one hop, regardless of how deep the chain actually is
{
  "panda": "1",
  "entities": {
    "shop": { "type": "panda:module", "config": { "source": "@yourorg/panda-ecommerce" } },
    "myCustomRoute": {
      "type": "panda:express-route",
      "config": { "method": "get", "path": "/loyalty-points", "action": "myapp:loyaltyAction" },
      "contributesTo": "shop.app"
    }
  }
}
```

The end user never writes `shop.cms.webApp.app` — they write `shop.app`, one hop, because L3 chose to re-export what it received from L2, which chose to re-export what it received from L1. **This settles the fork: `contributesTo` on the contributor (not `contributes.from` on the host) is the right direction**, because it's the shape that composes cleanly through arbitrary depth without anyone needing a local manifest entry for a host that might live several layers down.

## Condition 1: encapsulation is deliberate, per layer — and that's a feature, not a limitation

Whether an end user can reach all the way down to raw Express routes depends entirely on whether every layer in between chose to re-export that capability. **If the CMS author decides they don't want downstream consumers adding arbitrary raw routes** — only registering "content types" through the CMS's own higher-level API — they simply don't re-export `app` in their `exports` block, and expose `registerContentType` (or whatever) instead. Nothing downstream can reach the raw Express instance at that point, structurally, not by convention. That's exactly correct behavior, and it mirrors how real frameworks work: you can't reach into React's internals from a Next.js app either, by design, not by accident. Worth stating plainly: **the depth of customization available at L4 is a deliberate design decision made by every author between L4 and L0, not an automatic property of the system.** A module author who wants maximum extensibility re-exports generously; one who wants a tightly-controlled surface re-exports narrowly. Both are correct uses of the same mechanism.

## Condition 2: only one layer may ever actually instantiate `panda:express` — this is a discipline, not something the type system prevents

This is the one real risk worth naming honestly, because nothing in the design stops someone from getting it wrong. The whole chain above only works because **there is exactly one `PandaExpressEntity` instance in the entire resolved tree**, created once at L1, and every layer above it re-exports a reference to that *same instance* rather than creating a new one. If the CMS author mistakenly wrote `"app": { "type": "panda:express", ... }` in their own manifest (instead of importing L1's), you'd silently get two independent Express servers on two different ports, with contributions split between them — not an error, just quietly wrong behavior. Nothing in `validate()` catches this today. Worth flagging as a good future addition to dry-run (a lint-style check: "does this resolved tree contain more than one instance of an entity type marked as a singleton/service resource, and is that intentional") — not something to build now, but a real gap this exact scenario surfaced, the same way earlier walkthroughs surfaced `getDependencies()` and the `contributesTo` decision.

## Two more things this depth-check confirms work correctly, without needing new mechanism

**Multiple independent contributors converging on the same host is fine, at any depth.** Two unrelated third-party plugin authors can both write `"contributesTo": "shop.app"` in their own separate packages, and both land in the same underlying Express instance's contribution list — `registerContribution()` just accumulates, unconditionally. This generalizes the original single-plugin CLI example to N independent contributors without any design change.

**Route/path collisions between independent contributors are real but out of scope for now.** If a CMS's default route and an end user's custom route both register the same method+path, nothing today detects or resolves that collision — Express itself will just apply whichever was registered first. Worth a future `validate()` enhancement (statically detect duplicate method+path pairs across every contribution in a resolved tree before actually running), not urgent, but an honest gap surfaced by imagining independent, uncoordinated plugin authors rather than a single well-behaved chain.

## Summary

Yes, the design holds up through arbitrary depth — Express adapter → web adapter → CMS → ecommerce → end-user plugins all compose correctly — provided: (1) every layer's reference grammar stays exactly one hop, with long chains built through deliberate re-export at each layer rather than deep dotted paths (this resolves the `contributes`/`contributesTo` fork in favor of `contributesTo`); (2) each layer's author consciously decides what to re-export, which correctly bounds how deep downstream customization can reach — a feature, not a gap; and (3) only the layer that actually owns a shared resource (like the Express instance) may construct it, with every layer above re-exporting the same reference — a discipline the design doesn't yet enforce, and a good candidate for a future `validate()` check.
