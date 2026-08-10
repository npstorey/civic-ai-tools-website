'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_SIGN_IN_OPTIONS, type SignInOption } from '@/lib/auth-provider-options';

/**
 * Carries the server-derived sign-in options to client components that props
 * cannot reach (#229 P1 / Q63) — the exact shape of `HostLinksProvider` and
 * `BrandProvider`, and mounted beside them in the root layout.
 *
 * WHY A CONTEXT AND NOT PROP THREADING. `buildProviders()` returns NextAuth
 * provider CONFIGS carrying client secrets and callbacks; only a server
 * component may call it, and only the narrowed `{id, name}` list may cross to
 * the client. But three of the affordances that need that list —
 * `RateLimitBanner`, `QueryForm`, and `McpResponseDisplay` — render inside
 * `QuerySurface`, mounted by the apex page, which is itself a client
 * component; `NotebookOutput` is the fourth, in the same tree. There is no
 * server ancestor to extend a prop chain from without converting the apex
 * page. One provider mounted once in the root layout reaches all four.
 *
 * Components a server component renders DIRECTLY take the list as a prop
 * instead: `Header` from the root layout, `DeviceSignInPanel` from the device
 * page. Props where the server can reach, context only where the client
 * boundary blocks it — the rule `HostLinksProvider` set and `BrandProvider`
 * followed.
 *
 * The default is `DEFAULT_SIGN_IN_OPTIONS` — today's single GitHub button —
 * so a component rendered outside the provider degrades to the pre-seam
 * affordance rather than to no way to sign in.
 *
 * BUILD-TIME RESOLUTION, same caveat as the brand and host-link seams: the
 * root layout resolves this from `process.env`, so for statically prerendered
 * routes (the apex `/` among them) the value freezes at build. An instance
 * whose auth variables are absent at BUILD time but present at runtime
 * prerenders no sign-in control. That is the documented behavior of every
 * non-`NEXT_PUBLIC_` chrome knob in this app (docs/deploy.md), not a new
 * property of this one.
 */
const SignInOptionsContext = createContext<SignInOption[]>(DEFAULT_SIGN_IN_OPTIONS);

export function SignInOptionsProvider({
  value,
  children,
}: {
  value: SignInOption[];
  children: ReactNode;
}) {
  return <SignInOptionsContext.Provider value={value}>{children}</SignInOptionsContext.Provider>;
}

/** Read the instance's sign-in options. Safe outside the provider (see above). */
export function useSignInOptions(): SignInOption[] {
  return useContext(SignInOptionsContext);
}
