import {Resolver} from '@parcel/plugin';
import path from 'path';
import {fileURLToPath} from 'url';

export default new Resolver({
  async resolve({dependency, specifier}) {
    if (specifier !== 'brand-colors') {
      return null;
    }
    let from = fileURLToPath(dependency.resolveFrom);
    return {filePath: path.join(path.dirname(from), 'theme/colors.txt')};
  },
});
