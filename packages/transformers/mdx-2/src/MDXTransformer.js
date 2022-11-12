// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({config}) {
    let configFile = await config.getConfig(['.mdxrc.js', '.mdxrc.cjs'], {
      packageKey: 'mdx',
    });

    if (configFile) {
      config.invalidateOnStartup();

      return configFile.contents;
    }
  },
  async transform({asset, config}) {
    let code = await asset.getCode();
    // @mdx-js/mdx is a ESM package, so we need to use `import()` to make it work in CJS envs
    const {compile} = await import('@mdx-js/mdx');

    let compiled = await compile(code, config);

    asset.type = 'js';
    asset.setCode(compiled.value);

    return [asset];
  },
}): Transformer);
