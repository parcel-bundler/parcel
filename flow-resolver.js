#!/usr/bin/env node

// https://github.com/yarnpkg/yarn/blob/master/src/util/generate-pnp-map-api.tpl.js

const StringDecoder = require('string_decoder');
const {
  resolveSource
} = require('./packages/dev/babel-register/babel-plugin-module-translate.js');

function processRequest(data) {
  try {
    const [request, issuer] = JSON.parse(data);
    try {
      process.stdout.write(
        `${JSON.stringify([null, resolveSource(request, issuer)])}\n`
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify([{message: error.message}, null])}\n`
      );
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify([
        {code: `INVALID_JSON`, message: error.message},
        null
      ])}\n`
    );
  }
}

let buffer = '';
const decoder = new StringDecoder.StringDecoder();

process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk);

  do {
    const index = buffer.indexOf('\n');
    if (index === -1) {
      break;
    }

    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);

    processRequest(line);
    // eslint-disable-next-line no-constant-condition
  } while (true);
});
