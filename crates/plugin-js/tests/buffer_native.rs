//! Node Buffer compatibility vectors for the native bulk-codec helpers.

use std::{collections::HashMap, sync::Arc};

use parcel_core::{FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{require_source, with_js_env};

#[test]
fn native_codecs_preserve_buffer_semantics() {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  with_js_env(fs, &HashMap::new(), cwd, |ctx| {
    require_source(
      ctx,
      "/buffer_native_test.js",
      r#"
        const {Buffer} = require('buffer');
        const equal = (actual, expected, label) => {
          if (actual !== expected) throw new Error(label + ': ' + actual + ' !== ' + expected);
        };

        for (const [plain, encoded] of [
          ['', ''], ['hello', 'aGVsbG8='], ['✓ à la mode', '4pyTIMOgIGxhIG1vZGU='],
          ['\x00\xff\x10', 'AP8Q']
        ]) {
          const input = plain === '\x00\xff\x10' ? Buffer.from([0, 255, 16]) : Buffer.from(plain);
          equal(input.toString('base64'), encoded, 'base64 encode');
          equal(Buffer.from(encoded, 'base64').toString('hex'), input.toString('hex'), 'base64 decode');
        }
        equal(Buffer.from(' aG\nk=ignored', 'base64').toString(), 'hi', 'base64 cleaning');
        equal(Buffer.from('-_8=', 'base64').toString('hex'), 'fbff', 'base64url alphabet');

        equal(Buffer.from('00ff10', 'hex').toString('hex'), '00ff10', 'hex round trip');
        equal(Buffer.from('1a7', 'hex').toString('hex'), '1a', 'odd hex truncation');
        equal(Buffer.from('1ag123', 'hex').toString('hex'), '1a', 'invalid hex truncation');
        equal(Buffer.from('00ff10', 'hex').toString('hex', 1, 3), 'ff10', 'hex range');

        equal(Buffer.compare(Buffer.from([0, 1]), Buffer.from([0, 2])), -1, 'compare less');
        equal(Buffer.compare(Buffer.from([2]), new Uint8Array([2])), 0, 'compare equal');
        equal(Buffer.compare(new Uint8Array([3]), Buffer.from([2])), 1, 'compare greater');
        if (!Buffer.isBuffer(Buffer.from('ab', 'hex'))) throw new Error('native hex lost Buffer prototype');
      "#,
    )?;
    Ok(())
  })
  .unwrap();
}
