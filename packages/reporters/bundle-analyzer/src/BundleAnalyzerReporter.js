// @flow strict-local

import {Bundle} from '@parcel/types';
import {Reporter} from '@parcel/plugin';
import {DefaultMap} from '@parcel/utils';
import path from 'path';

export default new Reporter({
  async report({event, options}) {
    if (
      event.type !== 'buildSuccess' ||
      process.env.PARCEL_BUNDLE_ANALYZER == null
    ) {
      return;
    }

    let bundlesByTarget: DefaultMap<
      string /* target name */,
      Array<Bundle>
    > = new DefaultMap(() => []);
    for (let bundle of event.bundleGraph.getBundles()) {
      bundlesByTarget.get(bundle.target.name).push(bundle);
    }

    let reportsDir = path.join(options.projectRoot, 'parcel-bundle-reports');
    await options.outputFS.mkdirp(reportsDir);

    await Promise.all(
      [...bundlesByTarget.entries()].map(([targetName, bundles]) => {
        return options.outputFS.writeFile(
          path.join(reportsDir, `${targetName}.html`),
          `
          <html></html>
        `
        );
      })
    );
  }
});
