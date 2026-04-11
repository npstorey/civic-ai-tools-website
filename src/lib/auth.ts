import type { NextAuthOptions } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      // Upsert user record in the database on every login.
      // Skip if DATABASE_URL is not configured (preserves existing behavior in dev).
      if (!process.env.DATABASE_URL) return true;

      const githubId = user.id;
      if (!githubId) return true;

      const ghProfile = profile as { login?: string; html_url?: string } | undefined;
      const displayName = user.name || ghProfile?.login || 'Unknown';
      const profileUrl = ghProfile?.html_url || `https://github.com/${ghProfile?.login || ''}`;

      const existing = await db
        .select()
        .from(users)
        .where(eq(users.githubId, githubId))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(users).values({
          githubId,
          displayName,
          githubProfileUrl: profileUrl,
        });
      } else {
        // Update display name and profile URL in case they changed on GitHub
        await db
          .update(users)
          .set({ displayName, githubProfileUrl: profileUrl })
          .where(eq(users.githubId, githubId));
      }

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

      // Look up the internal DB user ID on initial sign-in
      if (user?.id && process.env.DATABASE_URL) {
        const dbUser = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.githubId, user.id))
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
