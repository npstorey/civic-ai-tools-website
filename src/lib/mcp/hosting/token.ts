/**
 * The bridge token: what the website presents to a hosted source's bridge, and
 * what the bridge checks (#617 P3, ruling D7).
 *
 * One instance secret, `SOURCE_BRIDGE_SECRET`, and one token per sandbox:
 * HMAC-SHA256 of the sandbox's name under the secret, as lowercase hex. The
 * token reaches the sandbox only as an environment value at its creation
 * (`./lifecycle.ts`), and reaches the bridge on each request only in the
 * `Authorization` header. Nothing writes it, or the secret, to a log, a
 * command line, an error message or a record.
 *
 * ROTATION. The sandbox keeps the token it was created with, for its whole
 * life (a resume restores its environment). So rotating the secret means
 * deleting each hosted source's sandbox: until then its bridge answers every
 * request 401, and the call fails as the source being unavailable. The next
 * call after the delete creates a sandbox with the new token
 * (`docs/deploy.md`, "Hosted sources").
 */
import { createHmac } from 'node:crypto';

/** The variable holding the instance secret. */
export const SOURCE_BRIDGE_SECRET_VARIABLE = 'SOURCE_BRIDGE_SECRET';

/** The token for one sandbox: HMAC-SHA256 of its name under `secret`, hex. */
export function bridgeToken(secret: string, sandboxName: string): string {
  if (secret.length === 0) throw new Error('bridgeToken: the secret is empty');
  return createHmac('sha256', secret).update(sandboxName, 'utf8').digest('hex');
}

/** The instance secret, trimmed, or `undefined` when unset or blank. Read by
 *  name; the value is returned to the caller and never logged. */
export function readBridgeSecret(): string | undefined {
  const raw = process.env.SOURCE_BRIDGE_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}
