/* eslint-disable no-undef */
import {Environment, napi} from 'napi-wasm';
import fs from 'fs';
import path from 'path';

export let Resolver;

export default async function init(input) {
  if (Resolver == null) {
    input = input ?? path.join(__dirname, 'parcel_resolver_node.wasm');
    if (
      typeof input === 'string' ||
      (typeof Request === 'function' && input instanceof Request) ||
      (typeof URL === 'function' && input instanceof URL)
    ) {
      input = fs.readFileSync(input);
    }

    const {instance} = await WebAssembly.instantiate(await input, {
      env: napi,
    });

    for (let key in instance.exports) {
      if (key.startsWith('__napi_register__')) {
        instance.exports[key]();
      }
    }

    let env = new Environment(instance);
    Resolver = env.exports.Resolver;
  }
}
