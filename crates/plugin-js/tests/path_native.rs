//! Node/path-browserify compatibility vectors for the native POSIX path builtin.

use std::{collections::HashMap, sync::Arc, time::Instant};

use parcel_core::{FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{require_source, with_js_env};

#[test]
fn matches_node_posix_vectors() {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  with_js_env(fs, &HashMap::new(), cwd, |ctx| {
    require_source(
      ctx,
      "/path_native_test.js",
      r#"
        const path = require('path');
        const assertEqual = (actual, expected, label) => {
          if (actual !== expected) throw new Error(label + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected));
        };

        for (const [input, expected] of [
          ['', '.'], ['.', '.'], ['..', '..'], ['../../a', '../../a'],
          ['./', './'], ['a/../', './'], ['a/../../', '../'],
          ['/a//b/../c/', '/a/c/'], ['//foo///bar', '/foo/bar'], ['/../a', '/a'],
          ['é//文/../😀/', 'é/😀/']
        ]) assertEqual(path.normalize(input), expected, 'normalize ' + input);

        for (const [args, expected] of [
          [['/a/b', '../c'], '/a/c'], [['/a', '/b', 'c'], '/b/c'],
          [['', '/a', '', 'b'], '/a/b'], [['/'], '/'],
          [['/a', '//b', '..', 'é'], '/é'], [['/😀', '文', '..', 'é'], '/😀/é']
        ]) assertEqual(path.resolve(...args), expected, 'resolve ' + args);

        for (const [args, expected] of [
          [[], '.'], [['', ''], '.'], [['/a', '../b'], '/b'],
          [['a', '.', 'b', '..', 'c/'], 'a/c/'], [['a', '../'], './'],
          [['é', '文', '..', '😀/'], 'é/😀/']
        ]) assertEqual(path.join(...args), expected, 'join ' + args);

        for (const [from, to, expected] of [
          ['/a/b/c', '/a/d/e', '../../d/e'], ['/a/b', '/a/b/c', 'c'],
          ['/a/b/c', '/a/b', '..'], ['/', '/a', 'a'], ['/a', '/', '..'],
          ['/é/文', '/é/😀', '../😀'], ['a/./b', 'a/b', '']
        ]) assertEqual(path.relative(from, to), expected, 'relative');

        for (const [input, expected] of [
          ['', '.'], ['file', '.'], ['/file', '/'], ['/a/b/', '/a'],
          ['a/b///', 'a'], ['a//b', 'a/'], ['//foo', '//'], ['///foo', '//'],
          ['///foo/bar', '///foo'], ['é/文', 'é']
        ]) assertEqual(path.dirname(input), expected, 'dirname ' + input);

        for (const [input, suffix, expected] of [
          ['/a/file.txt', undefined, 'file.txt'], ['/a/file.txt/', '.txt', 'file'],
          ['file.txt', 'file.txt', ''], ['////', undefined, ''], ['.bashrc', '.bashrc', ''],
          ['😀.txt', '.txt', '😀'], ['é', 'é', '']
        ]) assertEqual(path.basename(input, suffix), expected, 'basename ' + input);
        assertEqual(path.basename('/a/file.txt'), 'file.txt', 'basename omitted suffix');
        assertEqual(path.basename('/a/file.txt', undefined), 'file.txt', 'basename undefined suffix');
        let basenameTypeError = false;
        try { path.basename('file', null); } catch (error) { basenameTypeError = error instanceof TypeError; }
        if (!basenameTypeError) throw new Error('basename null suffix must throw TypeError');

        for (const [input, expected] of [
          ['index.html', '.html'], ['index.', '.'], ['.index', ''], ['.index.md', '.md'],
          ['index..', '.'], ['..', ''], ['...', '.'], ['/a/b/', ''],
          ['..a', '.a'], ['.a.', '.'], ['😀/é.文', '.文']
        ]) assertEqual(path.extname(input), expected, 'extname ' + input);

        assertEqual(path.format({dir: '/a/b', name: 'file', ext: '.txt'}), '/a/b/file.txt', 'format');
        assertEqual(path.format({root: '/', base: 'file'}), '/file', 'format root');
        // Preserve path-browserify/Node <=18 behavior: ext is concatenated verbatim.
        assertEqual(path.format({name: 'file', ext: 'txt'}), 'filetxt', 'format undotted ext');
        assertEqual(path.format({dir: '/', name: 'x', ext: 'txt'}), '//xtxt', 'format dir slash');
        assertEqual(path.format({dir: 'a/', base: 'b'}), 'a//b', 'format trailing dir slash');
        for (const [input, expected] of [
          ['/a/b/file.txt', {root:'/', dir:'/a/b', base:'file.txt', ext:'.txt', name:'file'}],
          ['.bashrc', {root:'', dir:'', base:'.bashrc', ext:'', name:'.bashrc'}],
          ['/', {root:'/', dir:'/', base:'', ext:'', name:''}],
          ['a/b/', {root:'', dir:'a', base:'b', ext:'', name:'b'}],
          ['/..', {root:'/', dir:'/', base:'..', ext:'.', name:'.'}],
          ['//..', {root:'/', dir:'/', base:'..', ext:'', name:'..'}],
          ['///a', {root:'/', dir:'//', base:'a', ext:'', name:'a'}],
          ['a//b//', {root:'', dir:'a/', base:'b', ext:'', name:'b'}],
          ['..a', {root:'', dir:'', base:'..a', ext:'.a', name:'.'}],
          ['😀/é.文', {root:'', dir:'😀', base:'é.文', ext:'.文', name:'é'}]
        ]) assertEqual(JSON.stringify(path.parse(input)), JSON.stringify(expected), 'parse ' + input);

        if (path.posix !== path || path.win32 !== null || path.sep !== '/' || path.delimiter !== ':')
          throw new Error('module identity/constants');
      "#,
    )?;
    Ok(())
  })
  .unwrap();
}

#[test]
#[ignore = "microbenchmark; run explicitly with --release"]
fn benchmark_native_path_resolve() {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  with_js_env(fs, &HashMap::new(), cwd, |ctx| {
    let start = Instant::now();
    require_source(
      ctx,
      "/path_native_benchmark.js",
      r#"
        const path = require('path');
        let total = 0;
        for (let i = 0; i < 100000; i++) {
          total += path.resolve('/a/b', '../c', String(i)).length;
        }
        if (total === 0) throw new Error('benchmark result was not consumed');
      "#,
    )?;
    eprintln!("native path.resolve x100000: {:?}", start.elapsed());
    Ok(())
  })
  .unwrap();
}
