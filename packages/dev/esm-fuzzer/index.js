import {MemoryFS} from '@atlaspack/fs';
import assert from 'assert';
import path from 'path';

const runESM = require('./runESM');
const atlaspack = require('./atlaspack');
const generateExample = require('./generateExample');

async function run(example) {
  let inputFS = new MemoryFS(atlaspack.workerFarm);

  let nativeOutput = {output: [], error: null};
  try {
    await runESM({
      entries: example.entries.map(f => `${__dirname}/src/${f}`),
      globals: {
        output(v) {
          nativeOutput.push(v);
        },
      },
      fs: {
        readFileSync(f) {
          return example.files[path.basename(f)];
        },
      },
    });
  } catch (e) {
    let match = e.message.match(
      /The requested module '(.*)' does not provide an export named '(.*)'/,
    );

    if (match) {
      let [, file, symbol] = match;
      nativeOutput.error = {file, symbol};
    } else {
      throw e;
    }
  }

  await inputFS.mkdirp(`${__dirname}/src`);
  for (let [name, code] of Object.entries(example.files)) {
    await inputFS.writeFile(`${__dirname}/src/${name}`, code);
  }

  let atlaspackBundles = {output: null, error: null};
  try {
    atlaspackBundles.output = await atlaspack({
      inputFS,
      entries: example.entries.map(f => `${__dirname}/src/${f}`),
    });
  } catch (e) {
    let match = e.diagnostics[0].message.match(/(.*) does not export '(.*)'/);
    if (match) {
      let [, file, symbol] = match;
      let relative = path.relative('packages/dev/fuzzer/src/', file);
      atlaspackBundles.error = {
        file: relative.startsWith('.') ? relative : `./${relative}`,
        symbol,
      };
    } else {
      throw e;
    }
  }

  if ((nativeOutput.error == null) != (atlaspackBundles.error == null)) {
    console.error('Native error:', nativeOutput.error);
    console.error('Atlaspack error:', atlaspackBundles.error);
    throw new Error();
  } else {
    if (nativeOutput.error != null) {
      assert.deepEqual(nativeOutput.error, atlaspackBundles.error);
    } else {
      let output = [];
      await runESM({
        entries: example.entries.map(
          f => `${__dirname}/dist/${f.replace('.mjs', '.js')}`,
        ),
        globals: {
          output(v) {
            output.push(v);
          },
        },
        fs: {
          readFileSync(f) {
            return atlaspackBundles.output.output.get(f);
          },
        },
      });
      assert.deepEqual(output, nativeOutput.output);
    }
  }
}

// let fixture = {
//   files: {
//     '0.mjs': '',
//   },
//   entries: ['0.mjs'],
// };

(async () => {
  try {
    atlaspack.start();

    // await run(fixture);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let i = 0;
      for (let example of generateExample()) {
        try {
          await run(example);
        } catch (e) {
          if (
            !e.message.includes(
              `couldn't be statically analyzed when importing '*'`,
            )
          ) {
            console.error(e);
            console.error(example);
          }
          break;
        }
        if (++i % 10 === 0) {
          console.log(i);
        }
        if (i > 120) {
          break;
        }
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await atlaspack.stop();
  }
})();
