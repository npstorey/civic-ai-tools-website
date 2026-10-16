// #617 P3 red commit: the bridge token, not yet implemented. The criteria's
// tests are written against this module's surface and fail at their
// assertions until the host lands.
export const SOURCE_BRIDGE_SECRET_VARIABLE = 'SOURCE_BRIDGE_SECRET';

export function bridgeToken(_secret: string, _sandboxName: string): string {
  throw new Error('bridgeToken: not implemented (#617 P3 red commit)');
}

export function readBridgeSecret(): string | undefined {
  return undefined;
}
