// @flow strict-local

import {Optimizer} from '@parcel/plugin';
import {blobToBuffer} from '@parcel/utils';
import mime from 'mime';
import {isBinaryFile} from 'isbinaryfile';

export default new Optimizer({
  async optimize({bundle, contents}) {
    let bufferContents = await blobToBuffer(contents);
    let hasBinaryContent = await isBinaryFile(bufferContents);

    // Follows the data url format referenced here:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
    let mimeType = mime.getType(bundle.filePath) ?? '';
    let encoding = hasBinaryContent ? ';base64' : '';
    let content = encodeURIComponent(
      hasBinaryContent
        ? bufferContents.toString('base64')
        : bufferContents.toString(),
    );
    return {
      contents: `data:${mimeType}${encoding},${content}`,
    };
  },
});
