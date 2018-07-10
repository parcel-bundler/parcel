// @flow
import test from 'ava';
import path from 'path';
import Resolver from '../src/Resolver';
import fixtures from 'fixturez';

const f = fixtures(__dirname, { root: __dirname });

test('Resolver.resolve', async t => {
  let fixture = f.find('simple');
  let sourcePath = path.join(fixture, 'source.js');
  let targetPath = path.join(fixture, 'target.js');

  let resolver = new Resolver();
  let resolved = await resolver.resolve(sourcePath, './target');

  t.is(resolved, targetPath);
});

test('Resolver.resolve - absolute', async t => {
  let fixture = f.find('simple');
  let sourcePath = path.join(fixture, 'source.js');
  let targetPath = path.join(fixture, 'target.js');

  let resolver = new Resolver();
  let resolved = await resolver.resolve(sourcePath, '/target', {
    rootDir: fixture,
  });

  t.is(resolved, targetPath);
});

test('Resolver.resolve - module', async t => {
  let fixture = f.find('module-default-index');
  let sourcePath = path.join(fixture, 'source.js');
  let targetPath = path.join(fixture, 'node_modules', 'target', 'index.js');

  let resolver = new Resolver();
  let resolved = await resolver.resolve(sourcePath, 'target');

  t.is(resolved, targetPath);
});
