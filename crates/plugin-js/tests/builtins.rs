//! Smoke-tests every embedded node builtin inside the real QuickJS runtime.
//!
//! The fixture suite in `crates/parcel` doesn't reach these modules, so this
//! guards the minification step in `buildBuiltins.cjs`: a mangled name or an
//! over-aggressive compression pass would show up here.

use std::collections::HashMap;
use std::sync::Arc;

use parcel_core::{FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{require_source, with_js_env};

/// Each case is (label, script). The script must throw on failure.
const CASES: &[(&str, &str)] = &[
  (
    "assert",
    r#"const a = require('assert');
       a.equal(1, 1); a.deepEqual({x: [1, 2]}, {x: [1, 2]});
       let threw = false; try { a.equal(1, 2) } catch (e) { threw = true }
       if (!threw) throw new Error('assert.equal did not throw');"#,
  ),
  (
    "buffer",
    r#"const {Buffer} = require('buffer');
       const b = Buffer.from('hello world', 'utf8');
       if (b.toString('hex') !== '68656c6c6f20776f726c64') throw new Error('hex: ' + b.toString('hex'));
       if (Buffer.from('aGk=', 'base64').toString() !== 'hi') throw new Error('base64 decode');
       if (b.slice(0, 5).toString() !== 'hello') throw new Error('slice');"#,
  ),
  (
    "crypto (sha256/md5)",
    r#"const c = require('crypto');
       const h = c.createHash('sha256').update('abc').digest('hex');
       if (h !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('sha256: ' + h);
       const m = c.createHash('md5').update('abc').digest('hex');
       if (m !== '900150983cd24fb0d6963f7d28e17f72') throw new Error('md5: ' + m);"#,
  ),
  (
    "crypto (hmac)",
    r#"const c = require('crypto');
       const hm = c.createHmac('sha256', 'key').update('msg').digest('hex');
       if (hm.length !== 64) throw new Error('hmac len: ' + hm.length);"#,
  ),
  (
    "crypto (random)",
    r#"const c = require('crypto');
       const r = c.randomBytes(16);
       if (r.length !== 16) throw new Error('randomBytes len: ' + r.length);
       const i = c.randomInt(10, 20);
       if (i < 10 || i >= 20) throw new Error('randomInt range: ' + i);"#,
  ),
  (
    "stream",
    r#"const {Readable} = require('stream');
       const chunks = [];
       const r = new Readable({read() {}});
       r.on('data', d => chunks.push(d.toString()));
       r.push('a'); r.push('b'); r.push(null);
       if (chunks.join('') !== 'ab') throw new Error('stream: ' + chunks.join(''));"#,
  ),
  (
    "events",
    r#"const EventEmitter = require('events');
       const e = new EventEmitter(); let got = null;
       e.on('x', v => got = v); e.emit('x', 42);
       if (got !== 42) throw new Error('emitter: ' + got);
       if (EventEmitter.name !== 'EventEmitter') throw new Error('class name: ' + EventEmitter.name);"#,
  ),
  (
    "path",
    r#"const p = require('path');
       if (p.join('/a/b', '../c') !== '/a/c') throw new Error('join: ' + p.join('/a/b', '../c'));
       if (p.extname('x/y.tar.gz') !== '.gz') throw new Error('extname');
       if (p.resolve('/a', 'b') !== '/a/b') throw new Error('resolve');"#,
  ),
  (
    "querystring",
    r#"const qs = require('querystring');
       if (qs.stringify({a: 1, b: 'x y'}) !== 'a=1&b=x%20y') throw new Error('stringify: ' + qs.stringify({a: 1, b: 'x y'}));
       if (qs.parse('a=1&b=2').b !== '2') throw new Error('parse');"#,
  ),
  (
    "url",
    r#"const u = require('url');
       const parsed = u.parse('https://example.com:8080/p?q=1');
       if (parsed.hostname !== 'example.com') throw new Error('hostname: ' + parsed.hostname);
       if (parsed.port !== '8080') throw new Error('port: ' + parsed.port);"#,
  ),
  (
    "util",
    r#"const util = require('util');
       if (util.format('%s-%d', 'a', 3) !== 'a-3') throw new Error('format: ' + util.format('%s-%d', 'a', 3));
       function Base() {} function Derived() {}
       util.inherits(Derived, Base);
       if (!(new Derived() instanceof Base)) throw new Error('inherits');
       if (typeof util.inspect({a: 1}) !== 'string') throw new Error('inspect');"#,
  ),
  (
    "zlib (deflate/inflate)",
    r#"const z = require('zlib');
       const {Buffer} = require('buffer');
       const input = 'the quick brown fox jumps over the lazy dog';
       const out = z.inflateSync(z.deflateSync(Buffer.from(input))).toString();
       if (out !== input) throw new Error('roundtrip: ' + out);
       const gz = z.gunzipSync(z.gzipSync(Buffer.from(input))).toString();
       if (gz !== input) throw new Error('gzip roundtrip: ' + gz);"#,
  ),
  (
    "string_decoder",
    r#"const {StringDecoder} = require('string_decoder');
       const {Buffer} = require('buffer');
       const d = new StringDecoder('utf8');
       const euro = Buffer.from('€', 'utf8');
       let s = d.write(euro.slice(0, 2)) + d.write(euro.slice(2));
       if (s !== '€') throw new Error('split utf8: ' + JSON.stringify(s));"#,
  ),
  (
    "punycode",
    r#"const p = require('punycode');
       if (p.toASCII('münchen.de') !== 'xn--mnchen-3ya.de') throw new Error('toASCII: ' + p.toASCII('münchen.de'));"#,
  ),
  (
    "os / tty / constants",
    r#"const os = require('os'); const tty = require('tty'); const c = require('constants');
       if (typeof os.EOL !== 'string') throw new Error('os.EOL');
       if (typeof tty.isatty !== 'function') throw new Error('tty.isatty');
       if (typeof c.O_RDONLY !== 'number') throw new Error('constants.O_RDONLY');"#,
  ),
];

#[test]
fn embedded_builtins_work() {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let env_vars: HashMap<String, String> = HashMap::new();
  let cwd = PathId::new(&std::env::current_dir().unwrap());

  let mut passed = 0;
  let mut failed = Vec::new();

  for (index, (label, script)) in CASES.iter().enumerate() {
    let filename = format!("/verify_builtins_{index}.js");
    let result = with_js_env(fs.clone(), &env_vars, cwd, |ctx| {
      require_source(ctx, &filename, script)?;
      Ok(())
    });
    match result {
      Ok(()) => {
        passed += 1;
        println!("  ok    {label}");
      }
      Err(diagnostics) => {
        println!("  FAIL  {label}");
        let mut buf = Vec::new();
        diagnostics.report(&mut buf).unwrap();
        println!("{}", String::from_utf8_lossy(&buf));
        failed.push(*label);
      }
    }
  }

  assert!(
    failed.is_empty(),
    "{} of {} builtins failed: {}",
    failed.len(),
    CASES.len(),
    failed.join(", ")
  );
  assert_eq!(passed, CASES.len());
}
