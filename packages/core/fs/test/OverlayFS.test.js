// @flow

import {OverlayFS} from '../src/OverlayFS';
import {fsFixture} from '@parcel/test-utils/src/fsFixture';
import {MemoryFS} from '../src/MemoryFS';
import WorkerFarm from '@parcel/workers';

import assert from 'assert';
import path from 'path';

describe('OverlayFS', () => {
  let underlayFS;
  let fs;
  let workerFarm;

  beforeEach(() => {
    workerFarm = new WorkerFarm({
      workerPath: require.resolve('@parcel/core/src/worker.js'),
    });
    underlayFS = new MemoryFS(workerFarm);
    fs = new OverlayFS(workerFarm, underlayFS);
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

  it('copies on write with dir', async () => {
    await fsFixture(underlayFS)`
      foo/foo: foo
    `;

    assert.equal(fs.readFileSync('foo/foo', 'utf8'), 'foo');

    await fs.writeFile('foo/bar', 'bar');

    assert.equal(fs.readFileSync('foo/bar', 'utf8'), 'bar');
    assert(!underlayFS.existsSync('foo/bar'));
  });

  it('copies on write when copying', async () => {
    await fsFixture(underlayFS)`
      foo: foo
    `;

    assert.equal(fs.readFileSync('foo', 'utf8'), 'foo');

    await fs.copyFile('foo', 'bar');
    assert.equal(fs.readFileSync('bar', 'utf8'), 'foo');
    assert(!underlayFS.existsSync('bar'));
  });

  it('copies on write when copying with dir', async () => {
    await fsFixture(underlayFS)`
      foo/foo: foo
      bar
    `;

    assert.equal(fs.readFileSync('foo/foo', 'utf8'), 'foo');

    await fs.copyFile('foo/foo', 'bar/bar');
    assert.equal(fs.readFileSync('bar/bar', 'utf8'), 'foo');
    assert(!underlayFS.existsSync('bar/bar'));
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
    assert.equal(fs.realpathSync('bar'), path.resolve('/foo'));
    assert(!underlayFS.existsSync('bar'));
  });

  it('tracks deletes', async () => {
    await fsFixture(underlayFS)`
      foo: bar
      baz -> foo`;

    assert(fs.existsSync('foo'));
    assert.equal(fs.realpathSync('baz'), path.resolve('/foo'));
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
    assert.equal(fs.realpathSync('baz'), path.resolve('/foo'));
    assert(fs._isSymlink('baz'));

    await fs.unlink('baz');

    assert(!fs._isSymlink('baz'));
    assert(!fs.existsSync('baz'));
    assert(fs.existsSync('foo'));
    assert(underlayFS.existsSync('foo'));
    assert(underlayFS.existsSync('baz'));
    assert.equal(underlayFS.realpathSync('baz'), path.resolve('/foo'));
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

  it('supports changing to a dir that is only on the readable fs', async () => {
    await fsFixture(underlayFS)`
      foo/bar: baz
    `;

    assert.equal(fs.cwd(), path.resolve('/'));
    fs.chdir('/foo');
    assert.equal(fs.cwd(), path.resolve('/foo'));
  });

  it('supports changing to a dir that is only on the writable fs', async () => {
    await fsFixture(underlayFS)`
      foo/bar: bar
    `;

    await fs.mkdirp('/bar');
    assert(!underlayFS.existsSync('/bar'));

    assert.equal(fs.cwd(), path.resolve('/'));
    fs.chdir('/bar');
    assert.equal(fs.cwd(), path.resolve('/bar'));
  });

  it('supports changing dir relative to cwd', async () => {
    await fsFixture(underlayFS)`
      foo/bar: bar
    `;

    assert.equal(fs.cwd(), path.resolve('/'));
    fs.chdir('foo');
    assert.equal(fs.cwd(), path.resolve('/foo'));
  });

  it('changes dir without changing underlying fs dir', async () => {
    await fsFixture(underlayFS)`
      foo/bar: baz
      foo/bat/baz: qux
    `;

    assert.equal(fs.cwd(), path.resolve('/'));
    assert.equal(underlayFS.cwd(), path.resolve('/'));

    fs.chdir('foo');

    assert.equal(fs.cwd(), path.resolve('/foo'));
    assert.equal(underlayFS.cwd(), path.resolve('/'));
  });

  it('errors when changing to a dir that does not exist on either fs', async () => {
    await fsFixture(underlayFS)`
      foo/bar: bar
    `;

    assert.throws(() => fs.chdir('/bar'), /ENOENT/);
  });

  it('errors when changing to a deleted dir', async () => {
    await fsFixture(underlayFS)`
      foo/bar: bar
    `;

    await fs.rimraf('foo');
    assert(!fs.existsSync('foo'));
    assert(underlayFS.existsSync('foo'));

    assert.throws(() => fs.chdir('/foo'), /ENOENT/);
  });
});
