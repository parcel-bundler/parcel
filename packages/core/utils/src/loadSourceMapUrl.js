// @flow
import path from 'path';
import {readFile} from '@parcel/fs';

const SOURCEMAP_RE = /(?:\/\*|\/\/)\s*[@#]\s*sourceMappingURL\s*=\s*([^\r\n*]+)(?:\s*\*\/)?/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

export default async function loadSourceMapUrl(
  filename: string,
  contents: string
) {
  let match = contents.match(SOURCEMAP_RE);
  if (match) {
    let url = match[1].trim();
    let dataURLMatch = url.match(DATA_URL_RE);
    filename = dataURLMatch ? filename : path.join(path.dirname(filename), url);

    return {
      url,
      filename,
      map: JSON.parse(
        dataURLMatch
          ? Buffer.from(dataURLMatch[1], 'base64').toString()
          : await readFile(filename, 'utf8')
      )
    };
  }
}
