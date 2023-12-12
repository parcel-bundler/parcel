import {transform, transformStyleAttribute} from 'lightningcss-wasm';

export {default, browserslistToTargets} from 'lightningcss-wasm';

// Hydrate Uint8Array into Buffer

function transformWrapper(config) {
  let result = transform(config);
  return {
    ...result,
    code: Buffer.from(result.code),
    map: result.map ? Buffer.from(result.map) : result.map,
  };
}
function transformStyleAttributeWrapper(config) {
  let result = transformStyleAttribute(config);
  return {
    ...result,
    code: Buffer.from(result.code),
  };
}

export {
  transformWrapper as transform,
  transformStyleAttributeWrapper as transformStyleAttribute,
};
