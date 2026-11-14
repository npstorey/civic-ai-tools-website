'use client';

/**
 * The composer's one sign-in decision (UX-2 P3b-1's three branches, `QueryForm.tsx:370-376` at b4766f1; UX-2 P3b-2,
 * fix 14): a link to the app host's sign-in on a split topology (`signInHref`), the one configured provider's sign-in
 * started in place, or a link to the panel that lists several. None where the instance offers no sign-in.
 *
 * Read by P3b-1's sign-in line under the box (`SignInControl`, its markup unchanged: the fix-14 capture holds it
 * byte-identical in each branch, at first paint and with the count exhausted) and by the harness menu's "Sign in for
 * more options" (`useSignInAction`, rendered as the menu's button item), so the two cannot part. The header's control
 * has a fourth branch (a cross-host "Open app"), which neither reads (F5, UX-2's close list).
 */

import type { CSSProperties, ReactNode } from 'react';
import { signIn } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInAffordance } from '@/lib/auth-provider-options';

/** Where sign-in goes: a link, or a provider's sign-in started in place; null where none is offered. */
export type SignInAction = { kind: 'link'; href: string } | { kind: 'start'; providerId: string } | null;

/** The instance's sign-in decision, from the host links and the configured providers (P4c; #229 P1). */
export function useSignInAction(): SignInAction {
  const { signInHref } = useHostLinks();
  const affordance = resolveSignInAffordance(useSignInOptions());
  if (signInHref !== null) return { kind: 'link', href: signInHref };
  if (affordance.kind === 'provider') return { kind: 'start', providerId: affordance.option.id };
  if (affordance.kind === 'panel') return { kind: 'link', href: affordance.href };
  return null;
}

/** Start the in-place branch's sign-in. */
export function startSignIn(providerId: string): void {
  void signIn(providerId);
}

/** The decision as one control: an `<a>`, or a `<button>` that starts the sign-in in place; nothing where none. */
export function SignInControl({ action, style, children }: { action: SignInAction; style?: CSSProperties; children: ReactNode }) {
  if (action === null) return null;
  if (action.kind === 'link') return <a href={action.href} style={style}>{children}</a>;
  return <button type="button" onClick={() => startSignIn(action.providerId)} style={style}>{children}</button>;
}
