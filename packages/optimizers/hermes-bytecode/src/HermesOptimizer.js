// @flow
import {Optimizer} from '@parcel/plugin';
import {compile} from 'metro-hermes-compiler';
import {blobToString} from '@parcel/utils';

export default (new Optimizer({
  async optimize({options, contents, map}) {
    let code = await blobToString(contents);
    // $FlowFixMe
    let mapString: string = await map?.stringify({
      // $FlowFixMe
      fs: options.inputFS,
      rootDir: options.projectRoot,
      inlineSources: true,
      format: 'string',
    });
    let bytecode = compile(code, {
      sourceURL: '',
      sourceMap: mapString,
    }).bytecode;

    return {
      contents: bytecode,
    };
  },
}): Optimizer);
