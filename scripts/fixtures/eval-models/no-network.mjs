// Loaded with `node --import` by scripts/eval-models.test.mjs: any network
// attempt — a fetch, or a socket opened by anything else — throws, naming
// what was attempted. The dry run is run under it and must still exit 0; the
// live slug check is run under it as the red that shows it bites.

import net from 'node:net';

function refuse(what) {
  throw new Error(`no-network preload: ${what} was attempted`);
}

globalThis.fetch = async (input) => refuse(`fetch ${typeof input === 'string' ? input : input?.url ?? input}`);
net.Socket.prototype.connect = function connect() {
  refuse('a socket connect');
};
