// @flow

const nameToCtor: Map<string, Class<*>> = new Map();
const ctorToName: Map<Class<*>, string> = new Map();

export function registerSerializableClass(name: string, ctor: Class<*>) {
  if (nameToCtor.has(name)) {
    throw new Error('Name already registered with serializer');
  }

  if (ctorToName.has(ctor)) {
    throw new Error('Class already registered with serializer');
  }

  nameToCtor.set(name, ctor);
  ctorToName.set(ctor, name);
}

export function serialize(object: any): string {
  return JSON.stringify(object, (key, value) => {
    let serialized = value;

    // If the object has a serialize method, call it
    if (value && typeof value.serialize === 'function') {
      serialized = value.serialize();
    }

    // Add a $$type property with the name of this class, if any is registered.
    if (
      value &&
      typeof value === 'object' &&
      typeof value.constructor === 'function'
    ) {
      let type = ctorToName.get(value.constructor);
      if (type != null) {
        serialized = {
          $$type: type,
          value: Object.assign({}, serialized)
        };
      }
    }

    return serialized;
  });
}

export function deserialize(string: string) {
  return JSON.parse(string, (key, value) => {
    // If the value has a $$type property, use it to restore the object type
    if (value && value.$$type) {
      let ctor = nameToCtor.get(value.$$type);
      if (ctor == null) {
        throw new Error(
          `Expected constructor ${
            value.$$type
          } to be registered with serializer to deserialize`
        );
      }

      if (typeof ctor.deserialize === 'function') {
        return ctor.deserialize(value.value);
      }

      return new ctor(value.value);
    }

    return value;
  });
}
