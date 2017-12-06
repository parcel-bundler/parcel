// @flow
require('v8-compile-cache');
const fs = require('./utils/fs');
const Parser = require('./Parser');
const babel = require('./transforms/babel');
import type {ParserOptions} from './Parser';

let parser;

function emit(event, ...args) {
  if (process.send) {
    process.send({event, args});
  }
}

exports.init = function(options: ParserOptions, callback: () => mixed) {
  parser = new Parser(options || {});
  callback();
};

exports.run = async function(
  path: string,
  pkg: any,
  options: Object,
  callback: Function
) {
  try {
    var asset = parser.getAsset(path, pkg, options);
    await asset.process();

    callback(null, {
      dependencies: Array.from(asset.dependencies.values()),
      generated: asset.generated,
      hash: asset.hash
    });
  } catch (err) {
    if (asset) {
      err = asset.generateErrorMessage(err);
    }

    err.fileName = path;
    callback(err);
  }
};
