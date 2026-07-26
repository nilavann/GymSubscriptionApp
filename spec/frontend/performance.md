# Performance — Bundle Size & Code Splitting

> Part of: [SPEC-WEB.md](../../SPEC-WEB.md) | App: Fit&Fine Gym Subscription Manager (Web)
> Referenced by [rules.md](./rules.md) rule 32. Written up after an observed incident: opening any single route (e.g. Member Detail) downloaded every page's CSS, `report.repository.ts`, `photo-compression.ts`, and every other route's code — none of it related to the page being viewed.

---

## 1. Root cause

Two places import everything unconditionally, so Vite has no per-route boundary to split on — the entire app compiles into one JS chunk and one CSS file, shipped on the very first request regardless of which route is visited:

1. **`App.tsx`** imports every page component as a plain static `import` (`import { ReportsPage } from './pages/ReportsPage'`, etc.), instead of `React.lazy(() => import(...))`. A static import is resolved at build time into the main chunk; Vite/Rollup only emits a separate chunk for a **dynamic** `import()`.
2. **`services.context.tsx`** imports every service/repository the same way into one `defaultServices` object built at module load — so even a route that never touches reports still pulls in `report.repository.ts`, and anything touching `memberService` pulls in `photo-compression.ts` (the canvas image-compression logic), because they're all wired in unconditionally, not per-route.

Per-page `.css` files compound this: each page's own `import './SomePage.css'` at the top of its component file gets swept into the same single output bundle for the same reason — there's no dynamic boundary for Vite to split the CSS across either.

---

## 2. The fix — route-based code splitting (required)

Industry-standard first move, and the one with the best effort-to-impact ratio: converting eager page imports to `React.lazy` + `Suspense` means each route becomes its own chunk (JS **and** its CSS) that only loads when actually visited. **Expect a large reduction, not a guaranteed percentage** — one published case study on a comparably-sized React/Vite app measured a ~95% reduction in the main bundle and ~50% less resource weight on its home page after this exact change ([mykolaaleksandrov.dev](http://www.mykolaaleksandrov.dev/posts/2025/10/react-lazy-suspense-vite-manualchunks/)); that is evidence route splitting works, not a number this app is guaranteed to hit — verify against §5's measurement steps instead of assuming a specific percentage in advance.

### 2.1 Every page in `App.tsx`'s route table is lazy-loaded

```tsx
import { lazy, Suspense } from 'react';
import { LoadingView } from './components/LoadingView';

const MembersListPage = lazy(() => import('./pages/MembersListPage').then((m) => ({ default: m.MembersListPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
// ...every page in the route table, same pattern
```

(The `.then(...)` remap is needed because this app's pages are named exports, not default exports — `React.lazy` requires a promise resolving to `{ default: Component }`.)

### 2.2 One `Suspense` boundary, at the router/shell level — not per page

```tsx
<Suspense fallback={<LoadingView />}>
  <RouterProvider router={router} />
</Suspense>
```

Reuses the existing `LoadingView` component (already used for the auth-initialization loading state, per `auth.md` §3.2) rather than inventing a second loading UI. The boundary sits at the "natural loading unit" — a full route — not wrapped around individual leaf components; a `Suspense` per button or per card would fragment loading states without meaningfully reducing bundle size further, since page components are the unit that's actually large.

### 2.3 `Suspense` is paired with an error boundary — not optional

A dynamic `import()` can fail at runtime in a way a static import never could: after a Vercel redeploy, a browser tab still holding the *previous* deploy's HTML references chunk filenames (hashed) that no longer exist on the server once the new deploy's assets replace them. The next lazy navigation's `import()` 404s and rejects — with no error boundary, that's an unhandled promise rejection that blanks the whole app instead of failing one route. Wrap the `Suspense` boundary in a class-based error boundary (React has no hook equivalent) with a "Something went wrong — reload to get the latest version" message and a reload button, consistent with this app's own rule 30 (specific message + retry, never a raw error or a dead end):

```tsx
<ChunkLoadErrorBoundary>
  <Suspense fallback={<LoadingView />}>
    <RouterProvider router={router} />
  </Suspense>
</ChunkLoadErrorBoundary>
```

### 2.4 Not routed through lazy-loading: `LoginPage` and `AppShell`

`LoginPage` is the very first thing an unauthenticated visitor needs — lazy-loading it would add a network round-trip to the critical path for zero benefit (nothing about it is heavy or rarely used). `AppShell` (the nav chrome every authenticated route renders inside) stays eager for the same reason: it's needed on every route, so splitting it out would just move its weight from "loaded once, upfront" to "loaded once, on first navigation" — no actual savings, only a `Suspense` flash for no reason.

---

## 3. Vendor chunk separation (recommended, complementary)

Route splitting shrinks the *page* code; it doesn't change how the *shared* dependencies (React, React Router, `@supabase/supabase-js`) are bundled. Those change far less often than this app's own code between deploys, so isolating them into their own chunk(s) lets returning visitors hit browser cache for the vendor chunk across app updates, re-downloading only the small app chunk that actually changed:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
```

**`lucide-react` is a lower-priority candidate for its own vendor chunk, not a non-issue** — tree-shaking and vendor-chunking solve two different problems, and it's only exempt from one of them. This app already imports icons individually by name (`import { Camera } from 'lucide-react'`, never `import * as Icons`), so Rollup only *includes* the specific icons actually referenced (tree-shaking, solved). But grouping icon libraries into their own `manualChunks` bucket is a *caching* optimization, not a size one — reference case studies do this. Whether it's worth doing here depends on this app's actual import pattern: icons are imported per-page-file, not through one shared barrel module, so after route splitting (§2), each page's lazy chunk already carries just its own ~5–10 icons pre-shaken into it — there's no single shared icon chunk to stabilize the way there would be with a centralized icon barrel. Reasonable to add an `icons-vendor` entry alongside `vendor-react`/`vendor-supabase` above if profiling (§5) shows icon code repeated meaningfully across chunks; not worth doing speculatively before that.

---

## 4. What NOT to split

- **Repository/service files** (`report.repository.ts`, `photo-compression.ts`, etc.) are individually small (a few KB) — splitting each into its own dynamic-import chunk adds request/complexity overhead disproportionate to the size saved. The real weight is at the page-component level (component code + its CSS), which route splitting (§2) already addresses. Revisit only if a specific service genuinely grows heavy (e.g. a future PDF-export or charting library dependency) — then lazy-load *that one feature*, not the whole services layer.
- **Small/leaf components** in general — per the industry guidance this doc follows, split components "in the tens of KB or larger, or components that pull in heavy dependencies"; over-splitting small components just multiplies request count without a meaningful payload reduction.

---

## 5. Measuring the result

- **Network tab, hard refresh, on any one route**: the initial JS/CSS payload should now correspond to that route (plus the vendor chunks from §3) — not every route's code. This is the direct check for the incident that motivated this doc.
- **Production build output** (`npm run build`) should show multiple chunks instead of the single `index-*.js`/`index-*.css` pair every build produced before this change — Vite's own chunk-size warning (`Some chunks are larger than 500 kB`) is the signal that's been present on every build so far and should shrink or disappear for the main chunk once routes split out.
- A bundle visualizer (e.g. `rollup-plugin-visualizer`) is a reasonable one-time or occasional dev-only addition to see the treemap of what's actually in each chunk — evaluate per [rules.md rule 12](./rules.md#ui--styling) (a dev-only dependency, zero production/runtime cost, but still worth naming the trade-off before adding) rather than reaching for it reflexively.

---

## 6. Related docs

- [rules.md](./rules.md) rule 32 — the enforceable summary of this doc
- [app-shell.md](./app-shell.md) — `AppShell`, kept eager (§2.4 above) and the `LoadingView` component this doc's `Suspense` fallback reuses
- [architecture.md](../architecture.md) — the View/Service/Repository layering `services.context.tsx` implements; §1's root-cause analysis explains why that layer isn't split the same way pages are
