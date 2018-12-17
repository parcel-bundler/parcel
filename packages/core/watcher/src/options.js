function type(options) {
  return Object.prototype.toString.call(options).slice(8, -1);
}

function encode(options) {
  if (options && options.ignored) {
    const ignoredType = type(options.ignored);
    if (ignoredType !== 'Array') {
      options.ignored = [options.ignored];
    }

    options.ignored.forEach((value, index) => {
      const valueType = type(value);
      if (valueType === 'RegExp') {
        options.ignored[index] = value.source;
        if (!options._regIndexs) {
          options._regIndexs = [];
        }
        options._regIndexs.push(index);
      }
    });
  }

  return options;
}

function decode(options) {
  if (options && options.ignored && options._regIndexs) {
    for (let index of options._regIndexs) {
      options.ignored[index] = new RegExp(options.ignored[index]);
    }
    delete options._regIndexs;
  }

  return options;
}

exports.encode = encode;
exports.decode = decode;
