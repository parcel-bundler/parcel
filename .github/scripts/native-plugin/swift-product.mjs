/**
 * Prints the name of the dynamic library product a Swift plugin package builds.
 *
 * Usage: node swift-product.mjs --manifest <file> [--product <name>]
 *
 * `--manifest` is the output of `swift package dump-package`, captured by the
 * caller: on Linux, Swift only exists inside the build container, while these
 * scripts run on the runner. A package with exactly one dynamic library product
 * needs nothing more; one with several names the plugin with `--product`.
 */
import fs from 'node:fs';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';

reportErrors();

let {values} = parseArgs({
  options: {manifest: {type: 'string'}, product: {type: 'string'}},
});

if (!values.manifest) {
  throw new Error('--manifest is required');
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(values.manifest, 'utf8'));
} catch (err) {
  throw new Error(
    `Could not read the output of swift package dump-package: ${err.message}`,
  );
}

let dynamic = (manifest.products ?? [])
  .filter(product => product.type?.library?.[0] === 'dynamic')
  .map(product => product.name);

if (values.product) {
  if (!dynamic.includes(values.product)) {
    throw new Error(
      `Package.swift has no dynamic library product named ${JSON.stringify(
        values.product,
      )}. Declare it with .library(name: ${JSON.stringify(
        values.product,
      )}, type: .dynamic, targets: [...]).`,
    );
  }
  console.log(values.product);
} else if (dynamic.length === 1) {
  console.log(dynamic[0]);
} else if (dynamic.length === 0) {
  throw new Error(
    'Package.swift has no dynamic library product. Parcel loads a plugin as a shared library: declare one with .library(name: "MyPlugin", type: .dynamic, targets: [...]).',
  );
} else {
  throw new Error(
    `Package.swift has several dynamic library products (${dynamic.join(
      ', ',
    )}). Pass the swift-product input to say which one is the plugin.`,
  );
}
