const {promisify} = require('@parcel/utils');

const rimraf = promisify(require('rimraf'));
const ncp = promisify(require('ncp'));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

exports.sleep = sleep;
exports.rimraf = rimraf;
exports.ncp = ncp;
