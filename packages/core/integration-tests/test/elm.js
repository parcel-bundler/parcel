import assert from 'assert';
import path from 'path';
import {
  bundle,
  distDir,
  assertBundles,
  run,
  outputFS,
} from '@parcel/test-utils';

describe('elm', function () {
  it('should produce a basic Elm bundle', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'));

    assertBundles(b, [
      {
        type: 'js',
        assets: ['Main.elm', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');
  });
  it('should produce a elm bundle with debugger', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'));

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(js.includes('elm$browser$Debugger'));
  });

  it('should apply elm-hot if HMR is enabled', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      hmrOptions: true,
    });

    assertBundles(b, [
      {
        type: 'js',
        assets: ['Main.elm', 'index.js'],
      },
    ]);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(js.includes('[elm-hot]'));
  });

  it('should remove debugger in production', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      mode: 'production',
    });

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$browser$Debugger'));
  });

  it('should remove debugger when environment variable `PARCEL_ELM_NO_DEBUG` is set to true', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      env: {PARCEL_ELM_NO_DEBUG: true},
    });

    await run(b);
    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$browser$Debugger'));
  });

  it('should minify Elm in production mode', async function () {
    let b = await bundle(path.join(__dirname, '/integration/elm/index.js'), {
      mode: 'production',
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    await run(b);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('elm$core'));
    assert(js.includes('Elm'));
    assert(js.includes('init'));
  });

  it('should produce correct formatting and indentation when compilation fails', async function () {
    const normalizedPath = path.normalize(
      'test/integration/elm-compile-error/src/Main.elm',
    );
    await assert.rejects(
      () =>
        bundle(path.join(__dirname, 'integration/elm-compile-error/index.js'), {
          mode: 'production',
        }),

      {
        name: 'BuildError',
        diagnostics: [
          {
            message:
              '\n' +
              `-- TYPE MISMATCH --------------- ${normalizedPath}\n` +
              '\n' +
              'The 1st argument to `text` is not what I expect:\n' +
              '\n' +
              '7|     Html.text 5 "Hello, world!"\n' +
              '                 **^**\n' +
              'This argument is a number of type:\n' +
              '\n' +
              '    **number**\n' +
              '\n' +
              'But `text` needs the 1st argument to be:\n' +
              '\n' +
              '    **String**\n' +
              '\n' +
              '__Hint__: Try using **String.fromInt** to convert it to a string?',
            origin: '@parcel/elm-transformer',
            stack: '',
          },
          {
            message:
              '\n' +
              `-- TOO MANY ARGS --------------- ${normalizedPath}\n` +
              '\n' +
              'The `text` function expects 1 argument, but it got 2 instead.\n' +
              '\n' +
              '7|     Html.text 5 "Hello, world!"\n' +
              '       **^^^^^^^^^**\n' +
              'Are there any missing commas? Or missing parentheses?',
            origin: '@parcel/elm-transformer',
            stack: '',
          },
        ],
      },
    );
  });

  it('should produce correct formatting and indentation when elm fails without errors property', async function () {
    await assert.rejects(
      () =>
        bundle(path.join(__dirname, 'integration/elm-error/index.js'), {
          mode: 'production',
        }),

      {
        name: 'BuildError',
        diagnostics: [
          {
            message:
              '\n' +
              '-- DEBUG REMNANTS ------------------------------------------------------------- \n' +
              '\n' +
              'There are uses of the `Debug` module in the following modules:\n' +
              '\n' +
              '    **Main**\n' +
              '\n' +
              'But the --optimize flag only works if all `Debug` functions are removed!\n' +
              '\n' +
              '__Note__: The issue is that --optimize strips out info needed by `Debug` functions.\n' +
              'Here are two examples:\n' +
              '\n' +
              '    (1) It shortens record field names. This makes the generated JavaScript is\n' +
              '    smaller, but `Debug.toString` cannot know the real field names anymore.\n' +
              '\n' +
              '    (2) Values like `type Height = Height Float` are unboxed. This reduces\n' +
              '    allocation, but it also means that `Debug.toString` cannot tell if it is\n' +
              '    looking at a `Height` or `Float` value.\n' +
              '\n' +
              'There are a few other cases like that, and it will be much worse once we start\n' +
              'inlining code. That optimization could move `Debug.log` and `Debug.todo` calls,\n' +
              'resulting in unpredictable behavior. I hope that clarifies why this restriction\n' +
              'exists!',
            origin: '@parcel/elm-transformer',
            stack: '',
          },
        ],
      },
    );
  });
});
