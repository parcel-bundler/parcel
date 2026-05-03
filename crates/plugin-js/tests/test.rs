use std::{path::Path, sync::Arc};

use parcel_core::{FileSystem, OverlayFileSystem};
use parcel_plugin_js::create_runtime;

fn run(code: &str) {
  let fs = Arc::new(OverlayFileSystem::new());
  fs.write(Path::new("/test.txt"), &"test".as_bytes().to_owned())
    .expect("Error writing file");
  fs.write(Path::new("/test.mjs"), &code.as_bytes().to_owned())
    .expect("Error writing file");
  let ctx = create_runtime(fs).unwrap();
  ctx.with(|ctx| {
    let res = rquickjs::Module::import(&ctx, "/test.mjs".as_bytes().to_owned())
      .and_then(|p| p.finish::<rquickjs::Value>());
    match res {
      Ok(_) => {}
      Err(err) => {
        if err.is_exception() {
          let e = ctx.catch();
          let e = if let Some(exception) = e.as_exception() {
            exception.to_string()
          } else if let Some(message) = e.as_string() {
            message.to_string().unwrap_or_else(|e| e.to_string())
          } else {
            "Unknown error".into()
          };
          panic!("exception: {}", e);
        } else {
          panic!("error: {}", err);
        }
      }
    }
  })
}

#[test]
fn test_read_file_string() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.equal(fs.readFileSync('/test.txt', 'utf8'), 'test');
  "#,
  );
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.equal(fs.readFileSync('/test.txt', 'utf-8'), 'test');
  "#,
  );
}

#[test]
fn test_read_file_buffer() {
  run(
    r#"
    import fs from 'fs';
    import assert from 'assert';
    assert.deepEqual(fs.readFileSync('/test.txt'), new Uint8Array([...'test'].map(c => c.charCodeAt(0))));
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
