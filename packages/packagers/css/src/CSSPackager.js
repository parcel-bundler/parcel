// @flow strict-local

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package({bundle}) {
    let promises = [];
    bundle.traverseAssets({
      exit: asset => {
        let media = [];
        bundle.traverseAncestors(asset, (node, _, {skipChildren}) => {
          if (node.type === 'dependency') {
            let dep = node.value;
            if (!dep.meta || !dep.meta.media) {
              skipChildren();
              return;
            }
            media.push(dep.meta.media);
          }
        });

        promises.push(
          asset.getCode().then((css: string) => {
            if (media.length) {
              return `@media ${media.join(', ')} {\n${css.trim()}\n}\n`;
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
