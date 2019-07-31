// @flow

import {Packager} from '@parcel/plugin';

export default new Packager({
  async package({bundle, bundleGraph}) {
    let promises = [];
    bundle.traverseAssets({
      exit: asset => {
        // Figure out which media types this asset was imported with.
        // We only want to import the asset once, so group them all together.
        let media = [];
        for (let dep of bundleGraph.getIncomingDependencies(asset)) {
          if (!dep.meta.media) {
            // Asset was imported without a media type. Don't wrap in @media.
            media.length = 0;
            break;
          }
          media.push(dep.meta.media);
        }

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
