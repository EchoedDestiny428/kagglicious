// `tessera`: control the other panes from inside a pane.
// Started by bin/tessera(.cmd) with Tessera's own runtime, so no separate
// Node install is needed.
import net from 'node:net';
import path from 'node:path';

const HELP = `Usage: tessera <command>

  list                          The orchestrator and agents, with state (working / idle / exited)
  send <pane> <text>            Type text into a pane and press Enter ("-" reads stdin)
  read <pane> [--lines N]       Last N lines of a pane's screen (default 60)
  wait <pane> [--idle S] [--timeout S]
                                Wait until a pane has been quiet for S seconds (default 3);
                                gives up after --timeout seconds (default 100, exit code 2)
  open [folder]                 Start an agent in a folder (default: this folder)

Panes are numbered as in "tessera list". Typical use: send a task, wait, then read.`;

const env = process.env;
const self = env.TESSERA_PANE ?? null;

function fail(message, code = 1) {
  process.stderr.write(`tessera: ${message}\n`);
  process.exit(code);
}

function request(cmd, args = {}) {
  if (!env.TESSERA_SOCKET || !env.TESSERA_TOKEN) fail('not running inside a Tessera pane.');
  return new Promise((resolve, reject) => {
    const sock = net.connect(env.TESSERA_SOCKET);
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(20000, () => {
      sock.destroy();
      reject(new Error('Tessera did not answer.'));
    });
    sock.on('connect', () => sock.write(`${JSON.stringify({ token: env.TESSERA_TOKEN, cmd, args, from: self })}\n`));
    sock.on('data', (d) => {
      buf += d;
    });
    sock.on('end', () => {
      try {
        const reply = JSON.parse(buf);
        if (reply.error) reject(new Error(reply.error));
        else resolve(reply.result);
      } catch {
        reject(new Error('Unexpected reply from Tessera.'));
      }
    });
    sock.on('error', () => reject(new Error('Tessera is not reachable (was it closed?).')));
  });
}

// Pull "--name value" options out of an argument list.
function options(argv, names) {
  const rest = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (name && names.includes(name)) {
      opts[name] = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  return { rest, opts };
}

function number(value, fallback, name) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(`--${name} needs a number.`);
  return n;
}

function paneArg(value) {
  const id = String(value ?? '').replace(/^#/, '');
  if (!/^\d+$/.test(id)) fail('give a pane number (see "tessera list").');
  return id;
}

// Git Bash hands over paths like /c/Users/me; turn them into C:\Users\me.
function folderArg(value = '.') {
  const m = process.platform === 'win32' && /^\/([a-zA-Z])(\/.*)?$/.exec(value);
  const p = m ? `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}` : value;
  return path.resolve(p);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function pad(s, n) {
  s = String(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const commands = {
  async list() {
    const panes = await request('list');
    if (!panes.length) return console.log('No panes open.');
    console.log(`${pad('pane', 6)}${pad('state', 10)}${pad('folder', 30)}title`);
    for (const p of panes) {
      const you = p.id === self ? '   <- you' : '';
      const name = p.role === 'orchestrator' ? `${p.name} (orchestrator)` : p.name;
      console.log(`${pad(p.id, 6)}${pad(p.state, 10)}${pad(name, 30)}${p.title}${you}`);
    }
  },

  async send(argv) {
    const [target, ...words] = argv;
    const id = paneArg(target);
    if (id === self) fail('that is this pane.');
    let text = words.join(' ');
    if (text === '-') text = await readStdin();
    text = text.replace(/\s+$/, '');
    if (!text) fail('nothing to send.');
    await request('send', { id, text });
    console.log(`Sent to pane ${id}.`);
  },

  async read(argv) {
    const { rest, opts } = options(argv, ['lines']);
    const id = paneArg(rest[0]);
    const lines = Math.min(2000, Math.max(1, Math.round(number(opts.lines, 60, 'lines'))));
    process.stdout.write(`${await request('read', { id, lines })}\n`);
  },

  async wait(argv) {
    const { rest, opts } = options(argv, ['idle', 'timeout']);
    const id = paneArg(rest[0]);
    if (id === self) fail('cannot wait for this pane.');
    const idle = number(opts.idle, 3, 'idle');
    const timeout = number(opts.timeout, 100, 'timeout');
    const until = Date.now() + timeout * 1000;
    for (;;) {
      const pane = (await request('list')).find((p) => p.id === id);
      if (!pane) fail(`pane ${id} is not open.`);
      if (pane.state !== 'working' && pane.state !== 'starting' && pane.idle >= idle) {
        return console.log(`Pane ${id} is ${pane.state}.`);
      }
      if (Date.now() > until) {
        console.log(`Pane ${id} is still working after ${timeout}s.`);
        process.exit(2);
      }
      await sleep(1000);
    }
  },

  async open(argv) {
    const res = await request('open', { cwd: folderArg(argv[0]) });
    console.log(`Opened pane ${res.id}.`);
  },
};

const [cmd, ...argv] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
} else if (!commands[cmd]) {
  fail(`unknown command "${cmd}". Run "tessera help".`);
} else {
  commands[cmd](argv).catch((err) => fail(err.message));
}
