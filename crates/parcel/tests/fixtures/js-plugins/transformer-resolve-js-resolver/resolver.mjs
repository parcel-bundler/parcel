import {Resolver} from '@parcel/plugin';
import path from 'path';

export default new Resolver({
  async resolve({dependency, specifier}) {
    if (specifier !== 'brand-colors') {
      return null;
    }
    return {filePath: path.join(path.dirname(dependency.resolveFrom), 'theme/colors.txt')};
  },
});
