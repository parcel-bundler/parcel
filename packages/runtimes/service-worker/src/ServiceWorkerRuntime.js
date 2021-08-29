// @flow
import {Runtime} from '@parcel/plugin';
import {urlJoin} from '@parcel/utils';

export default (new Runtime({
  apply({bundle, bundleGraph}) {
    if (bundle.env.context !== 'service-worker') {
      return [];
    }

    let hasDep;
    bundle.traverse((node, _, actions) => {
      if (
        node.type === 'dependency' &&
        node.value.specifier === '@parcel/service-worker'
      ) {
        hasDep = true;
        actions.stop();
      }
    });

    if (!hasDep) {
      return [];
    }

    let manifest = [];
    bundleGraph.traverseBundles(b => {
      if (b.bundleBehavior === 'inline' || b.id === bundle.id) {
        return;
      }

      manifest.push(urlJoin(b.target.publicUrl, b.name));
    });

    let code = `import {_register} from '@parcel/service-worker';
const manifest = ${JSON.stringify(manifest)};
const version = ${JSON.stringify(bundle.hashReference)};
_register(manifest, version);
`;

    return [
      {
        filePath: __filename,
        code,
        isEntry: true,
        env: {sourceType: 'module'},
      },
    ];
  },
}): Runtime);
