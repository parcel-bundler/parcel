// @flow
import type {FileSystem} from '@parcel/fs';
import path from 'path';

const SOURCEMAP_RE = /(?:\/\*|\/\/)\s*[@#]\s*sourceMappingURL\s*=\s*([^\s*]+)(?:\s*\*\/)?\s*$/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

export function matchSourceMappingURL(contents: string) {
  return contents.match(SOURCEMAP_RE);
}

export default async function loadSourceMapUrl(
  fs: FileSystem,
  filename: string,
  contents: string
) {
  let match = matchSourceMappingURL(contents);
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
          : await fs.readFile(filename, 'utf8')
      )
    };
  }
}
