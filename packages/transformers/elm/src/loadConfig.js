// @flow strict-local

import type {Config} from '@atlaspack/types';
import path from 'path';
import ThrowableDiagnostic from '@atlaspack/diagnostic';
import commandExists from 'command-exists';
import nullthrows from 'nullthrows';

async function load({config}: {|config: Config|}): Promise<null> {
  const elmConfig = await config.getConfig(['elm.json']);
  if (!elmConfig) {
    elmBinaryPath(); // Check if elm is even installed
    throw new ThrowableDiagnostic({
      diagnostic: {
        origin: '@atlaspack/elm-transformer',
        message: "The 'elm.json' file is missing.",
        hints: [
          "Initialize your elm project by running 'elm init'",
          "If you installed elm as project dependency then run 'yarn elm init' or 'npx elm init'",
        ],
      },
    });
  }

  return null;
}

function elmBinaryPath(): ?string {
  let elmBinary = resolveLocalElmBinary();

  if (elmBinary == null && !commandExists.sync('elm')) {
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: "Can't find 'elm' binary.",
        hints: [
          "You can add it as an dependency for your project by running 'yarn add -D elm' or 'npm add -D elm'",
          'If you want to install it globally then follow instructions on https://elm-lang.org/',
        ],
        origin: '@atlaspack/elm-transformer',
      },
    });
  }

  return elmBinary;
}

function resolveLocalElmBinary() {
  try {
    let result = require.resolve('elm/package.json');
    // $FlowFixMe
    let pkg = require('elm/package.json');
    let bin = nullthrows(pkg.bin);
    return path.join(
      path.dirname(result),
      typeof bin === 'string' ? bin : bin.elm,
    );
  } catch (_) {
    return null;
  }
}

export {load, elmBinaryPath};
