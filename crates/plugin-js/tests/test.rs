use std::{collections::HashMap, path::Path, sync::Arc};

use parcel_core::{FileSystem, OverlayFileSystem, PathId};
use parcel_plugin_js::create_runtime;

fn run(code: &str) {
  let fs = Arc::new(OverlayFileSystem::new());
  fs.create_dir_all(PathId::new(Path::new("/_parcel_test")))
    .expect("Error creating dir");
  fs.write(
    PathId::new(Path::new("/_parcel_test/test.txt")),
    &"test".as_bytes().to_owned(),
  )
  .expect("Error writing file");
  fs.write(
    PathId::new(Path::new("/test.mjs")),
    &code.as_bytes().to_owned(),
  )
  .expect("Error writing file");
  let ctx = create_runtime(
    fs,
    &HashMap::new(),
    PathId::new(&std::env::current_dir().unwrap()),
    parcel_core::Environment::Node,
  )
  .unwrap();
  let res = ctx.with(|ctx| {
    rquickjs::Module::import(&ctx, "/test.mjs".as_bytes().to_owned())
      .and_then(|p| p.finish::<rquickjs::Value>())?;
    Ok(())
  });
  if let Err(err) = res {
    panic!("{:?}", err);
  }
}

#[test]
fn test_read_file_sync_string() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.equal(fs.readFileSync('/_parcel_test/test.txt', 'utf8'), 'test');
  "#,
  );
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.equal(fs.readFileSync('/_parcel_test/test.txt', 'utf-8'), 'test');
  "#,
  );
}

#[test]
fn test_read_file_string() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    let called = false;
    fs.readFile('/_parcel_test/test.txt', 'utf8', (err, res) => {
      called = true;
      assert.equal(err, null);
      assert.equal(res, 'test');
    });
    assert.equal(called, true);
  "#,
  );
}

#[test]
fn test_read_file_promise_string() {
  run(
    r#"
    import fs from 'fs/promises';
    import assert from 'assert';
    assert.equal(await fs.readFile('/_parcel_test/test.txt', 'utf8'), 'test');
  "#,
  );
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.equal(await fs.promises.readFile('/_parcel_test/test.txt', 'utf8'), 'test');
  "#,
  );
}

#[test]
fn test_read_file_sync_buffer() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.deepEqual(fs.readFileSync('/_parcel_test/test.txt'), new Uint8Array([...'test'].map(c => c.charCodeAt(0))));
  "#,
  );
}

#[test]
fn test_read_file_promise_buffer() {
  run(
    r#"
    import fs from 'fs/promises';
    import assert from 'assert';
    assert.deepEqual(await fs.readFile('/_parcel_test/test.txt'), new Uint8Array([...'test'].map(c => c.charCodeAt(0))));
  "#,
  );
}

#[test]
fn test_read_file_buffer() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    let called = false;
    fs.readFile('/_parcel_test/test.txt', (err, res) => {
      called = true;
      assert.equal(err, null);
      assert.deepEqual(res, new Uint8Array([...'test'].map(c => c.charCodeAt(0))));
    });
    assert.equal(called, true);
  "#,
  );
}

#[test]
fn test_fs_stat_sync() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    let stat = fs.statSync('/_parcel_test/test.txt');
    assert.equal(stat.size, 4);
    assert.throws(() => fs.statSync('/_parcel_test/foo.txt'));
  "#,
  );
}

#[test]
fn test_fs_stat_promise() {
  run(
    r#"
    import fs from 'fs/promises';
    import assert from 'assert';
    let stat = await fs.stat('/_parcel_test/test.txt');
    assert.equal(stat.size, 4);
    assert.equal(await fs.stat('/_parcel_test/foo.txt').catch(() => 1), 1);
  "#,
  );
}

#[test]
fn test_fs_stat() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    let called = false;
    fs.stat('/_parcel_test/test.txt', (err, stat) => {
      called = true;
      assert.equal(err, null);
      assert.equal(stat.size, 4);
    });
    assert.equal(called, true);
    called = false;
    fs.stat('/_parcel_test/foo.txt', (err, stat) => {
      called = true;
      assert.equal(!!err, true);
      assert.equal(stat, null);
    });
    assert.equal(called, true);
  "#,
  );
}

#[test]
fn test_fs_readdir_sync() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    let dir = fs.readdirSync('/_parcel_test');
    assert.deepEqual(dir, ['test.txt']);

    let dir2 = fs.readdirSync('/_parcel_test', {withFileTypes: true});
    assert.equal(dir2.length, 1);
    assert.equal(dir2[0].name, 'test.txt');
    assert(dir2[0].isFile());
  "#,
  );
}

#[test]
fn test_fs_readdir_async() {
  run(
    r#"
    import fs from 'fs/promises';
    import assert from 'assert';
    let dir = await fs.readdir('/_parcel_test');
    assert.deepEqual(dir, ['test.txt']);

    let dir2 = await fs.readdir('/_parcel_test', {withFileTypes: true});
    assert.equal(dir2.length, 1);
    assert.equal(dir2[0].name, 'test.txt');
    assert(dir2[0].isFile());
  "#,
  );
}

#[test]
fn test_fs_readdir_callback() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';

    let called = false;
    fs.readdir('/_parcel_test', (err, dir) => {
      called = true;
      assert.equal(err, null);
      assert.deepEqual(dir, ['test.txt']);
    });
    assert.equal(called, true);

    called = false;
    fs.readdir('/_parcel_test', {withFileTypes: true}, (err, dir2) => {
      called = true;
      assert.equal(err, null);
      assert.equal(dir2.length, 1);
      assert.equal(dir2[0].name, 'test.txt');
      assert(dir2[0].isFile());
    });
    assert.equal(called, true);
  "#,
  );
}

#[test]
fn test_fs_async_missing_callback_throws() {
  // Calling the async fs functions without a callback (and without an
  // intermediate options/encoding argument) used to index an empty `Rest`
  // vec and panic. It should throw a normal JS exception instead.
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.throws(() => fs.readFile('/_parcel_test/test.txt'), /Required callback not provided/);
    assert.throws(() => fs.realpath('/_parcel_test/test.txt'), /Required callback not provided/);
    assert.throws(() => fs.readlink('/_parcel_test/test.txt'), /Required callback not provided/);
    assert.throws(() => fs.readdir('/_parcel_test'), /Required callback not provided/);
  "#,
  );
}

#[test]
fn test_text_decoder_invalid_utf8() {
  run(
    r#"
    import assert from 'assert';
    const decoder = new TextDecoder();
    const bytes = new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x21]); // "hi" + invalid bytes + "!"
    const result = decoder.decode(bytes);
    assert.equal(result, 'hi��!');
  "#,
  );
}

#[test]
fn test_url_path() {
  run(
    r#"
    import assert from 'assert';
    assert.equal(new URL('http://example.com/foo').pathname, '/foo');
    "#,
  )
}

#[test]
fn test_url_properties() {
  run(
    r#"
    import assert from 'assert';
    const u = new URL('https://user:pass@host:8080/path/name?query=1#frag');
    // href
    assert.equal(u.href, 'https://user:pass@host:8080/path/name?query=1#frag');
    // origin
    assert.equal(u.origin, 'https://host:8080');
    // protocol
    assert.equal(u.protocol, 'https:');
    u.protocol = 'http:';
    assert.equal(u.protocol, 'http:');
    assert.ok(u.href.startsWith('http:'));
    // username
    assert.equal(u.username, 'user');
    u.username = 'alice';
    assert.equal(u.username, 'alice');
    // password
    assert.equal(u.password, 'pass');
    u.password = 'secret';
    assert.equal(u.password, 'secret');
    // host
    assert.equal(u.host, 'host:8080');
    u.host = 'example.com:1234';
    assert.equal(u.host, 'example.com:1234');
    // hostname
    assert.equal(u.hostname, 'example.com');
    u.hostname = 'other.com';
    assert.equal(u.hostname, 'other.com');
    // port
    assert.equal(u.port, '1234');
    u.port = '4321';
    assert.equal(u.port, '4321');
    // pathname
    assert.equal(u.pathname, '/path/name');
    u.pathname = '/foo/bar';
    assert.equal(u.pathname, '/foo/bar');
    // search
    assert.equal(u.search, '?query=1');
    u.search = '?a=2&b=3';
    assert.equal(u.search, '?a=2&b=3');
    // hash
    assert.equal(u.hash, '#frag');
    u.hash = '#section';
    assert.equal(u.hash, '#section');
    "#,
  );
}

#[test]
fn test_url_searchparams() {
  run(
    r#"
    import assert from 'assert';
    const u = new URL('https://user:pass@host:8080/path/name?query=1#frag');
    const sp = u.searchParams;
    assert.ok(sp instanceof URLSearchParams);
    assert(u.searchParams === sp);
    assert.equal(sp.get('query'), '1');
    // set() on an absent key must append it (WHATWG), not no-op.
    sp.set('brandnew', 'v');
    assert.equal(sp.get('brandnew'), 'v');
    assert.deepEqual(sp.getAll('brandnew'), ['v']);
    sp.delete('brandnew');
    sp.append('foo', 'bar');
    assert.equal(sp.get('foo'), 'bar');
    sp.set('foo', 'baz');
    assert.equal(sp.get('foo'), 'baz');
    assert.deepEqual(sp.getAll('foo'), ['baz']);
    assert.ok(sp.has('foo'));
    sp.delete('foo');
    assert.ok(!sp.has('foo'));
    sp.append('a', '1');
    sp.append('b', '2');
    sp.append('a', '3');
    sp.sort();
    assert.deepEqual(sp.keys(), ['a', 'a', 'b', 'query']);
    assert.deepEqual(sp.values(), ['1', '3', '2', '1']);
    assert.deepEqual(sp.entries(), [['a','1'],['a','3'],['b','2'],['query','1']]);
    assert.equal(sp.toString(), 'a=1&a=3&b=2&query=1');
    assert.equal(u.toString(), 'https://user:pass@host:8080/path/name?a=1&a=3&b=2&query=1#frag');
    "#,
  );
}

#[test]
fn test_url_module() {
  run(
    r#"
    import url, {URL, URLSearchParams, fileURLToPath, pathToFileURL, parse} from 'url';
    import assert from 'assert';

    assert.equal(URL, globalThis.URL);
    assert.equal(URLSearchParams, globalThis.URLSearchParams);
    assert.equal(url.URL, URL);
    assert.equal(url.URLSearchParams, URLSearchParams);
    assert.equal(parse('https://example.com/a').hostname, 'example.com');

    const value = pathToFileURL('/tmp/a b.txt');
    assert.ok(value instanceof URL);
    assert.equal(value.href, 'file:///tmp/a%20b.txt');
    assert.equal(fileURLToPath(value), '/tmp/a b.txt');
    assert.equal(fileURLToPath('file:///tmp/a%20b.txt'), '/tmp/a b.txt');

    const cjs = require('url');
    assert.equal(cjs.URL, URL);
    assert.equal(cjs.URLSearchParams, URLSearchParams);
    assert.equal(cjs.fileURLToPath(cjs.pathToFileURL('/tmp/c d.txt')), '/tmp/c d.txt');
    assert.equal(cjs.format(cjs.parse('https://example.com/a')), 'https://example.com/a');
    "#,
  );
}

#[test]
fn test_atob() {
  run(
    r#"
    import assert from 'assert';
    assert.equal(atob('aGVsbG8='), 'hello');
    "#,
  );
}

#[test]
fn test_btoa() {
  run(
    r#"
    import assert from 'assert';
    assert.equal(btoa('hello'), 'aGVsbG8=');
    "#,
  );
}

#[test]
fn test_structured_clone() {
  run(
    r#"
    import assert from 'assert';
    assert.equal(typeof structuredClone, 'function');
    assert.equal(structuredClone(undefined), undefined);
    assert.equal(structuredClone(null), null);
    assert.equal(structuredClone(true), true);
    assert.equal(structuredClone(false), false);
    assert.equal(structuredClone(42), 42);
    assert.equal(1 / structuredClone(-0), -Infinity);
    assert.equal(1 / structuredClone(0), Infinity);
    assert.equal(structuredClone('hi'), 'hi');
    assert.equal(structuredClone(42n), 42n);

    let obj = { a: 1, b: 'hello' };
    assert.notEqual(structuredClone(obj), obj);
    assert.deepEqual(structuredClone(obj), obj);
    assert.deepEqual(structuredClone({a: {b: {c: 2}}}), {a: {b: {c: 2}}});
    assert.deepEqual(structuredClone([1, 2, [3, 4]]), [1, 2, [3, 4]]);
    assert.deepEqual(structuredClone(new Date(1234567890000)), new Date(1234567890000));
    assert.deepEqual(structuredClone(/123/i), /123/i);
    assert.deepEqual(structuredClone(new Map([['a', 'b'], ['c', 'd']])), new Map([['a', 'b'], ['c', 'd']]));

    let shared = {x: 42};
    obj = {a: shared, b: shared};
    let cloned = structuredClone(obj);
    assert.deepEqual(cloned, {a: shared, b: shared});
    assert.equal(cloned.a, cloned.b);
    "#,
  )
}
