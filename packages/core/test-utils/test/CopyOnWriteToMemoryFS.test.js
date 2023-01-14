// @flow

import {CopyOnWriteToMemoryFS} from '../src/CopyOnWriteToMemoryFS';
import {fsFixture} from '../src/fsFixture';
import {MemoryFS} from '@parcel/fs';
import WorkerFarm from '@parcel/workers';

import assert from 'assert';

describe('CopyOnWriteToMemoryFS', () => {
  let underlayFS;
  let fs;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@parcel/core/src/worker.js'),
    });
    underlayFS = new MemoryFS(workerFarm);
    fs = new CopyOnWriteToMemoryFS(workerFarm, underlayFS);
  });

  afterEach(async () => {
    await workerFarm.end();
  });

  it('copies on write', async () => {
    await fsFixture(underlayFS)`
      foo: foo
    `;

    assert.equal(fs.readFileSync('foo', 'utf8'), 'foo');

    await fs.writeFile('foo', 'bar');

    assert.equal(fs.readFileSync('foo', 'utf8'), 'bar');
    assert.equal(underlayFS.readFileSync('foo', 'utf8'), 'foo');
  });

  it('writes to memory', async () => {
    await fs.writeFile('foo', 'foo');

    assert.equal(fs.readFileSync('foo', 'utf8'), 'foo');
    assert(!underlayFS.existsSync('foo'));
  });

  it('symlinks in memory', async () => {
    await fsFixture(underlayFS)`
      foo: foo
    `;

    assert(fs.existsSync('foo'));

    await fs.symlink('foo', 'bar');

    assert.equal(fs.readFileSync('bar', 'utf8'), 'foo');
    assert.equal(underlayFS.readFileSync('foo', 'utf8'), 'foo');
    assert.equal(fs.realpathSync('bar'), '/foo');
    assert(!underlayFS.existsSync('bar'));
  });

  it('tracks deletes', async () => {
    await fsFixture(underlayFS)`
      foo: bar
      baz -> foo`;

    assert(fs.existsSync('foo'));
    assert.equal(fs.realpathSync('baz'), '/foo');
    assert(fs._isSymlink('baz'));

    await fs.rimraf('foo');

    assert(!fs.existsSync('foo'));
    assert(fs._isSymlink('baz'));
    assert(!fs.existsSync('baz'));
    assert(underlayFS.existsSync('foo'));
    assert(underlayFS.existsSync('baz'));
  });

  it('tracks unlinks', async () => {
    await fsFixture(underlayFS)`
      foo: bar
      baz -> foo`;

    assert(fs.existsSync('baz'));
    assert.equal(fs.realpathSync('baz'), '/foo');
    assert(fs._isSymlink('baz'));

    await fs.unlink('baz');

    assert(!fs._isSymlink('baz'));
    assert(!fs.existsSync('baz'));
    assert(fs.existsSync('foo'));
    assert(underlayFS.existsSync('foo'));
    assert(underlayFS.existsSync('baz'));
    assert.equal(underlayFS.realpathSync('baz'), '/foo');
  });

  it('tracks nested deletes', async () => {
    await fsFixture(underlayFS)`
      foo/bar: baz
      foo/bat/baz: qux
    `;

    assert(fs.existsSync('foo/bar'));
    assert(fs.existsSync('foo/bat/baz'));

    await fs.rimraf('foo');

    assert(!fs.existsSync('foo/bar'));
    assert(!fs.existsSync('foo/bat/baz'));
    assert(underlayFS.existsSync('foo/bar'));
    assert(underlayFS.existsSync('foo/bat/baz'));

    await fs.mkdirp('foo');

    assert(fs.existsSync('foo'));
    assert(!fs.existsSync('foo/bar'));
    assert(!fs.existsSync('foo/baz/bat'));

    await fs.mkdirp('foo/baz');
    assert(fs.existsSync('foo/baz'));
    assert(!fs.existsSync('foo/baz/bat'));
  });
});
