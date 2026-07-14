# Frontend — Credit Management System

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · TanStack Query &
Table · Recharts · Framer Motion.

For the project as a whole, start at the [root README](../README.md).

## Run it

The frontend needs the backend. Start that first (see
[docs/INSTALLATION.md](../docs/INSTALLATION.md)), then:

```bash
npm install
cp .env.example .env.local
npm run dev
```

→ <http://localhost:3000> · log in with `admin@creditsystem.local` / `ChangeMe123!`

```env
NEXT_PUBLIC_API_URL=http://localhost:8000   # no trailing slash
```

## Scripts

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (`no-explicit-any` is an **error**) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/
├── app/
│   ├── (auth)/         login · register · forgot-password · reset-password
│   ├── (dashboard)/    every authenticated route
│   └── (public)/       terms · privacy
├── components/
│   ├── ui/             25 primitives — hand-built, no component library
│   ├── layout/         shell, sidebar, topbar, ⌘K palette, notification bell
│   └── auth/           auth card, password input, strength meter
├── features/           one folder per domain — components · hooks · queries
├── hooks/              focus trap, hotkeys, roving focus, media query, …
├── lib/
│   ├── graphql/        client.ts — transport + silent token refresh
│   ├── auth/           AuthProvider, tokens, permissions
│   └── validation/     Zod schemas
├── types/              domain types mirroring the backend enums
└── middleware.ts       route guard (a UX guard, NOT a security boundary)
```

A feature owns its own GraphQL documents, so the query for the dashboard lives next to
the component that renders it. Deleting a feature is deleting one folder.

## Three things to know before you change anything

### 1. Money is a string. Never a number.

Every money value arrives from the API as `"1234.56"` and must be sent back the same
way. JavaScript's `Number` is an IEEE-754 double: `0.1 + 0.2 !== 0.3`, and a balance of
`1234567.89` is not exactly representable. Format with `formatCurrency()`; never do
arithmetic on it.

The one place we *must* sum client-side is the live total in the credit builder. It
parses to **integer cents** first (`"12.34"` → `1234`), mirrors the backend formula
exactly, and treats the server as the source of truth. The preview is not allowed to
lie, even by a cent.

### 2. Design tokens live in CSS, not in a JS config.

Tailwind v4 is CSS-first: the palette is defined in `@theme` inside
`src/app/globals.css`. A `tailwind.config.ts` theme block would simply be ignored.

Every colour pair was contrast-checked against WCAG AA (4.5:1 body text, 3:1 large and
non-text) in **both** themes — the ratios are recorded in the file. If you add a
colour, do the maths. Worth knowing: indigo-500 (`#6366F1`) *fails* with white text at
4.47:1, which is why the primary is `#4F46E5` / `#5850EC`. Each status colour has a
**solid** pair (button fills) and a **soft** pair (badges, alerts) precisely because
the solid one is not legible as text.

### 3. Auth: access token in memory, refresh token in `localStorage`.

On a 401 the client fires **one** shared refresh (N waiters, one network call), retries
the original request, and on failure clears auth and redirects to `/login?next=…`.

The `localStorage` refresh token is a known XSS trade-off, documented with its
migration path in `src/lib/auth/tokens.ts`. `middleware.ts` reads a token-free
`cms_session` hint cookie purely to avoid a login flash — **it is not a security
boundary.** The server re-authorises every request; the UI only hides buttons that
would 403 anyway.
