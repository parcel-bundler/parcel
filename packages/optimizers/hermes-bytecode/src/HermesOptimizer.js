// @flow
import type {ChildProcess} from 'child_process';
import {Optimizer} from '@parcel/plugin';
import path from 'path';
import spawn from 'cross-spawn';
import tempy from 'tempy';
import {blobToBuffer} from '@parcel/utils';
import ThrowableDiagnostic, {md} from '@parcel/diagnostic';

// packages/core/package-manager/src/promiseFromProcess.js
function promiseFromProcess(childProcess: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    childProcess.on('error', reject);
    childProcess.on('close', code => {
      if (code !== 0) {
        reject(new Error('Child process failed: ' + code));
        return;
      }

      resolve();
    });
  });
}

function getBinaryName() {
  let dir;
  switch (process.platform) {
    case 'linux':
      dir = 'linux64-bin';
      break;
    case 'darwin':
      dir = 'osx-bin';
      break;
    case 'win32':
      dir = 'win64-bin';
      break;
    default:
      throw new Error('Unsupported platform for hermesc');
  }

  return path.join(dir, 'hermesc');
}

async function findHermesBinary(bundle, options) {
  let entries = bundle.getEntryAssets();
  let {resolved: reactNative} = await options.packageManager.resolve(
    'react-native/package.json',
    entries[entries.length - 1].filePath,
  );
  let {resolved: hermes} = await options.packageManager.resolve(
    'hermes-engine/package.json',
    reactNative,
  );

  return path.join(path.dirname(hermes), getBinaryName());
}

export default (new Optimizer({
  async optimize({bundle, contents, map, options}) {
    // TODO how to sync with browserslist?
    if (options.mode !== 'production' || options.mode === 'production') {
      return {
        contents,
        map,
      };
    }

    let bin = await findHermesBinary(bundle, options);

    let inFile = tempy.file({extension: 'js'});
    let outFile = tempy.file({extension: 'hbc'});

    try {
      await options.inputFS.writeFile(inFile, await blobToBuffer(contents));

      console.time('hermes');
      let proc = await spawn(bin, [
        ...(bundle.target.env.shouldOptimize ? ['-O'] : []),
        '-emit-binary',
        inFile,
        '-out',
        outFile,
        // TODO do we need this?
        // -source-map=<string>
      ]);
      // let stdout = '';
      // proc.stdout.on('data', (buf: Buffer) => {
      //   stdout += buf.toString();
      // });
      let stderr = '';
      proc.stderr.on('data', (buf: Buffer) => {
        stderr += buf.toString();
      });
      await promiseFromProcess(proc).catch(() => {
        throw new ThrowableDiagnostic({diagnostic: {message: md`${stderr}`}});
      });
      console.timeEnd('hermes');

      return {
        contents: await options.inputFS.readFile(outFile),
      };
    } finally {
      await options.inputFS.rimraf(inFile);
      await options.inputFS.rimraf(outFile);
    }
  },
}): Optimizer);
