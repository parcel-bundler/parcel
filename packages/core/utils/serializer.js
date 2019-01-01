function serialize(object) {
  return JSON.stringify(object, (key, value) => {
    let serialized = value;

    // If the object has a serialize method, call it
    if (value && typeof value.serialize === 'function') {
      serialized = value.serialize();
    }

    // Add a $$type property with the export specifier for this class, if any.
    if (value && typeof value.constructor === 'function' && value.constructor.__exportSpecifier) {
      serialized = Object.assign({$$type: value.constructor.__exportSpecifier}, serialized);
    }

    return serialized;
  });
}

function deserialize(string) {
  return JSON.parse(string, (key, value) => {
    // If the value has a $$type property, use it to restore the object type
    if (value && value.$$type) {
      let Type = resolveType(value.$$type);
      delete value.$$type;
      return new Type(value);
    }

    return value;
  });
}

function resolveType(type) {
  let filename, exportName;
  if (Array.isArray(type)) {
    [filename, exportName] = type;
  } else {
    filename = type;
    exportName = 'default';
  }

  let module = require(filename);
  if (exportName === 'default') {
    return module.__esModule ? module.default : module;
  }

  return module[exportName];
}

exports.serialize = serialize;
exports.deserialize = deserialize;
