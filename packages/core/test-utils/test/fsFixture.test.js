// @flow

import {
  dedentRaw,
  fsFixture,
  FixtureParser,
  FixtureTokenizer,
  FixtureRoot,
  FixtureDir,
  FixtureFile,
  FixtureLink,
} from '../src/fsFixture';
import {MemoryFS} from '@parcel/fs';
import WorkerFarm from '@parcel/workers';

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
        bat/qux: "qux"
    `,
      'foo\n  bar: "bar"\nfoo/bar -> foo/bat\n  bat\n    qux - qux\n  bat/qux: "qux"',
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
      new FixtureTokenizer('foo: bar').tokenize();
    }, /Failed to match token/);

    assert.throws(() => {
      new FixtureTokenizer(': bar').tokenize();
    }, /Failed to match token/);

    assert.throws(() => {
      new FixtureTokenizer('foo\n:\n"bar"').tokenize();
    }, /Failed to match token/);
  });

  it('tokenizes a dirname', () => {
    let tokens = new FixtureTokenizer('foo  \nfoo/bar\n    bat').tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: '  '},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'bat'},
    ]);
  });

  it('tokenizes a file', () => {
    let tokens = new FixtureTokenizer(
      `foo: ""\nbar :"{"foo": "bar"}"`,
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'filename', value: 'foo'},
      {type: 'content', value: ''},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: '{"foo": "bar"}'},
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
      'foo\n  bar: ""\nfoo/baz/bat: ""\n    qux: ""',
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: ''},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'baz'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bat'},
      {type: 'content', value: ''},
      {type: 'nest', value: '  '},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'qux'},
      {type: 'content', value: ''},
    ]);
  });

  it('tokenizes nested links', () => {
    let tokens = new FixtureTokenizer(
      'foo\n  bar -> foo/baz\nfoo/baz -> bat\n  bat -> foo',
    ).tokenize();
    assert.deepEqual(tokens, [
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'bar'},
      {type: 'link', value: 'foo/baz'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'baz'},
      {type: 'link', value: 'bat'},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'bat'},
      {type: 'link', value: 'foo'},
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
    let result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'dirname', value: 'bar'},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '/'},
      {type: 'dirname', value: 'baz'},
      {type: 'nest', value: '  '},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'qux'},
    ]).parse();

    let expected = new FixtureRoot();
    let bar, bat;
    expected.children.push(new FixtureDir('foo'));
    expected.children.push((bar = new FixtureDir('bar')));
    bar.children.push(new FixtureDir('bat'));
    bar.children.push((bat = new FixtureDir('bat')));
    bat.children.push(new FixtureDir('baz'));
    bat.children.push(new FixtureDir('qux'));

    assert.deepEqual(result, expected);
  });

  it('parses nested files and links', () => {
    // foo
    //   bar: "bar"
    // foo/bar -> foo/bat
    //   bat
    //     qux -> qux
    //   bat/qux: "qux"
    let result = new FixtureParser([
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'bar'},
      {type: 'content', value: 'bar'},
      {type: 'dirname', value: 'foo'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'bar'},
      {type: 'link', value: 'foo/bat'},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '  '},
      {type: 'nest', value: '  '},
      {type: 'filename', value: 'qux'},
      {type: 'link', value: 'qux'},
      {type: 'nest', value: '  '},
      {type: 'dirname', value: 'bat'},
      {type: 'nest', value: '/'},
      {type: 'filename', value: 'qux'},
      {type: 'content', value: 'qux'},
    ]).parse();

    let expected = new FixtureRoot();
    let foo, bat;

    expected.children.push((foo = new FixtureDir('foo')));
    foo.children.push(new FixtureFile('bar', 'bar'));
    expected.children.push((foo = new FixtureDir('foo')));
    foo.children.push(new FixtureLink('bar', 'foo/bat'));
    foo.children.push((bat = new FixtureDir('bat')));
    bat.children.push(new FixtureLink('qux', 'qux'));
    foo.children.push((bat = new FixtureDir('bat')));
    bat.children.push(new FixtureFile('qux', 'qux'));

    assert.deepEqual(result, expected);
  });
});

describe('fsFixture', () => {
  let fs;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@parcel/core/src/worker.js'),
    });
    fs = new MemoryFS(workerFarm);
  });

  afterEach(async () => {
    await workerFarm.end();
  });

  it('applies a fixture with nesting and overwriting', async () => {
    await fsFixture(fs)`
      foo
        bar: "bar"
      foo/bar -> foo/bat
        bat
          qux -> qux
        bat/qux: "qux"
    `;

    assert(fs.readFileSync('foo/bat/qux', 'utf8'), 'qux');
    assert(fs.readFileSync('foo/bar/qux', 'utf8'), 'qux');
  });

  it('applies a fixture with expressions', async () => {
    await fsFixture(fs)`
      app
        yarn.lock: ""
        node_modules
          .bin
            parcel -> ${path.resolve(__dirname, '../../parcel/src/bin.js')}
          parcel -> ${path.resolve(__dirname, '../../parcel')}
          @parcel
            core -> ${path.resolve(__dirname, '../../core')}
        .parcelrc: "${{
          extends: '@parcel/config-default',
          transforms: ['parcel-transformer-custom', '...'],
        }}"
    `;

    assert(fs.existsSync('/app'));

    assert.equal(fs.readFileSync('/app/yarn.lock'), '');

    assert.equal(
      fs.readFileSync('/app/.parcelrc', 'utf8'),
      JSON.stringify({
        extends: '@parcel/config-default',
        transforms: ['parcel-transformer-custom', '...'],
      }),
    );

    assert(fs.existsSync('/app/node_modules'));

    assert.equal(
      fs.realpathSync('/app/node_modules/.bin/parcel'),
      path.resolve(__dirname, '../../parcel/src/bin.js'),
    );

    assert.equal(
      fs.realpathSync('/app/node_modules/parcel'),
      path.resolve(__dirname, '../../parcel'),
    );

    assert.equal(
      fs.realpathSync('/app/node_modules/@parcel/core'),
      path.resolve(__dirname, '../../core'),
    );
  });
});
