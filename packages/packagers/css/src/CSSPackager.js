// @flow strict-local

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package({bundle}) {
    let promises = [];
    bundle.traverseAssets({
      exit: asset => {
        let parentDep;
        bundle.traverseAncestors(asset, (node, _, {stop}) => {
          if (node.type === 'dependency') {
            parentDep = node.value;
            stop();
          }
        });

        promises.push(
          asset.getCode().then((css: string) => {
            if (parentDep && parentDep.meta && parentDep.meta.media) {
              return `@media ${parentDep.meta.media} {\n${css}\n}\n`;
            }

            return css;
          })
        );
      }
    });
    let outputs = await Promise.all(promises);

    return {contents: await outputs.map(output => output).join('\n')};
  }
});
