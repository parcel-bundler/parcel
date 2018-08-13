// @flow
'use strict';

class PackagerRunner {
  async loadPackager() {
    return require('@parcel/packager-js');
  }

  async runPackager({ bundle }) {
    let packager = await this.loadPackager();

    let modulesContents = await Promise.all(bundle.assets.map(async asset => {
      let fileContents = await packager.readFile({
        filePath: asset.filePath,
      });

      let result = await packager.asset({
        asset,
        fileContents,
      });

      return result;
    }));

    let packageFileContents = await packager.package({
      contents: modulesContents,
    });

    await packager.writeFile({
      filePath: bundle.destPath,
      fileContents: packageFileContents,
    });
  }
}

module.exports = PackagerRunner;
