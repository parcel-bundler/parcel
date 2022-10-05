#! /usr/bin/env node
// @flow strict-local

function unlink() {
  throw new Error('Not implemented');
}

module.exports = unlink;

if (require.main === module) {
  unlink();
}
