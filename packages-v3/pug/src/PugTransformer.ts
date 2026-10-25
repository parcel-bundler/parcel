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

    asset.type = 'html';
    asset.setCode(render(pugConfig.locals));
  },
});
