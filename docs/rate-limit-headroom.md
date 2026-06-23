<!-- v2 — 2026-06-23 — Decision recorded: A+B. Option B mechanism (env-overridable limits) applied in src/lib/rate-limit.ts; NOT activated (no env var set). Status header + Option B + Recommendation updated to match. v1 (2026-06-16): options memo, no code changed. -->

# Rate-limit headroom for a high-traffic event

**Status:** Decision recorded — **A + B**. The Option B mechanism (env-overridable limits) is now **applied in code** (`src/lib/rate-limit.ts`) but **not activated**: no override env var is set, so the live limits are still the defaults (10 anonymous / 25 authenticated). Activation is a maintainer step on demo day — set `ANONYMOUS_RATE_LIMIT` (and optionally `AUTHENTICATED_RATE_LIMIT`) in Vercel **production** for the demo window only, then delete it. Option A stands as the primary path (the driver signs in).
**Why this exists:** An upcoming public demo will put a burst of traffic on `civicaitools.org` from one venue. The current anonymous limit is low and keys on IP, which interacts badly with a shared venue network. This memo lays out the options and the exact code that each one touches, so the choice is yours and reversible.

---

## How rate limiting works today

- Limits live in [`src/lib/rate-limit.ts`](../src/lib/rate-limit.ts):
  - `ANONYMOUS_LIMIT = 10` (line 3)
  - `AUTHENTICATED_LIMIT = 25` (line 4)
- The **identifier** is chosen per request as `session?.user?.id || ip`:
  - signed-in → the GitHub user id (`src/app/api/compare-stream/route.ts:38`, `src/app/api/rate-limit/route.ts:13`)
  - anonymous → `x-forwarded-for`'s first IP (`compare-stream/route.ts:37`)
- The counter is keyed `rate:{identifier}:{YYYY-MM-DD}` in Vercel KV (Upstash), 48 h expiry, with an in-memory fallback when KV is absent. The day boundary is **UTC** (`getToday()`).
- `checkRateLimit` / `incrementRateLimit` pick the ceiling with `isAuthenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT`.

### The real demo risk: shared NAT collapses the room into one bucket

Anonymous requests are bucketed **by IP**. A conference room behind shared NAT presents **one** egress IP, so the entire audience shares a **single** `ANONYMOUS_LIMIT` bucket — effectively ~10 anonymous queries total for the whole room per UTC day, not 10 each. That is the failure mode to design around.

Two second-order notes:
- **KV present (the prod default; required per the preflight):** the anon counter is shared and durable across serverless instances, so the shared-IP bucket is real and global.
- **KV absent (fallback):** the in-memory counter is per-instance and resets on cold start — paradoxically *more* lenient but inconsistent. Don't rely on this; keep KV configured.

### Where the storyboard actually puts load

In the demo spine, **datHere drives** the live answer (Data Concierge) and the audience's job is to **verify** via the Typed Standards badge. Verification runs **client-side on `typedstandards.org/verify`, which has no rate limit**. So on the critical path, only the driver issues `civicaitools.org` queries. Anonymous audience load only appears if attendees independently run their own live queries on `civicaitools.org` from the venue.

---

## The options

### Option A — Use the signed-in path (no code change) — *recommended primary*

A signed-in request is keyed by GitHub user id, not IP, and uses `AUTHENTICATED_LIMIT = 25` — a private bucket that bypasses the room's shared anonymous IP bucket entirely.

- **Touch-points:** none in `rate-limit.ts`. This already works in prod. The "change" is operational: the demo driver signs in (GitHub) before the demo. Requires `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `NEXTAUTH_SECRET` / `NEXTAUTH_URL` present — the preflight (`scripts/preflight-env.mjs`) checks all four.
- **Pros:** zero code, zero risk, already deployed; fits the storyboard exactly (the driver issues the live queries).
- **Cons:** only covers the **driver**. If audience members run anonymous queries from the venue, they still share the anon IP bucket. Also: `AUTHENTICATED_LIMIT = 25` is per **UTC day**, so a heavy same-day rehearsal eats into the live-demo budget (see the optional bump below).

### Option B — Make the limits env-overridable, lift via a Vercel env var — *recommended safety net*

Make `ANONYMOUS_LIMIT` (and optionally `AUTHENTICATED_LIMIT`) read an env override with the current value as the default. Headroom then becomes a **Vercel env change, no code deploy**, and reverting is just removing the env var — no commit to forget on the auto-deploying `main`.

- **Touch-point:** `src/lib/rate-limit.ts`. **Applied** — both limits now resolve through a `resolveLimit(envValue, fallback)` helper that reads the env override with the current value as the default:

  ```ts
  const ANONYMOUS_LIMIT = resolveLimit(process.env.ANONYMOUS_RATE_LIMIT, 10);
  const AUTHENTICATED_LIMIT = resolveLimit(process.env.AUTHENTICATED_RATE_LIMIT, 25);
  ```

  Behavior is identical to the old hardcoded constants when the env vars are unset (a missing, empty, non-numeric, or zero override all resolve to the default — covered by `rate-limit.test.ts`). To lift for the demo window, set e.g. `ANONYMOUS_RATE_LIMIT=100` in Vercel (production) and delete it afterward.
- **Pros:** raises the shared-IP ceiling for everyone in the room; reversible with no deploy and no leftover elevated constant in code; covers both anonymous attendees and a heavy-rehearsal driver in one mechanism.
- **Cons:** globally loosens the anonymous limit for the window (low abuse risk — the site is `robots`-blocked and low-traffic, but it is a global change). Even lifted, a busy shared NAT could exhaust a higher bucket.
- **Alternative (not recommended):** hardcode `ANONYMOUS_LIMIT = 100` directly. Simpler diff, but it must be reverted by a second commit, and a forgotten revert ships an elevated limit to prod via auto-deploy. The env-driven form avoids that trap.

### Option C — Allowlist / bypass for the venue or demo machine

Exempt a specific identifier (the venue egress IP) or a shared bypass token from the limit entirely.

- **Touch-points:** `src/lib/rate-limit.ts` (add an `isExempt(identifier)` consulted by `checkRateLimit` + `incrementRateLimit`, e.g. against `process.env.RATE_LIMIT_ALLOWLIST` of comma-separated IPs, or a `process.env.DEMO_BYPASS_TOKEN` matched from a request header), **and** `src/app/api/compare-stream/route.ts:42-48` (skip the `isRateLimited` gate when exempt). Needs the venue egress IP known in advance, or a bypass token loaded on the demo machine.
- **Pros:** precisely targets the demo without globally loosening anything; can be effectively unlimited for the exempt identity.
- **Cons:** most code and most risk. A new bypass path is a security surface that must be removed or tightly scoped afterward; a token in a query string can leak; an IP allowlist breaks if the venue's NAT egress differs from what you pinned. Highest complexity for a one-day need.

---

## Recommendation

1. **Primary: Option A.** The driver signs in; their live queries use the private 25/day bucket. Zero code, fits the storyboard. (Confirm the four auth env vars via the preflight.)
2. **Safety net: Option B (env-driven) — applied.** The env-override mechanism is now in code; headroom is a reversible Vercel env toggle. Set `ANONYMOUS_RATE_LIMIT` for the demo window only if audience members will run anonymous queries from the venue. Removing the env var fully reverts it.
3. **Option C only if** a hands-on station has many people running anonymous queries and Options A+B don't cover it — accept the added cleanup.

Optional, independent of the above: set `AUTHENTICATED_RATE_LIMIT` (now also env-overridable) for the demo day if the driver's same-day rehearsal + live run might exceed 25 (the limit resets at the UTC day boundary).

**Decision: A + B.** The Option B mechanism is applied but **not activated** — the live limits remain the defaults until an override env var is set in Vercel production on demo day.

## Demo-day checklist tie-in

- Run `op run --env-file=.env.local -- node scripts/preflight-env.mjs` — confirms the auth + KV vars Option A/B depend on are present.
- If Option B is active, confirm `ANONYMOUS_RATE_LIMIT` is set in Vercel **production** (not just preview) and remember to delete it after the event.
