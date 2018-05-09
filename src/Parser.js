const path = require('path');
const Asset = require('./Asset');
const glob = require('glob');
const loadPlugin = require('./Plugins');

class Parser {
  constructor() {
    this.assets = new Map();

    require('fs')
      .readdirSync(__dirname + '/plugins/assets')
      .forEach(name => loadPlugin(require(`./plugins/assets/${name}`), this));
  }

  composeAssets(extension, components, type) {
    let Base = this.assets.get(extension);

    if (!Base) {
      Base = Asset.getPolymorphClone();

      this.assets.set(extension, Base);
    }

    let states = new WeakMap();

    if (typeof type !== 'undefined') {
      Base.prototype.init.extend(function() {
        this.type = type;
      });
    }

    components.forEach(({method, name}) =>
      Base.prototype[name].extend(function(...args) {
        let state = states.get(this);

        if (!state) {
          states.set(this, (state = {}));

          // Proxy Asset base method and properties to state
          getAllProperties(this).forEach(name => {
            if (name in Base.prototype) {
              state[name] = (...args) => this[name](...args);
            } else {
              Object.defineProperty(state, name, {
                get: () => this[name],
                set() {
                  throw new Error(`Asset property "${name}" is readonly`);
                }
              });
            }
          });
        }

        let result = method(...args, state);

        if (name === 'init' && result) {
          Object.assign(state, result);
        }

        return result;
      })
    );
  }

  findParser(filename) {
    if (/[*+{}]/.test(filename) && glob.hasMagic(filename)) {
      return this.assets.get('.internal/glob');
    }

    let extension = path.extname(filename).toLowerCase();

    if (this.assets.has(extension)) {
      return this.assets.get(extension);
    }

    return this.assets.get('.internal/raw');
  }

  getAsset(filename, options = {}) {
    let Asset = this.findParser(filename);
    options.parser = this;
    return new Asset(filename, options);
  }
}

function getAllProperties(object) {
  let properties = Object.keys(object);

  while ((object = Object.getPrototypeOf(object))) {
    if (object === Object.prototype) {
      break;
    }

    properties.push(...Object.getOwnPropertyNames(object));
  }

  return [...new Set(properties)];
}

module.exports = Parser;
