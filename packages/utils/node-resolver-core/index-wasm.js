/* eslint-disable no-undef */
const {Environment, napi} = require('napi-wasm');
const fs = require('fs');
const path = require('path');

module.exports.Resolver = undefined;
module.exports.init = async function init(input) {
  if (module.exports.Resolver == null) {
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
    module.exports.Resolver = env.exports.Resolver;
  }
};
