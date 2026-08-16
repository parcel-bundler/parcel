//! Compatibility coverage for the native zlib codec and its JS facade.
//!
//! The fixed byte sequences were produced by Node 24.0.0. Testing both
//! directions avoids relying only on native round trips, which can hide a
//! framing incompatibility shared by the encoder and decoder.

use std::{collections::HashMap, sync::Arc};

use parcel_core::{FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{require_source, with_js_env};

fn run(script: &str) {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  let script = format!(
    "try {{\n{script}\n}} catch (error) {{ throw String(error && (error.stack || error.message) || error); }}"
  );
  with_js_env(fs, &HashMap::new(), cwd, |ctx| {
    require_source(ctx, "/zlib_native_test.js", &script)?;
    Ok(())
  })
  .unwrap();
}

#[test]
fn decodes_node_generated_vectors() {
  run(
    r#"
      const z = require('zlib');
      const {Buffer} = require('buffer');
      const vectors = [
        [z.inflateSync, '789c4b4c4a0600024d0127'],
        [z.inflateRawSync, '4b4c4a0600'],
        [z.gunzipSync, '1f8b08000000000000034b4c4a0600c241243503000000'],
        [z.unzipSync, '1f8b08000000000000034b4c4a0600c241243503000000'],
        [z.unzipSync, '789c4b4c4a0600024d0127']
      ];
      for (const [decode, hex] of vectors) {
        const actual = decode(Buffer.from(hex, 'hex')).toString();
        if (actual !== 'abc') throw new Error('Node vector decoded as ' + actual);
      }
    "#,
  );
}

#[test]
fn all_formats_round_trip_and_accept_array_buffer_views() {
  run(
    r#"
      const z = require('zlib');
      const {Buffer} = require('buffer');
      const text = 'the quick brown fox jumps over the lazy dog '.repeat(64);
      const input = Buffer.from(text);
      const pairs = [
        [z.deflateSync, z.inflateSync],
        [z.deflateRawSync, z.inflateRawSync],
        [z.gzipSync, z.gunzipSync],
        [z.gzipSync, z.unzipSync],
        [z.deflateSync, z.unzipSync]
      ];
      for (const [encode, decode] of pairs) {
        const compressed = encode(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), {level: 9});
        const actual = decode(new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength));
        if (actual.toString() !== text) throw new Error('round trip mismatch');
      }
    "#,
  );
}

#[test]
fn callback_and_transform_facades_work() {
  run(
    r#"
      const z = require('zlib');
      const {Buffer} = require('buffer');
      let callbackResult;
      z.gzip('callback input', {level: 1}, (error, compressed) => {
        if (error) throw error;
        callbackResult = z.gunzipSync(compressed).toString();
      });
      if (callbackResult !== 'callback input') throw new Error('callback did not run');

      const gzip = z.createGzip({level: 1});
      const chunks = [];
      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => {
        const actual = z.gunzipSync(Buffer.concat(chunks)).toString();
        if (actual !== 'stream input') throw new Error('stream mismatch: ' + actual);
      });
      gzip.write('stream ');
      gzip.end('input');
    "#,
  );
}

#[test]
fn validates_options_and_caps_decompression_output() {
  run(
    r#"
      const z = require('zlib');
      const compressed = z.deflateSync('0123456789');
      if (z.inflateSync(z.deflateSync('defaults', {level: undefined}), {maxOutputLength: undefined}).toString() !== 'defaults') {
        throw new Error('undefined options did not use defaults');
      }
      let capped = false;
      try { z.inflateSync(compressed, {maxOutputLength: 9}); }
      catch (error) { capped = /maxOutputLength/.test(error.message); }
      if (!capped) throw new Error('maxOutputLength was not enforced');

      for (const options of [{level: 10}, {level: null}, {windowBits: 7}, {memLevel: 0}, {strategy: 5}, {maxOutputLength: 1.5}]) {
        let threw = false;
        try { z.deflateSync('x', options); } catch (_) { threw = true; }
        if (!threw) throw new Error('invalid options accepted: ' + JSON.stringify(options));
      }
    "#,
  );
}
