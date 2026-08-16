//! Compatibility tests for the intentionally limited native `crypto` builtin.
//!
//! Expected values were generated with Node.js 24. The tests exercise the public CommonJS API so
//! they cover native-module routing as well as the Rust primitives.

use std::{collections::HashMap, sync::Arc};

use parcel_core::{Environment, FileSystem, OsFileSystem, PathId};
use parcel_plugin_js::{create_runtime, require_source, with_js_env};

fn run(script: &str) {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  with_js_env(fs, &HashMap::new(), cwd, |ctx| {
    require_source(ctx, "/crypto_native_test.js", script)?;
    Ok(())
  })
  .unwrap();
}

#[test]
fn node_hash_and_hmac_vectors() {
  run(
    r#"
      const crypto = require('crypto');
      const vectors = [
        ['md5',       '900150983cd24fb0d6963f7d28e17f72'],
        ['sha1',      'a9993e364706816aba3e25717850c26c9cd0d89d'],
        ['sha224',    '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7'],
        ['sha256',    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        ['sha384',    'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed' +
                      '8086072ba1e7cc2358baeca134c825a7'],
        ['sha512',    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
                      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
      ];
      for (const [algorithm, expected] of vectors) {
        const hash = crypto.createHash(algorithm);
        if (hash.update('a') !== hash) throw new Error(algorithm + ' update identity');
        hash.update(Buffer.from('62', 'hex')).update(new Uint8Array([0x63]));
        const actual = hash.digest('hex');
        if (actual !== expected) throw new Error(algorithm + ': ' + actual);
        let threw = false;
        try { hash.digest('hex') } catch (_) { threw = true }
        if (!threw) throw new Error(algorithm + ' allowed a second digest');
      }

      const hmac = crypto.createHmac('sha256', 'key');
      if (hmac.update('The quick brown fox jumps over the lazy dog') !== hmac)
        throw new Error('Hmac update identity');
      const actual = hmac.digest('hex');
      const expected = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
      if (actual !== expected) throw new Error('hmac: ' + actual);
    "#,
  );
}

#[test]
fn encodings_views_random_and_supported_surface() {
  run(
    r#"
      const crypto = require('crypto');
      const source = new Uint8Array([0xff, 0x61, 0x62, 0x63, 0xee]);
      const view = new DataView(source.buffer, 1, 3);
      if (crypto.createHash('sha256').update(view).digest('hex') !==
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
        throw new Error('DataView byte range');
      if (crypto.createHash('sha256').update('616263', 'hex').digest('base64') !==
          'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
        throw new Error('hex/base64 encoding');

      const bytes = crypto.randomBytes(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error('randomBytes');
      let callbackCalled = false;
      if (crypto.randomBytes(4, (error, result) => {
        if (error || !Buffer.isBuffer(result) || result.length !== 4) throw new Error('random callback');
        callbackCalled = true;
      }) !== undefined || !callbackCalled) throw new Error('random callback shape');
      if (crypto.randomBytes(0, undefined).length !== 0) throw new Error('zero randomBytes');
      for (const invalid of [-1, 1.5, '4']) {
        let threw = false;
        try { crypto.randomBytes(invalid) } catch (_) { threw = true }
        if (!threw) throw new Error('randomBytes accepted ' + invalid);
      }

      for (let i = 0; i < 1000; i++) {
        const zeroBased = crypto.randomInt(7);
        if (!Number.isInteger(zeroBased) || zeroBased < 0 || zeroBased >= 7)
          throw new Error('randomInt(max) range');
        const ranged = crypto.randomInt(-11, -3);
        if (!Number.isInteger(ranged) || ranged < -11 || ranged >= -3)
          throw new Error('randomInt(min, max) range');
      }
      if (typeof crypto.randomInt(Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 2) !== 'number')
        throw new Error('randomInt safe integer boundary');
      if (typeof crypto.randomInt(10, undefined) !== 'number')
        throw new Error('randomInt undefined callback');
      let randomIntCallbackCalled = false;
      if (crypto.randomInt(5, 10, (error, value) => {
        if (error !== undefined || value < 5 || value >= 10) throw new Error('randomInt callback');
        randomIntCallbackCalled = true;
      }) !== undefined || !randomIntCallbackCalled) throw new Error('randomInt callback shape');
      for (const args of [[], [5, 5], [5, 4], [0, 2 ** 48], [1.5], ['4'], [1, 2, 3]]) {
        let threw = false;
        try { crypto.randomInt(...args) } catch (_) { threw = true }
        if (!threw) throw new Error('randomInt accepted ' + JSON.stringify(args));
      }

      const target = Buffer.alloc(10, 0);
      if (crypto.randomFillSync(target, 2, 4) !== target) throw new Error('randomFillSync identity');
      if (target[0] !== 0 || target[1] !== 0 || target[6] !== 0 || target[9] !== 0)
        throw new Error('randomFillSync range');

      const hashes = crypto.getHashes();
      for (const name of ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'])
        if (!hashes.includes(name)) throw new Error('missing hash ' + name);

      for (const unsupported of ['createCipher', 'createSign', 'createDiffieHellman'])
        if (unsupported in crypto) throw new Error('unexpected unsupported API: ' + unsupported);
      for (const supported of ['randomBytes', 'randomInt'])
        if (typeof crypto[supported] !== 'function') throw new Error('missing ' + supported);
    "#,
  );
}

#[test]
fn minimal_webcrypto_random_api() {
  run(
    r#"
      const nodeCrypto = require('crypto');
      const webcrypto = globalThis.crypto;
      if (webcrypto !== nodeCrypto.webcrypto) throw new Error('webcrypto identity');
      if ('subtle' in webcrypto) throw new Error('unexpected subtle API');
      if (Object.keys(webcrypto).sort().join(',') !== 'getRandomValues,randomUUID')
        throw new Error('unexpected webcrypto surface: ' + Object.keys(webcrypto));
      if (typeof webcrypto.getRandomValues !== 'function' ||
          typeof webcrypto.randomUUID !== 'function') throw new Error('missing random API');

      for (const TypedArray of [
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, BigInt64Array, BigUint64Array
      ]) {
        const value = new TypedArray(8);
        if (webcrypto.getRandomValues(value) !== value)
          throw new Error(TypedArray.name + ' identity');
      }

      const storage = new Uint8Array(12);
      const view = new Uint16Array(storage.buffer, 2, 4);
      webcrypto.getRandomValues(view);
      if (storage[0] !== 0 || storage[1] !== 0 || storage[10] !== 0 || storage[11] !== 0)
        throw new Error('getRandomValues wrote outside the view');

      for (const invalid of [new Float32Array(2), new Float64Array(2), new DataView(new ArrayBuffer(2)), new ArrayBuffer(2)]) {
        let threw = false;
        try { webcrypto.getRandomValues(invalid); } catch (error) { threw = error instanceof TypeError; }
        if (!threw) throw new Error('accepted ' + invalid.constructor.name);
      }
      webcrypto.getRandomValues(new Uint8Array(65536));
      let oversizedThrew = false;
      try { webcrypto.getRandomValues(new Uint8Array(65537)); }
      catch (error) { oversizedThrew = error.name === 'QuotaExceededError'; }
      if (!oversizedThrew) throw new Error('accepted more than 65536 bytes');

      const uuid = webcrypto.randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid))
        throw new Error('invalid UUID v4: ' + uuid);
      if (uuid === webcrypto.randomUUID()) throw new Error('UUID repeated');
    "#,
  );
}

#[test]
fn webcrypto_is_available_in_browser_environments() {
  let fs: Arc<dyn FileSystem> = Arc::new(OsFileSystem {});
  let cwd = PathId::new(&std::env::current_dir().unwrap());
  let env = create_runtime(fs, &HashMap::new(), cwd, Environment::Browser).unwrap();
  env
    .with(|ctx| {
      ctx.eval::<(), _>(
        r#"
          if (typeof globalThis.crypto !== 'object') throw new Error('missing crypto global');
          const bytes = new Uint8Array(4);
          if (crypto.getRandomValues(bytes) !== bytes) throw new Error('identity');
          if (!/^[0-9a-f-]{36}$/.test(crypto.randomUUID())) throw new Error('UUID');
        "#,
      )
    })
    .unwrap();
}
