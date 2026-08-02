/**
 * Prints the path of the cdylib cargo just built, read from its JSON message
 * stream rather than guessed from target/<triple>/release/lib<crate>.<ext>.
 * Cargo already knows the answer, including how the crate name was mangled and
 * where the target directory is.
 *
 * Usage:
 *   node cargo-library.mjs --dir <plugin dir> --messages <cargo json> --ext <so|dylib|dll>
 *
 * This is the one Rust-specific step in packaging. A Go build names its own
 * output with `-o`, so it passes that path to pack-artifact.mjs directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';

reportErrors();

let {values} = parseArgs({
  options: {
    dir: {type: 'string', default: '.'},
    messages: {type: 'string'},
    ext: {type: 'string'},
  },
});

for (let required of ['messages', 'ext']) {
  if (!values[required]) {
    throw new Error(`Missing required argument --${required}`);
  }
}

let manifest = path.resolve(values.dir, 'Cargo.toml');
let matches = [];

for (let line of fs.readFileSync(values.messages, 'utf8').split('\n')) {
  if (!line.startsWith('{')) {
    continue;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }

  if (
    message.reason !== 'compiler-artifact' ||
    !message.target?.kind?.includes('cdylib')
  ) {
    continue;
  }

  let files = (message.filenames ?? []).filter(file =>
    file.toLowerCase().endsWith(`.${values.ext}`),
  );
  if (files.length > 0) {
    matches.push({
      manifestPath: message.manifest_path,
      file: files[files.length - 1],
    });
  }
}

if (matches.length === 0) {
  throw new Error(
    `cargo did not produce a .${values.ext}. Does the crate in ${values.dir} set crate-type = ["cdylib"]?`,
  );
}

// A dependency may also be a cdylib, so prefer the plugin's own crate.
let samePath = (a, b) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
let own = matches.filter(
  match => match.manifestPath && samePath(match.manifestPath, manifest),
);

if (own.length > 0) {
  console.log(own[own.length - 1].file);
} else if (matches.length > 1) {
  throw new Error(
    `cargo produced multiple cdylibs and none belong to ${manifest}:\n${matches
      .map(m => `  - ${m.file}`)
      .join('\n')}`,
  );
} else {
  console.log(matches[0].file);
}
