// @flow strict-local

import {Optimizer} from '@parcel/plugin';
import {bufferStream} from '@parcel/utils';
import {Readable} from 'stream';
import mime from 'mime';

export default new Optimizer({
  async optimize({bundle, contents}) {
    let bufferContents;
    if (contents instanceof Readable) {
      bufferContents = await bufferStream(contents);
    } else if (contents instanceof Buffer) {
      bufferContents = contents;
    } else {
      bufferContents = Buffer.from(contents, 'utf8');
    }

    let hasBinaryContent = bufferContents.includes(0x00);

    // Follows the data url format referenced here:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
    let mimeType = mime.getType(bundle.filePath) ?? '';
    let encoding = hasBinaryContent ? ';base64' : '';
    let content = encodeURIComponent(
      hasBinaryContent
        ? bufferContents.toString('base64')
        : bufferContents.toString()
    );
    return {
      contents: `data:${mimeType}${encoding},${content}`
    };
  }
});
