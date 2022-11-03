import assert from 'assert';
import path from 'path';
import {
  bundle,
  bundler,
  getNextBuild,
  normalizeFilePath,
  outputFS,
  overlayFS,
  run,
} from '@parcel/test-utils';

const config = path.join(
  __dirname,
  './integration/custom-configs/.parcelrc-typescript-validation',
);

describe('ts-validator', function () {
  let subscription;
  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
  });

  it('should throw validation error on typescript typing errors across multiple files', async function () {
    let didThrow = false;
    let entry = normalizeFilePath(
      path.join(__dirname, '/integration/ts-validation-error/index.ts'),
    );
    let testFile = normalizeFilePath(
      path.join(__dirname, '/integration/ts-validation-error/test.ts'),
    );
    try {
      await bundle(entry, {
        defaultConfig: config,
      });
    } catch (e) {
      assert.equal(e.name, 'BuildError');
      assert(!!Array.isArray(e.diagnostics));

      assert(e.diagnostics.length === 2);

      let entryDiagnostic = e.diagnostics.find(
        diagnostic => diagnostic.codeFrames[0].filePath === entry,
      );
      assert(!!entryDiagnostic);
      assert(!!entryDiagnostic.codeFrames);
      assert.equal(entryDiagnostic.origin, '@parcel/validator-typescript');
      assert.equal(
        entryDiagnostic.message,
        `Argument of type 'string' is not assignable to parameter of type 'Params'.`,
      );
      assert.equal(entryDiagnostic.codeFrames[0].filePath, entry);

      let testFileDiagnostic = e.diagnostics.find(
        diagnostic => diagnostic.codeFrames[0].filePath === testFile,
      );
      assert(!!testFileDiagnostic);
      assert(!!testFileDiagnostic.codeFrames);
      assert.equal(testFileDiagnostic.origin, '@parcel/validator-typescript');
      assert.equal(
        testFileDiagnostic.message,
        `Property 'world' does not exist on type 'Params'.`,
      );

      didThrow = true;
    }

    assert(didThrow);
  });

  it('should re-run when .ts files change', async function () {
    // We to try to avoid conflicts between tests using the same in-memory file system, we're creating a separate folder.
    // During the first test pass, this is unnecessary, but because fileSystems won't be re-created when running in 'watch' mode, this is safer.
    const inputDir = path.join(__dirname, '/ts-validator-change');
    await outputFS.mkdirp(inputDir);
    await outputFS.writeFile(path.join(inputDir, '/tsconfig.json'), `{}`);
    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `export const message: number = "This is a type error!"`,
    );

    let b = bundler(path.join(inputDir, '/index.ts'), {
      inputFS: overlayFS,
      defaultConfig: config,
    });
    subscription = await b.watch();
    let buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildFailure');
    assert.equal(buildEvent.diagnostics.length, 1);
    assert.equal(
      buildEvent.diagnostics[0].message,
      "Type 'string' is not assignable to type 'number'.",
    );

    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `export const message: string = "The type error is fixed!"`,
    );
    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');
    let output = await run(buildEvent.bundleGraph);
    assert.equal(output.message, 'The type error is fixed!');

    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `export const message: boolean = {}`,
    );
    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildFailure');
    assert.equal(buildEvent.diagnostics.length, 1);
    assert.equal(
      buildEvent.diagnostics[0].message,
      "Type '{}' is not assignable to type 'boolean'.",
    );
  });

  it('should report correct errors when multiple .ts files change at the same time - no errors', async function () {
    // We to try to avoid conflicts between tests using the same in-memory file system, we're creating a separate folder.
    // During the first test pass, this is unnecessary, but because fileSystems won't be re-created when running in 'watch' mode, this is safer.
    const inputDir = path.join(__dirname, '/ts-validator-multi-change');
    await outputFS.mkdirp(inputDir);
    await outputFS.writeFile(path.join(inputDir, '/tsconfig.json'), `{}`);
    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `import { returnMessage } from "./returnMessage";
      const message: string = "My Message!";
      export const output = returnMessage(message);`,
    );
    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: string): string { return message; }`,
    );
    let b = bundler([path.join(inputDir, '/index.ts')], {
      inputFS: overlayFS,
      defaultConfig: config,
    });
    subscription = await b.watch();

    let buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');
    let output = await run(buildEvent.bundleGraph);
    assert.equal(output.output, 'My Message!');

    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `import { returnMessage } from "./returnMessage";
      const message: number = 123456;
      export const output = returnMessage(message);`,
    );
    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: number): number { return message; }`,
    );

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');
    output = await run(buildEvent.bundleGraph);
    assert.equal(output.output, 123456);
  });

  it('should report correct errors when multiple .ts files change at the same time - with errors', async function () {
    // We to try to avoid conflicts between tests using the same in-memory file system, we're creating a separate folder.
    // During the first test pass, this is unnecessary, but because fileSystems won't be re-created when running in 'watch' mode, this is safer.
    const inputDir = path.join(__dirname, '/ts-validator-multi-change-errors');
    await outputFS.mkdirp(inputDir);
    await outputFS.writeFile(path.join(inputDir, '/tsconfig.json'), `{}`);
    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `import { returnMessage } from "./returnMessage";
      const message: string = "My Message!";
      export const output: string = returnMessage(message);`,
    );
    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: number): number { return message; }`,
    );
    let b = bundler([path.join(inputDir, '/index.ts')], {
      inputFS: overlayFS,
      defaultConfig: config,
    });
    subscription = await b.watch();

    let buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildFailure');
    assert.equal(buildEvent.diagnostics.length, 2);
    assert.equal(
      buildEvent.diagnostics[1].message,
      "Argument of type 'string' is not assignable to parameter of type 'number'.",
    );

    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `import { returnMessage } from "./returnMessage";
      const message: boolean = true;
      export const output: boolean = returnMessage(message);`,
    );
    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: null): null { return message; }`,
    );

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildFailure');
    assert.equal(buildEvent.diagnostics.length, 1);
    assert.equal(
      buildEvent.diagnostics[0].message,
      "Argument of type 'true' is not assignable to parameter of type 'null'.",
    );
  });

  it('should report correct errors when .ts dependencies change in a way that breaks a contract', async function () {
    // We to try to avoid conflicts between tests using the same in-memory file system, we're creating a separate folder.
    // During the first test pass, this is unnecessary, but because fileSystems won't be re-created when running in 'watch' mode, this is safer.
    const inputDir = path.join(__dirname, '/ts-validator-dependencies-change');
    await outputFS.mkdirp(inputDir);
    await outputFS.writeFile(path.join(inputDir, '/tsconfig.json'), `{}`);
    await outputFS.writeFile(
      path.join(inputDir, '/index.ts'),
      `import { returnMessage } from "./returnMessage";
      const message: string = "My Message!";
      export const output = returnMessage(message);`,
    );
    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: string): string { return message; }`,
    );
    let b = bundler([path.join(inputDir, '/index.ts')], {
      inputFS: overlayFS,
      defaultConfig: config,
    });
    subscription = await b.watch();

    let buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');
    let output = await run(buildEvent.bundleGraph);
    assert.equal(output.output, 'My Message!');

    await outputFS.writeFile(
      path.join(inputDir, '/returnMessage.ts'),
      `export function returnMessage(message: number): number { return message; }`,
    );

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildFailure');
    assert.equal(buildEvent.diagnostics.length, 1);
    assert.equal(
      buildEvent.diagnostics[0].message,
      "Argument of type 'string' is not assignable to parameter of type 'number'.",
    );
  });
});
