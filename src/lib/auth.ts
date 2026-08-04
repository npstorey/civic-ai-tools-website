import type { NextAuthOptions } from 'next-auth';
import { buildProviders, normalizeIssuer, oidcAccountKey, OIDC_PROVIDER_ID } from './auth-providers';
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
      // Upsert user record in the database on every login.
      // Skip if DATABASE_URL is not configured (preserves existing behavior in dev).
      if (!process.env.DATABASE_URL) return true;

      if (account?.provider === OIDC_PROVIDER_ID) {
        // Generic OIDC sign-in: key by issuer + subject.
        const subject = account.providerAccountId || user.id;
        if (!subject) return true;
        const displayName = user.name || user.email || 'Unknown';
        // No provider-agnostic profile page exists; record the issuer origin.
        const profileUrl = normalizeIssuer(process.env.OIDC_ISSUER || '');
        await upsertUser(oidcAccountKey(subject), displayName, profileUrl);
        return true;
      }

      // GitHub sign-in (the pre-existing path)
      const githubId = user.id;
      if (!githubId) return true;

      const ghProfile = profile as { login?: string; html_url?: string } | undefined;
      const displayName = user.name || ghProfile?.login || 'Unknown';
      const profileUrl = ghProfile?.html_url || `https://github.com/${ghProfile?.login || ''}`;

      await upsertUser(githubId, displayName, profileUrl);

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
        const accountKey =
          account?.provider === OIDC_PROVIDER_ID
            ? oidcAccountKey(account.providerAccountId || user.id)
            : user.id;
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
