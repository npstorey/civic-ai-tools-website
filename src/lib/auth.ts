import type { NextAuthOptions } from 'next-auth';
import { buildProviders, normalizeIssuer, providerAccountKey, OIDC_PROVIDER_ID } from './auth-providers';
import { isSignInAllowed } from './auth-allowlist';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Upsert a user row keyed by its provider-account key (the `githubId`
 * column: GitHub numeric id for GitHub sign-ins, `oidc:{issuer}:{sub}`
 * composite for OIDC sign-ins — the prefix cannot collide with numeric ids).
 */
async function upsertUser(accountKey: string, displayName: string, profileUrl: string) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.githubId, accountKey))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({
      githubId: accountKey,
      displayName,
      githubProfileUrl: profileUrl,
    });
  } else {
    // Update display name and profile URL in case they changed upstream
    await db
      .update(users)
      .set({ displayName, githubProfileUrl: profileUrl })
      .where(eq(users.githubId, accountKey));
  }
}

export const authOptions: NextAuthOptions = {
  providers: buildProviders(),
  callbacks: {
    async signIn({ user, account, profile }) {
      // One derivation for both provider families (GitHub numeric ids and
      // `oidc:{issuer}:{sub}` composites) — the same key the users table is
      // keyed on and the JWT callback looks up.
      const accountKey = providerAccountKey(account, user);

      // THE GATE (app front-door v0.1.0). Checked first: before the database
      // is consulted and before any row is written, so a refused account
      // leaves no trace. With SIGN_IN_ALLOWLIST unset or empty this is
      // unconditionally true and the whole callback behaves exactly as it did
      // before the gate existed.
      //
      // REFUSAL UX (deliberate, v0.1.0): returning false hands the request to
      // NextAuth's built-in AccessDenied flow — HTTP 403 at
      // /api/auth/error?error=AccessDenied, reading "Access Denied — You do
      // not have permission to sign in." with a link back to the sign-in page
      // (`pages.signIn`, i.e. `/`). No custom error page is configured: the
      // built-in copy is already accurate and unblamed, and a bespoke page
      // would be new public surface for no gain at this tier.
      if (!isSignInAllowed(accountKey)) return false;

      // Upsert user record in the database on every login.
      // Skip if DATABASE_URL is not configured (preserves existing behavior in dev).
      if (!process.env.DATABASE_URL) return true;
      if (!accountKey) return true;

      if (account?.provider === OIDC_PROVIDER_ID) {
        // Generic OIDC sign-in: keyed by issuer + subject.
        const displayName = user.name || user.email || 'Unknown';
        // No provider-agnostic profile page exists; record the issuer origin.
        const profileUrl = normalizeIssuer(process.env.OIDC_ISSUER || '');
        await upsertUser(accountKey, displayName, profileUrl);
        return true;
      }

      // GitHub sign-in (the pre-existing path)
      const ghProfile = profile as { login?: string; html_url?: string } | undefined;
      const displayName = user.name || ghProfile?.login || 'Unknown';
      const profileUrl = ghProfile?.html_url || `https://github.com/${ghProfile?.login || ''}`;

      await upsertUser(accountKey, displayName, profileUrl);

      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        // token.sub is the GitHub user ID
        (session.user as { id?: string }).id = token.sub;

        // Attach internal DB user ID if database is configured
        if (process.env.DATABASE_URL && token.dbUserId) {
          (session.user as { dbId?: string }).dbId = token.dbUserId as string;
        }
      }
      return session;
    },
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token;
      }

      // Look up the internal DB user ID on initial sign-in, by the same
      // provider-account key the signIn upsert wrote.
      if (user?.id && process.env.DATABASE_URL) {
        const accountKey = providerAccountKey(account, user) as string;
        const dbUser = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.githubId, accountKey))
          .limit(1);
        if (dbUser.length > 0) {
          token.dbUserId = dbUser[0].id;
        }
      }

      return token;
    },
  },
  pages: {
    signIn: '/',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Type augmentation for session
declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      dbId?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
