#!/usr/bin/env node
'use strict';

/**
 * Shipped as `bin/parcel3`. Parcel itself is a native executable, published one
 * platform package per target and pulled in through optionalDependencies, so all
 * this file does is hand off to whichever one npm installed for this host.
 *
 * It also tries to take itself out of the loop. Starting Node costs ~30ms on
 * every single `parcel3` invocation, which is a large tax on a tool whose whole
 * point is being fast, so on the first run it rewrites the `node_modules/.bin`
 * entry that launched it into a launcher that execs the binary without Node.
 * See `launcher` for why that launcher looks the way it does.
 *
 * Install scripts would be the natural place for this, but npm and pnpm both
 * block them by default now, so first run is the earliest moment available.
 */

const fs = require('fs');
const path = require('path');

/** The command, which is also the `node_modules/.bin` entry `optimize` rewrites. */
const NAME = 'parcel3';

/** Prefix of the platform packages. Scoped; only `parcel3` itself is not. */
const PLATFORM_PACKAGE = '@parcel/parcel3';

const EXECUTABLE = process.platform === 'win32' ? 'parcel3.exe' : 'parcel3';

/**
 * The platform packages that could serve this host, best first.
 *
 * The names are derived rather than listed, matching what `matrix.mjs` builds
 * from the target table: `process.platform` and `process.arch` are already the
 * values npm's `os` and `cpu` fields use, so a new target needs no change here.
 *
 * On Linux the name also depends on the C library, and rather than detect it and
 * trust the answer we try both: npm, pnpm and Bun all honour the `libc` field,
 * so only the right one is installed and the wrong one simply fails to resolve.
 * The musl check just decides which to try first, for the package managers that
 * ignore `libc` and install both.
 */
function candidates() {
  const base = `${PLATFORM_PACKAGE}-${process.platform}-${process.arch}`;
  if (process.platform !== 'linux') return [base];
  return isMusl() ? [`${base}-musl`, base] : [base, `${base}-musl`];
}

/**
 * Whether this is a musl system. Biome and friends shell out to `ldd --version`
 * for this; a directory listing costs a fraction of a process.
 */
function isMusl() {
  try {
    return fs.readdirSync('/lib').some(entry => entry.startsWith('ld-musl-'));
  } catch {
    return false;
  }
}

function resolveBinary() {
  for (const pkg of candidates()) {
    try {
      return require.resolve(`${pkg}/${EXECUTABLE}`);
    } catch {}
  }
  return null;
}

const binPath = resolveBinary();
if (binPath == null) {
  // Both cases land here, and the message covers both: the package is missing
  // either because this platform has no prebuilt binary, or because it was
  // skipped at install time.
  process.stderr.write(
    `Parcel could not find the "${
      candidates()[0]
    }" package, which would hold the parcel3 ` +
      `binary for ${process.platform} ${process.arch}.\n\n` +
      `Either Parcel publishes no binary for this platform, or the one it does publish was not ` +
      `installed: it comes in through optionalDependencies, so --no-optional and --omit=optional ` +
      `both skip it, as does copying node_modules here from a machine of a different platform. ` +
      `Reinstalling on this machine fixes the second case.\n`,
  );
  process.exit(1);
}

optimize();
run();

/**
 * Rewrite the `.bin` entry that launched us so it runs the binary directly.
 *
 * Only an entry that can be proven to refer to this file is ever touched, the
 * write goes through a temp file and an atomic rename, and every failure leaves
 * the entry alone - a slow parcel3 is fine, a broken one is not.
 */
function optimize() {
  // Windows generates .cmd and .ps1 shims with `node` baked in at install time,
  // so replacing what they point at would only break them.
  if (process.platform === 'win32' || process.env.PARCEL_NO_OPTIMIZE) return;

  for (const entry of binEntries()) {
    try {
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink()) {
        // npm and Yarn: .bin/parcel3 is a symlink to this file.
        if (fs.realpathSync(entry) !== __filename) continue;
      } else if (stat.isFile()) {
        // pnpm: .bin/parcel3 is a generated sh wrapper that runs `node <this>`.
        if (!wrapsThisFile(fs.readFileSync(entry, 'utf8'))) continue;
      } else {
        continue;
      }

      replace(entry);
    } catch {}
  }
}

/**
 * Whether a generated wrapper points at this file. Package managers write the
 * path relative to their own layout, so the tail below the last `node_modules`
 * is the longest part that is guaranteed to appear verbatim.
 */
function wrapsThisFile(contents) {
  const tail = __filename.split(/node_modules[\\/]/).pop();
  return contents.includes(tail) && contents.includes('node');
}

/** Every `.bin/parcel3` that could have launched this file. */
function* binEntries() {
  // What the kernel was handed, before symlinks were resolved: npm and Yarn
  // launch us through the .bin symlink itself.
  const argv1 = process.argv[1];
  if (argv1 && path.basename(path.dirname(argv1)) === '.bin') {
    yield argv1;
  }

  // Otherwise walk up. `node_modules/.bin` covers a hoisted layout; pnpm keeps
  // the package under `node_modules/.pnpm/...` and the bin beside the store
  // rather than next to the package, so that one is checked separately.
  let dir = path.dirname(__filename);
  for (
    let parent = path.dirname(dir);
    parent !== dir;
    parent = path.dirname(dir)
  ) {
    const base = path.basename(dir);
    if (base === 'node_modules') yield path.join(dir, '.bin', NAME);
    if (base === '.pnpm') yield path.join(parent, '.bin', NAME);
    dir = parent;
  }
}

/**
 * The launcher gets read two different ways and has to work as both.
 *
 * Normally the kernel reads `#!/bin/sh` and sh execs the binary, which is the
 * whole point: no Node anywhere. But an invocation that started just before the
 * rename has already told Node to load this path as its entry module, and Node
 * opens it ~30ms later - after the swap. Writing anything Node cannot parse, a
 * symlink to the binary included, makes those invocations die trying to read a
 * Mach-O or ELF file as JavaScript.
 *
 * So the rest of the file is also valid JavaScript. `":"` is the sh no-op and a
 * bare string in JS; everything after `//` is an sh argument and a JS comment.
 * A straggler falls through to the last line and runs the binary anyway, paying
 * for Node one final time.
 */
function launcher(entry) {
  // Relative to the launcher, so the tree stays movable: renaming the project or
  // copying node_modules into an image keeps it working.
  const rel = path.relative(path.dirname(entry), binPath);
  if (/["$`\\\n]/.test(rel)) return null; // not safely quotable for sh

  return (
    '#!/bin/sh\n' +
    `":" //# ; exec "\${0%/*}/${rel}" "$@"\n` +
    `require("child_process").spawnSync(require("path").join(__dirname, ${JSON.stringify(
      rel,
    )}), ` +
    `process.argv.slice(2), {stdio: "inherit"});\n`
  );
}

/**
 * Write beside the entry, then rename over it. A concurrent invocation sees
 * either the old entry or the new one, never a half-written file.
 */
function replace(entry) {
  const contents = launcher(entry);
  if (contents == null) return;

  const tmp = `${entry}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, contents, {mode: 0o755});
    fs.renameSync(tmp, entry);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function run() {
  const args = process.argv.slice(2);

  // Replacing this process rather than forking one keeps signals, the exit code
  // and terminal handling native. Node gained execve in 23.11 and never has it
  // on Windows, hence the fallback.
  if (typeof process.execve === 'function') {
    process.execve(binPath, [binPath, ...args], process.env);
  }

  const result = require('child_process').spawnSync(binPath, args, {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  // Signal death has no exit code of its own; 128 + signal is what a shell reports.
  process.exit(
    result.signal
      ? 128 + require('os').constants.signals[result.signal]
      : result.status,
  );
}
