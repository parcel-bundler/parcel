import {Resolver} from '@parcel/plugin';
import path from 'path';

// Maps a bare name that neither Sass's own lookup nor node_modules can find.
export default new Resolver({
  resolve({dependency, specifier}) {
    if (specifier !== 'brand-colors') {
      return null;
    }
    return {filePath: path.join(path.dirname(dependency.resolveFrom), 'theme/_colors.scss')};
  },
});
