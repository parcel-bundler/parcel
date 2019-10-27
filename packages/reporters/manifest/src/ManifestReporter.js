// @flow
import {Reporter} from '@parcel/plugin';
import path from 'path';

export default new Reporter({
  async report(event, options) {
    if (event.type === 'buildSuccess') {
      console.log('WRITING');
      let manifests = {};
      event.bundleGraph.traverseBundles(bundle => {
        let name = bundle.target.distDir;
        if (bundle.target.distEntry) {
          name = path.join(
            name,
            path.basename(
              bundle.target.distEntry,
              path.extname(bundle.target.distEntry) + '.parcel-manifest.json'
            )
          );
        } else {
          name = path.join(name, 'parcel-manifest.json');
        }

        if (!manifests[name]) {
          manifests[name] = {};
        }

        manifests[name][bundle.name] = bundle.getHash().slice(-8);
      });

      for (let name in manifests) {
        await options.outputFS.writeFile(
          name,
          JSON.stringify(manifests[name], false, 2)
        );
      }
    }
  }
});
