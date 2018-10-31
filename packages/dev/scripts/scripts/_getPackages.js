/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

const fs = require('fs');
const path = require('path');

const PACKAGES_DIR = path.resolve(__dirname, '../../..');

// Get absolute paths of all directories under packages/*
module.exports = function getPackages() {
  return fs
    .readdirSync(PACKAGES_DIR)
    .map(pkg => {
      const dir = path.resolve(PACKAGES_DIR, pkg);

      return fs
        .readdirSync(dir)
        .map(file => path.resolve(dir, file))
        .filter(f => fs.lstatSync(path.resolve(f)).isDirectory());
    })
    .reduce((a, b) => a.concat(b));
};
