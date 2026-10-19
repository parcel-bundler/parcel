import {Resolver} from '@parcel/plugin';
import path from 'path';
import {fileURLToPath} from 'url';

// Maps a bare name that neither Sass's own lookup nor node_modules can find.
export default new Resolver({
  resolve({dependency, specifier}) {
    if (specifier !== 'brand-colors') {
      return null;
    }
    let from = fileURLToPath(dependency.resolveFrom);
    return {filePath: path.join(path.dirname(from), 'theme/_colors.scss')};
  },
});
