/**
 * Purge stale `dsh-auth-*` browser-session cookies from the DSH Desktop profile.
 *
 * Background
 * ----------
 * DSH Desktop binds its local host to `port: 0` (OS-assigned), so every launch
 * gets a fresh TCP port. The host mints one signed cookie named
 * `dsh-auth-<sha256("host:port")>` per launch, with a 30-day Max-Age and no
 * cleanup on either the host or the shell side. Each cookie is ~227 bytes and
 * carries the *old* port in its authority, so it can never authenticate again —
 * but Chromium keeps sending it.
 *
 * Measured here: 71 cookies = 16,152 bytes of `Cookie` header. Node's http
 * server defaults to `maxHeaderSize` = 16,384, so once the Cookie header plus
 * the usual request headers crossed that line the host answered
 * `431 Request Header Fields Too Large`, the desktop shell's
 * `connectDesktopWelcome` saw `!response.ok`, and the app failed with
 * "desktop welcome: Web authentication failed".
 *
 * Usage: close DeepSeek​ Harness first (Chromium holds the SQLite file open),
 *        then `node tools/purge-stale-dsh-auth-cookies.mjs [--dry-run]`.
 *
 * The DB path can be overridden with DSH_DESKTOP_COOKIE_DB.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const DEFAULT_DB = join(
  process.env.APPDATA ?? '',
  '@deepseek-ai',
  'dsh-desktop',
  'Network',
  'Cookies'
);

const dbPath = process.env.DSH_DESKTOP_COOKIE_DB ?? DEFAULT_DB;
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(dbPath)) {
  console.error(`cookie store not found: ${dbPath}`);
  process.exit(1);
}

function decodePayload(value) {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return undefined;
    const body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Ports that some process is listening on right now. */
function listeningPorts() {
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8' });
    const ports = new Set();
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4 || !/LISTENING/i.test(cols[3])) continue;
      const m = /:(\d+)$/.exec(cols[1]);
      if (m) ports.add(Number(m[1]));
    }
    return ports;
  } catch {
    return new Set();
  }
}

const db = new DatabaseSync(dbPath);
const rows = db
  .prepare("SELECT name, value FROM cookies WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%'")
  .all();

const live = listeningPorts();
let headerBytes = 0;
const stale = [];
for (const row of rows) {
  const cookieBytes = row.name.length + 1 + row.value.length + 2;
  headerBytes += cookieBytes;
  const payload = decodePayload(row.value);
  const authority = payload?.authority;
  if (typeof authority !== 'string') continue; // unparseable: leave it alone
  const port = Number(/:(\d+)$/.exec(authority)?.[1]);
  if (Number.isFinite(port) && live.has(port)) continue; // still the running launch
  stale.push(row.name);
}

console.log(`store: ${dbPath}`);
console.log(`dsh-auth-* cookies: ${rows.length} (${headerBytes} bytes of Cookie header)`);
console.log(`stale cookies (authority port not listening): ${stale.length}`);

if (dryRun) {
  console.log('--dry-run: nothing deleted');
  db.close();
  process.exit(0);
}

if (stale.length === 0) {
  console.log('nothing to do');
  db.close();
  process.exit(0);
}

const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(dbPath, backup);
console.log(`backup: ${backup}`);

const del = db.prepare('DELETE FROM cookies WHERE name = ?');
for (const name of stale) del.run(name);

const left = db
  .prepare("SELECT name, value FROM cookies WHERE host_key = '127.0.0.1' AND name LIKE 'dsh-auth-%'")
  .all();
let afterBytes = 0;
for (const row of left) afterBytes += row.name.length + 1 + row.value.length + 2;
console.log(`deleted ${stale.length}; remaining ${left.length} (${afterBytes} bytes)`);
db.close();
