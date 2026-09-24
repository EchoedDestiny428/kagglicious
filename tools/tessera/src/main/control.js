// Local control channel for the `tessera` command, which lets a process in one
// pane (usually claude) list, prompt and read the other panes.
//
// The channel is a named pipe (Windows) or a user-only unix socket with a
// random name, and every request must carry a random token. Both are handed
// only to processes started inside Tessera's panes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MAX_REQUEST = 256 * 1024;

export function controlAddress(platform = process.platform) {
  const id = crypto.randomBytes(8).toString('hex');
  return platform === 'win32' ? `\\\\.\\pipe\\tessera-${id}` : path.join(os.tmpdir(), `tessera-${id}.sock`);
}

function sameToken(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class ControlServer {
  // handle(cmd, args, fromPane) -> result, or throws an Error whose message is shown to the caller.
  constructor({ handle, address = controlAddress() }) {
    this.handle = handle;
    this.address = address;
    this.token = crypto.randomBytes(24).toString('hex');
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => this.accept(sock));
      server.once('error', reject);
      server.listen(this.address, () => {
        if (process.platform !== 'win32') fs.chmodSync(this.address, 0o600);
        this.server = server;
        resolve();
      });
    });
  }

  accept(sock) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(30000, () => sock.destroy());
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > MAX_REQUEST) return sock.destroy();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = '';
      this.respond(line).then((reply) => sock.end(`${JSON.stringify(reply)}\n`));
    });
  }

  async respond(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return { error: 'Bad request' };
    }
    if (!req || !sameToken(req.token, this.token)) return { error: 'Not authorized' };
    try {
      return { ok: true, result: await this.handle(String(req.cmd ?? ''), req.args ?? {}, req.from ?? null) };
    } catch (err) {
      return { error: err.message };
    }
  }

  stop() {
    this.server?.close();
    this.server = null;
    if (process.platform !== 'win32') fs.rmSync(this.address, { force: true });
  }
}
