import path from 'path';
import {Transformer} from '@parcel/plugin';
import pug from 'pug';

type PugConfig = pug.Options & {
  locals?: pug.LocalsObject;
};

export default new Transformer<PugConfig | undefined>({
  transform({asset, config}) {
    const pugConfig = config ?? {};
    const content = asset.getCode();
    const render = pug.compile(content, {
      compileDebug: false,
      basedir: path.dirname(asset.filePath),
      filename: asset.filePath,
      ...pugConfig,
      pretty: pugConfig.pretty || false,
    });

    // TODO: Re-enable once invalidateOnFileChange is supported by the JS plugin bridge.
    // for (let filePath of render.dependencies) {
    //   asset.invalidateOnFileChange(filePath);
    // }

    asset.type = 'html';
    asset.setCode(render(pugConfig.locals));
  },
});
