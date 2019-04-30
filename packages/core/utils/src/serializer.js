// @flow

export function serialize(object: any): string {
  return JSON.stringify(object, (key, value) => {
    let serialized = value;

    // If the object has a serialize method, call it
    if (value && typeof value.serialize === 'function') {
      serialized = value.serialize();
    }

    // Add a $$type property with the export specifier for this class, if any.
    if (
      value &&
      typeof value.constructor === 'function' &&
      value.constructor.__exportSpecifier
    ) {
      serialized = {
        $$type: value.constructor.__exportSpecifier,
        value: Object.assign({}, serialized)
      };
    }

    return serialized;
  });
}

export function deserialize(string: string) {
  return JSON.parse(string, (key, value) => {
    // If the value has a $$type property, use it to restore the object type
    if (value && value.$$type) {
      let Type = resolveType(value.$$type);
      if (typeof Type.deserialize === 'function') {
        return Type.deserialize(value.value);
      }

      return new Type(value.value);
    }

    return value;
  });
}

export function resolveType(type: [string, string] | string): any {
  let filename, exportName;
  if (Array.isArray(type)) {
    [filename, exportName] = type;
  } else {
    filename = type;
    exportName = 'default';
  }

  // $FlowFixMe this must be dynamic
  let module = require(filename);
  if (exportName === 'default') {
    return module.__esModule ? module.default : module;
  }

  return module[exportName];
}
