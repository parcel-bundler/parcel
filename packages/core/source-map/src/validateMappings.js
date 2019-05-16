// @flow
import type {Mapping} from './types';

export default function validateMappings(mappings: Array<Mapping>) {
  for (let mapping of mappings) {
    if (!mapping) {
      throw new Error('mapping is undefined');
    }

    if (!mapping.generated) {
      throw new Error('generated mapping is undefined');
    }

    if (mapping.source == null) {
      throw new Error('source should be defined');
    }

    let isValidOriginal =
      mapping.original == null ||
      (typeof mapping.original.line === 'number' &&
        mapping.original.line > 0 &&
        typeof mapping.original.column === 'number' &&
        mapping.source);

    if (!isValidOriginal) {
      throw new Error('Invalid original mapping');
    }

    let isValidGenerated =
      typeof mapping.generated.line === 'number' &&
      mapping.generated.line > 0 &&
      typeof mapping.generated.column === 'number';

    if (!isValidGenerated) {
      throw new Error('Invalid generated mapping');
    }
  }
}
