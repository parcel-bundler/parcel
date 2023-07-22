/* eslint-disable no-undef */
const {Environment, napi} = require('napi-wasm');

module.exports.Resolver = undefined;
module.exports.init = async function init(input) {
  if (module.exports.Resolver == null) {
    // input = input ?? new URL('parcel_resolver_node.wasm', import.meta.url);
    // const {instance} = await WebAssembly.instantiateStreaming(fetch(input), {
    //   env: napi,
    // });

    input =
      input ?? require('path').join(__dirname, 'parcel_node_bindings.wasm');
    const {instance} = await WebAssembly.instantiate(
      require('fs').readFileSync(input),
      {
        env: napi,
      },
    );

    for (let key in instance.exports) {
      if (key.startsWith('__napi_register__')) {
        instance.exports[key]();
      }
    }

    let env = new Environment(instance);
    Object.assign(module.exports, env.exports);
  }
};
