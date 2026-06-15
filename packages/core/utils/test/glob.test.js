// @flow

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {NodeFS} from '@parcel/fs';

import {glob, globSync, normalizeSeparators} from '../src';

/**
 * Create NodeFS that returns files in the reverse order.
 */
function createUnsortedFS(): NodeFS {
  let parcelFS = new NodeFS();

  let originalReaddirSync = parcelFS.readdirSync.bind(parcelFS);
  let originalReaddir = parcelFS.readdir.bind(parcelFS);

  parcelFS.readdirSync = (dir, opts) => {
    let entries = originalReaddirSync(dir, opts);
    return entries.slice().reverse();
  };

  parcelFS.readdir = async (dir, opts) => {
    let entries = await originalReaddir(dir, opts);
    return entries.slice().reverse();
  };

  return parcelFS;
}

async function setupFixture<T>(fn: (root: string) => Promise<T>): Promise<T> {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-glob-test-'));

  try {
    fs.mkdirSync(path.join(root, 'nested'), {recursive: true});
    fs.writeFileSync(path.join(root, 'nested', 'd.txt'), 'd');
    fs.writeFileSync(path.join(root, 'nested', 'c.txt'), 'c');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    return await fn(root);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

describe('glob', () => {
  it('globSync() should return results in stable order', async () => {
    await setupFixture(async root => {
      let result = globSync(
        path.join(root, '**/*.txt'),
        createUnsortedFS(),
        {},
      );

      assert.deepEqual(result.map(normalizeSeparators), [
        normalizeSeparators(path.join(root, 'a.txt')),
        normalizeSeparators(path.join(root, 'b.txt')),
        normalizeSeparators(path.join(root, 'nested', 'c.txt')),
        normalizeSeparators(path.join(root, 'nested', 'd.txt')),
      ]);
    });
  });

  it('glob() should return results in stable order', async () => {
    await setupFixture(async root => {
      let result = await glob(
        path.join(root, '**/*.txt'),
        createUnsortedFS(),
        {},
      );

      assert.deepEqual(result.map(normalizeSeparators), [
        normalizeSeparators(path.join(root, 'a.txt')),
        normalizeSeparators(path.join(root, 'b.txt')),
        normalizeSeparators(path.join(root, 'nested', 'c.txt')),
        normalizeSeparators(path.join(root, 'nested', 'd.txt')),
      ]);
    });
  });
});
