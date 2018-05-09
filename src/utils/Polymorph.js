function unique(target, method) {
  let name = method,
    defaultFn,
    delegate;

  if (typeof method === 'object') {
    name = method.name;
    defaultFn = method.default;
  }

  let fn = (target.prototype[name] = function(...args) {
    if (!delegate) {
      if (defaultFn) {
        delegate = defaultFn;
      } else {
        throw new Error(`${name} is not defined`);
      }
    }

    return delegate.apply(this, args);
  });
  fn.extensible = true;
  fn.extend = next => {
    if (typeof next !== 'function') {
      throw new Error('Method extension should be a function');
    }

    if (!delegate) {
      delegate = next;
    } else {
      throw new Error(`${name} is already defined`);
    }
  };
}

function multiple(target, method) {
  let {async, name, default: defaultFn, map, reduce, seed} =
    typeof method === 'object' ? method : {name: method};

  let delegates = [];
  let fn;

  if (async) {
    fn = async function(...args) {
      let defaultDelegates =
        defaultFn && delegates.length === 0 ? [defaultFn] : delegates;
      let results = [];

      for (let delegate of defaultDelegates) {
        let result = await delegate.apply(this, args);

        results.push(map ? await map.call(this, result) : result);
      }

      if (reduce) {
        return results.reduce(reduce, seed);
      } else {
        return results;
      }
    };
  } else {
    fn = function(...args) {
      let defaultDelegates =
        defaultFn && delegates.length === 0 ? [defaultFn] : delegates;
      let results = defaultDelegates.map(delegate => {
        let result = delegate.apply(this, args);

        return map ? map.call(this, result) : result;
      });

      if (reduce) {
        return results.reduce(reduce, seed);
      } else {
        return results;
      }
    };
  }

  target.prototype[name] = fn;
  fn.extensible = true;
  fn.extend = next => {
    if (typeof next !== 'function') {
      throw new Error('Method extension should be a function');
    }

    delegates.push(next);
  };
}

function morph(target, config) {
  if (config.unique) {
    config.unique.forEach(method => unique(target, method));
  }

  if (config.multiple) {
    config.multiple.forEach(method => multiple(target, method));
  }

  target.getPolymorphClone = () => morph(class extends target {}, config);

  return target;
}

module.exports = morph;
