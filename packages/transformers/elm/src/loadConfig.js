// @flow strict-local

import type {Config} from '@parcel/types';
import path from 'path';
import ThrowableDiagnostic from '@parcel/diagnostic';
import commandExists from 'command-exists';
import nullthrows from 'nullthrows';

type ConfigResult = {|
  elmJson: boolean,
  transformerConfig: {|extraSources: {[string]: string[]}|},
|};

async function load({config}: {|config: Config|}): Promise<ConfigResult> {
  const elmConfig = await config.getConfig(['elm.json']);
  if (!elmConfig) {
    elmBinaryPath(); // Check if elm is even installed
    throw new ThrowableDiagnostic({
      diagnostic: {
        origin: '@parcel/elm-transformer',
        message: "The 'elm.json' file is missing.",
        hints: [
          "Initialize your elm project by running 'elm init'",
          "If you installed elm as project dependency then run 'yarn elm init' or 'npx elm init'",
        ],
      },
    });
  }

  const packageJsonConfig = await config.getConfig(['package.json'], {
    packageKey: '@parcel/transformer-elm',
  });

  const transformerConfig = packageJsonConfig?.contents ?? {extraSources: {}};
  if (transformerConfig) {
    const isValidConfig =
      'extraSources' in transformerConfig &&
      Object.values(transformerConfig.extraSources).every(
        val =>
          Array.isArray(val) && val.every(item => typeof item === 'string'),
      );
    if (!isValidConfig) {
      throw new ThrowableDiagnostic({
        diagnostic: {
          origin: '@parcel/elm-transformer',
          message: 'The config in the package.json file is invalid',
          hints: [
            '"extraSources" needs to be an object whose values are string-arrays."',
          ],
        },
      });
    }
  }

  return {
    elmJson: elmConfig.contents,
    transformerConfig,
  };
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
        origin: '@parcel/elm-transformer',
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
export type {ConfigResult};
