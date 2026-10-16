// #617 P3 red commit: the bridge the website writes into a hosted source's
// sandbox, not yet written.
export const BRIDGE_PACKAGES: Record<string, string> = {};
export const BRIDGE_PACKAGE_JSON = '{}';

export interface BridgeConfig {
  package: string;
  version: string;
  pinDir: string;
  port: number;
}

export function bridgeConfig(_config: BridgeConfig): string {
  return '{}';
}

export const BRIDGE_READY_LINE = 'BRIDGE_READY';
export const BRIDGE_SOURCE: string = '';
