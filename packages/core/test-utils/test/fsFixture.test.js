// @flow

import {
  dedentRaw,
  fsFixture,
  toFixture,
  FixtureParser,
  FixtureTokenizer,
  FixtureRoot,
  FixtureDir,
  FixtureFile,
  FixtureLink,
} from '../src/fsFixture';
import {MemoryFS} from '@atlaspack/fs';
import WorkerFarm from '@atlaspack/workers';

import assert from 'assert';
import path from 'path';

describe('dedentRaw', () => {
  it('dedents a string with leading space', () => {
    assert.equal(
      dedentRaw`     foo
        bar
          baz
    `,
      'foo\n  bar\n    baz',
    );
  });

  it('dedents a string with leading newline', () => {
    assert.equal(
      dedentRaw`
        foo
          bar
            baz
      `,
      'foo\n  bar\n    baz',
    );
  });

  it('dedents correctly with multiple top level entries', () => {
    assert.equal(
      dedentRaw`
      foo
        bar: "bar"
      foo/bar -> foo/bat
        bat
          qux - qux
        bat/qux: qux
    `,
      'foo\n  bar: "bar"\nfoo/bar -> foo/bat\n  bat\n    qux - qux\n  bat/qux: qux',
    );
  });

  it('stringifies object expressions', () => {
    assert.equal(
      dedentRaw`
        foo
          ${{
            bar: 'baz',
            bat: 'qux',
          }}
            baz
      `,
      'foo\n  {"bar":"baz","bat":"qux"}\n    baz',
    );
  });

  it('does not stringify literal expressions', () => {
    assert.equal(
      dedentRaw`
        foo
          ${JSON.stringify({
            bar: 'baz',
            bat: 'qux',
          })}
            baz
              bat: ${false}
              qux: ${123}
      `,
      'foo\n  {"bar":"baz","bat":"qux"}\n    baz\n      bat: false\n      qux: 123',
    );
  });
});

describe('FixtureTokenizer', () => {
  it('errors on malformed fixture', () => {
    assert.throws(() => {
      new FixtureTokenizer(' -> bar').tokenize();
    }, /Failed to match token/);

    assert.throws(() => {
      new FixtureTokenizer('  : bar').tokenize();
    }, /Failed to match token/);

    assert.throws(() => {
      new FixtureTokenizer('foo\n->\nbar').tokenize();
    }, /Failed to match token/);

    assert.throws(() => {
      new FixtureTokenizer('foo\n:\nbar').tokenize();
    }, /Failed to match token/);
  });

  it('tokenizes a dirname', () => {
    let tokens = new FixtureTokenizer('foo  \nfoo/bar\n    bat').tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: ''},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bat'},
    ]);
  });

  it('tokenizes a file', () => {
    let tokens = new FixtureTokenizer(
      `foo: \nbar :\n  foo\n    bar\nbaz: {"baz": "bat"}`,
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'filename', value: 'foo'},
      {type: 'content', value: ''},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: 'foo\n  bar'},
      {type: 'filename', value: 'baz'},
      {type: 'content', value: '{"baz": "bat"}'},
    ]);
  });

  it('tokenizes a link', () => {
    let tokens = new FixtureTokenizer('foo -> bar/bat\nbat->baz').tokenize();
    assert.deepEqual(tokens, [
      {type: 'filename', value: 'foo'},
      {type: 'link', value: 'bar/bat'},
      {type: 'filename', value: 'bat'},
      {type: 'link', value: 'baz'},
    ]);
  });

  it('tokenizes nested files', () => {
    let tokens = new FixtureTokenizer(
      'foo\n  bar:\n    bar\nfoo/baz/bat: bat\n    qux:\n      qux',
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: 'bar'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'baz'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bat'},
      {type: 'content', value: 'bat\n  qux:\n    qux'},
    ]);
  });

  it('tokenizes nested links', () => {
    let tokens = new FixtureTokenizer(
      'foo\n  bar -> foo/baz\nfoo/baz -> bat\n  bat -> foo',
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bar'},
      {type: 'link', value: 'foo/baz'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'baz'},
      {type: 'link', value: 'bat'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bat'},
      {type: 'link', value: 'foo'},
    ]);
  });

  it('tokenizes multiline file contents', () => {
    let tokens = new FixtureTokenizer(dedentRaw`
      app
        foo.js:
          export function foo() {
            return "foo";
          }
        bar.js:
          import foo from "foo";

          export function bar() {
            return \`\${foo()} bar\`;
          }
        `).tokenize();

    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'app'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'foo.js'},
      {type: 'content', value: 'export function foo() {\n  return "foo";\n}'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bar.js'},
      {
        type: 'content',
        value:
          'import foo from "foo";\n\nexport function bar() {\n  return `${foo()} bar`;\n}',
      },
    ]);
  });

  it('tokenizes windows paths', () => {
    let tokens = new FixtureTokenizer(dedentRaw`
      foo\\bar
        bat:
        baz -> foo\\bar\\bat
    `).tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bat'},
      {type: 'content', value: ''},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'baz'},
      {type: 'link', value: 'foo/bar/bat'},
    ]);
  });
  it('ignores empty lines after dirnames', () => {
    let tokens = new FixtureTokenizer(`lib\n  \n  \n  nested`).tokenize();

    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'lib'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'nested'},
    ]);
  });

  it('ignores empty lines after links', () => {
    let tokens = new FixtureTokenizer(`lib -> ./lib2\n \nlib2`).tokenize();

    assert.deepEqual(tokens, [
      {type: 'filename', value: 'lib'},
      {type: 'link', value: './lib2'},
      {type: 'dirname', value: 'lib2'},
    ]);
  });

  it('ignores empty lines after file content', () => {
    let tokens = new FixtureTokenizer(
      `file:\n  \n  content\n\n  \ndir`,
    ).tokenize();

    assert.deepEqual(tokens, [
      {type: 'filename', value: 'file'},
      {type: 'content', value: 'content'},
      {type: 'dirname', value: 'dir'},
    ]);
  });
});

describe('FixtureParser', () => {
  it('errors on a filename without content or link', () => {
    let result = new FixtureParser([{type: 'filename', value: 'foo'}]);
    assert.throws(() => result.parse(), /Expected content or link token/);
  });

  it('errors on content or link without preceeding filename', () => {
    let result = new FixtureParser([{type: 'content', value: ''}]);
    assert.throws(() => result.parse(), /Unexpected content token/);
    result = new FixtureParser([{type: 'link', value: 'foo'}]);
    assert.throws(() => result.parse(), /Unexpected link token/);
  });

  it('errors on invalid nesting', () => {
    let result = new FixtureParser([
      {type: 'filename', value: 'foo'},
      {type: 'content', value: ''},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Invalid nesting/);

    result = new FixtureParser([
      {type: 'filename', value: 'foo'},
      {type: 'link', value: 'bar'},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Invalid nesting/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Invalid nesting/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bar'},
      {type: 'link', value: 'foo/bat'},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Invalid nesting/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: ''},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Invalid nesting/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Unexpected indent/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'nest', value: '/'},
    ]);
    assert.throws(() => result.parse(), /Unexpected segment/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'nest', value: '/'},
    ]);
    assert.throws(() => result.parse(), /Unexpected segment/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
    ]);
    assert.throws(() => result.parse(), /Unexpected undefined/);

    result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
    ]);
    assert.throws(() => result.parse(), /Unexpected undefined/);
  });

  it('parses a dirname', () => {
    let result = new FixtureParser([{type: 'dirname', value: 'foo'}]).parse();

    let expected = new FixtureRoot();
    expected.children.push(new FixtureDir('foo'));

    assert.deepEqual(result, expected);
  });

  it('parses a filename', () => {
    // foo: "bar"
    let result = new FixtureParser([
      {type: 'filename', value: 'foo'},
      {type: 'content', value: 'bar'},
    ]).parse();

    let expected = new FixtureRoot();
    expected.children.push(new FixtureFile('foo', 'bar'));

    assert.deepEqual(result, expected);
  });

  it('parses a link', () => {
    // foo -> bar
    let result = new FixtureParser([
      {type: 'filename', value: 'foo'},
      {type: 'link', value: 'bar'},
    ]).parse();

    let expected = new FixtureRoot();
    expected.children.push(new FixtureLink('foo', 'bar'));

    assert.deepEqual(result, expected);
  });

  it('parses nested dirs', () => {
    // foo
    // bar
    //   bat
    //   bat/baz
    //     qux
    //   quux
    let result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'baz'},
      {type: 'nest', value: ''},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'qux'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'quux'},
    ]).parse();

    let expected = new FixtureRoot();
    let bar, bat, baz;
    expected.children.push(new FixtureDir('foo'));
    expected.children.push((bar = new FixtureDir('bar')));
    bar.children.push(new FixtureDir('bat'));
    bar.children.push((bat = new FixtureDir('bat')));
    bat.children.push((baz = new FixtureDir('baz')));
    baz.children.push(new FixtureDir('qux'));
    bar.children.push(new FixtureDir('quux'));

    assert.deepEqual(result, expected);
  });

  it('parses nested files and links', () => {
    // foo
    //   bar: "bar"
    //   bat
    //     qux -> qux
    //   bat/qux: "qux"
    // foo/bar -> foo/bat
    let result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: 'bar'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: ''},
      {type: 'nest', value: ''},
      {type: 'filename', value: 'qux'},
      {type: 'link', value: 'qux'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'qux'},
      {type: 'content', value: 'qux'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bar'},
      {type: 'link', value: 'foo/bat'},
    ]).parse();

    let expected = new FixtureRoot();
    let foo, bat;

    expected.children.push((foo = new FixtureDir('foo')));
    foo.children.push(new FixtureFile('bar', 'bar'));
    foo.children.push((bat = new FixtureDir('bat')));
    bat.children.push(new FixtureLink('qux', 'qux'));
    foo.children.push((bat = new FixtureDir('bat')));
    bat.children.push(new FixtureFile('qux', 'qux'));
    expected.children.push((foo = new FixtureDir('foo')));
    foo.children.push(new FixtureLink('bar', 'foo/bat'));

    assert.deepEqual(result, expected);
  });

  it('parses a leading /', () => {
    // /foo
    //   bar
    // /bat
    //   /baz/qux
    let result = new FixtureParser([
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: ''},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'baz'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'qux'},
    ]).parse();

    let expected = new FixtureRoot();
    let foo, bar, bat, baz;
    expected.children.push((foo = new FixtureDir('foo')));
    foo.children.push((bar = new FixtureDir('bar')));
    bar.children.push((bat = new FixtureDir('bat')));
    bat.children.push((baz = new FixtureDir('baz')));
    baz.children.push(new FixtureDir('qux'));

    assert.deepEqual(result, expected);
  });
});

describe('fsFixture', () => {
  let fs;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@atlaspack/core/src/worker.js'),
    });
    fs = new MemoryFS(workerFarm);
  });

  afterEach(async () => {
    await workerFarm.end();
  });

  it('applies a fixture with nesting and overwriting', async () => {
    await fsFixture(fs)`
      foo
        bar: bar
        bat
          qux -> qux
        bat/qux: qux
      foo/bar -> foo/bat
    `;

    assert.equal(fs.realpathSync('foo/bar'), path.resolve('/foo/bat'));
    assert(fs.readFileSync('foo/bat/qux', 'utf8'), 'qux');
    assert(fs.readFileSync('foo/bar/qux', 'utf8'), 'qux');
  });

  it('applies a fixture with expressions', async () => {
    await fsFixture(fs)`
      app
        yarn.lock:
        node_modules
          .bin
            atlaspack -> ${path.resolve(
              __dirname,
              '../../atlaspack/src/bin.js',
            )}
          atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          @atlaspack
            core -> ${path.resolve(__dirname, '../../core')}
        .atlaspackrc: ${{
          extends: '@atlaspack/config-default',
          transforms: ['atlaspack-transformer-custom', '...'],
        }}
    `;

    assert(fs.existsSync('/app'));

    assert.equal(fs.readFileSync('/app/yarn.lock', 'utf8'), '');

    assert.equal(
      fs.readFileSync('/app/.atlaspackrc', 'utf8'),
      JSON.stringify({
        extends: '@atlaspack/config-default',
        transforms: ['atlaspack-transformer-custom', '...'],
      }),
    );

    assert(fs.existsSync('/app/node_modules'));

    assert.equal(
      fs.realpathSync('/app/node_modules/.bin/atlaspack'),
      path.resolve(__dirname, '../../atlaspack/src/bin.js'),
    );

    assert.equal(
      fs.realpathSync('/app/node_modules/atlaspack'),
      path.resolve(__dirname, '../../atlaspack'),
    );

    assert.equal(
      fs.realpathSync('/app/node_modules/@atlaspack/core'),
      path.resolve(__dirname, '../../core'),
    );
  });

  it('applies a fixture with multiline file contents', async () => {
    await fsFixture(fs)`
      app
        foo.js:
          export function foo() {
            return "foo";
          }
        bar.js:
          import foo from "foo";

          export function bar() {
            return \`\${foo()} bar\`
          }`;

    assert.equal(
      fs.readFileSync('/app/foo.js', 'utf8'),
      `export function foo() {\n  return "foo";\n}`,
    );

    assert.equal(
      fs.readFileSync('/app/bar.js', 'utf8'),
      `import foo from "foo";\n\nexport function bar() {\n  return \`\${foo()} bar\`\n}`,
    );
  });

  it('applies a fixture with windows paths', async () => {
    await fsFixture(fs)`
      foo\\bar
        bat:
        baz -> D:\\foo\\bar\\bat`;

    assert(fs.existsSync('/foo/bar/bat'));
    assert.equal(fs.realpathSync('/foo/bar/baz'), path.resolve('/foo/bar/bat'));
  });
});

describe('toFixture', () => {
  let fs;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@atlaspack/core/src/worker.js'),
    });
    fs = new MemoryFS(workerFarm);
  });

  afterEach(async () => {
    await workerFarm.end();
  });

  it('errors for invalid cwd', async () => {
    await fs.mkdirp('/foo');
    await fs.writeFile('/foo/bar', 'bar');
    await fs.symlink('/foo/bar', '/foo/bat');

    // $FlowFixMe[prop-missing]
    assert.rejects(() => toFixture(fs, '/bar'), /bar does not exist/);

    // $FlowFixMe[prop-missing]
    assert.rejects(() => toFixture(fs, '/foo/bar'), /to be a directory/);

    // $FlowFixMe[prop-missing]
    assert.rejects(() => toFixture(fs, '/foo/bat'), /to be a directory/);
  });

  it('creates a fixture from an fs', async () => {
    await fs.mkdirp('/foo');
    await fs.writeFile('/foo/bar', 'bar');
    await fs.symlink('/foo/bar', '/foo/bat');

    let fixture = await toFixture(fs);

    assert.deepEqual(fixture, {
      type: 'root',
      children: [
        {
          type: 'dir',
          name: 'foo',
          children: [
            {type: 'file', name: 'bar', content: 'bar'},
            {type: 'link', name: 'bat', target: '/foo/bar'},
          ],
        },
      ],
    });

    assert.equal(fixture.toString(), `foo\n  bar:\n    bar\n  bat -> /foo/bar`);
  });

  it('creates a fixture from an fs with a cwd', async () => {
    await fs.mkdirp('/foo');
    await fs.writeFile('/foo/bar', 'bar');
    await fs.symlink('/foo/bar', '/foo/bat');

    let fixture = await toFixture(fs, 'foo');

    assert.deepEqual(fixture, {
      type: 'root',
      children: [
        {type: 'file', name: 'bar', content: 'bar'},
        {type: 'link', name: 'bat', target: '/foo/bar'},
      ],
    });

    assert.equal(fixture.toString(), `bar:\n  bar\nbat -> /foo/bar`);
  });

  it('includes the directory name in the fixture', async () => {
    await fs.mkdirp('/foo');
    await fs.writeFile('/foo/bar', 'bar');
    await fs.symlink('/foo/bar', '/foo/bat');

    let fixture = await toFixture(fs, 'foo', true);

    assert.deepEqual(fixture, {
      type: 'root',
      children: [
        {
          type: 'dir',
          name: 'foo',
          children: [
            {type: 'file', name: 'bar', content: 'bar'},
            {type: 'link', name: 'bat', target: '/foo/bar'},
          ],
        },
      ],
    });

    assert.equal(fixture.toString(), `foo\n  bar:\n    bar\n  bat -> /foo/bar`);
  });
});
