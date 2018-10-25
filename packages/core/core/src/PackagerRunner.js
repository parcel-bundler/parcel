'use strict';
const Cache = require('@parcel/cache');
const {mkdirp} = require('@parcel/fs');
const path = require('path');

class PackagerRunner {
  constructor({parcelConfig, cliOpts}) {
    this.parcelConfig = parcelConfig;
    this.cache = new Cache({parcelConfig, cliOpts});
    this.dirExists = false;
  }

  async loadPackager() {
    return require('@parcel/packager-js');
  }

  async runPackager({bundle}) {
    let packager = await this.loadPackager();

    let modulesContents = await Promise.all(
      bundle.assets.map(async asset => {
        // let fileContents = await packager.readFile({
        //   filePath: asset.code,
        // });
        let blobs = await this.cache.readBlobs(asset);

        let result = await packager.asset({blobs});

        return result;
      })
    );

    let packageFileContents = await packager.package(modulesContents);

    if (!this.dirExists) {
      await mkdirp(path.dirname(bundle.destPath));
      this.dirExists = true;
    }

    await packager.writeFile({
      filePath: bundle.destPath,
      fileContents: packageFileContents
    });
  }
}

module.exports = PackagerRunner;
