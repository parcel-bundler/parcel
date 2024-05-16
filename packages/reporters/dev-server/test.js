var $dmXIQ$tty = require('tty');
var $dmXIQ$util = require('util');
var $dmXIQ$fs = require('fs');
var $dmXIQ$net = require('net');
var $dmXIQ$url = require('url');
var $dmXIQ$http = require('http');
var $dmXIQ$https = require('https');
var $dmXIQ$stream = require('stream');
var $dmXIQ$assert = require('assert');
var $dmXIQ$os = require('os');
var $dmXIQ$path = require('path');
var $dmXIQ$zlib = require('zlib');
var $dmXIQ$querystring = require('querystring');
var $dmXIQ$tls = require('tls');
var $dmXIQ$crypto = require('crypto');
var $dmXIQ$events = require('events');
var $dmXIQ$parcelplugin = require('@parcel/plugin');
var $dmXIQ$parcelutils = require('@parcel/utils');
var $dmXIQ$punycode = require('punycode');
var $dmXIQ$child_process = require('child_process');

function $parcel$export(e, n, v, s) {
  Object.defineProperty(e, n, {
    get: v,
    set: s,
    enumerable: true,
    configurable: true,
  });
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}

function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}

var $parcel$global = globalThis;

var $parcel$modules = {};
var $parcel$inits = {};

var parcelRequire = $parcel$global['parcelRequire0b48'];

if (parcelRequire == null) {
  parcelRequire = function (id) {
    if (id in $parcel$modules) {
      return $parcel$modules[id].exports;
    }
    if (id in $parcel$inits) {
      var init = $parcel$inits[id];
      delete $parcel$inits[id];
      var module = {id: id, exports: {}};
      $parcel$modules[id] = module;
      init.call(module.exports, module, module.exports);
      return module.exports;
    }
    var err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  parcelRequire.register = function register(id, init) {
    $parcel$inits[id] = init;
  };

  $parcel$global['parcelRequire0b48'] = parcelRequire;
}

var parcelRegister = parcelRequire.register;
parcelRegister('kCnJa', function (module, exports) {
  /**
   * Detect Electron renderer process, which is node, but we should
   * treat as a browser.
   */

  if (typeof process !== 'undefined' && process.type === 'renderer')
    module.exports = parcelRequire('1O5mJ');
  else module.exports = parcelRequire('iOzdr');
});
parcelRegister('1O5mJ', function (module, exports) {
  /**
   * This is the web browser implementation of `debug()`.
   *
   * Expose `debug()` as the module.
   */
  exports = module.exports = parcelRequire('akGXv');
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage =
    'undefined' != typeof chrome && 'undefined' != typeof chrome.storage
      ? chrome.storage.local
      : localstorage();
  /**
   * Colors.
   */ exports.colors = [
    'lightseagreen',
    'forestgreen',
    'goldenrod',
    'dodgerblue',
    'darkorchid',
    'crimson',
  ];
  /**
   * Currently only WebKit-based Web Inspectors, Firefox >= v31,
   * and the Firebug extension (any Firefox version) are known
   * to support "%c" CSS customizations.
   *
   * TODO: add a `localStorage` variable to explicitly enable/disable colors
   */ function useColors() {
    // NB: In an Electron preload script, document will be defined but not fully
    // initialized. Since we know we're in Chrome, we'll just detect this case
    // explicitly
    if (
      typeof window !== 'undefined' &&
      window.process &&
      window.process.type === 'renderer'
    )
      return true;
    // is webkit? http://stackoverflow.com/a/16459606/376773
    // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    return (
      (typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.style &&
        document.documentElement.style.WebkitAppearance) || // is firebug? http://stackoverflow.com/a/398120/376773
      (typeof window !== 'undefined' &&
        window.console &&
        (window.console.firebug ||
          (window.console.exception && window.console.table))) || // is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) &&
        parseInt(RegExp.$1, 10) >= 31) || // double check webkit in userAgent just in case we are in a worker
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/))
    );
  }
  /**
   * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
   */ exports.formatters.j = function (v) {
    try {
      return JSON.stringify(v);
    } catch (err) {
      return '[UnexpectedJSONParseError]: ' + err.message;
    }
  };
  /**
   * Colorize log arguments if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    var useColors = this.useColors;
    args[0] =
      (useColors ? '%c' : '') +
      this.namespace +
      (useColors ? ' %c' : ' ') +
      args[0] +
      (useColors ? '%c ' : ' ') +
      '+' +
      exports.humanize(this.diff);
    if (!useColors) return;
    var c = 'color: ' + this.color;
    args.splice(1, 0, c, 'color: inherit');
    // the final "%c" is somewhat tricky, because there could be other
    // arguments passed either before or after the %c, so we need to
    // figure out the correct index to insert the CSS into
    var index = 0;
    var lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, function (match) {
      if ('%%' === match) return;
      index++;
      if ('%c' === match)
        // we only are interested in the *last* %c
        // (the user may have provided their own)
        lastC = index;
    });
    args.splice(lastC, 0, c);
  }
  /**
   * Invokes `console.log()` when available.
   * No-op when `console.log` is not a "function".
   *
   * @api public
   */ function log() {
    // this hackery is required for IE8/9, where
    // the `console.log` function doesn't have 'apply'
    return (
      'object' === typeof console &&
      console.log &&
      Function.prototype.apply.call(console.log, console, arguments)
    );
  }
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    try {
      if (null == namespaces) exports.storage.removeItem('debug');
      else exports.storage.debug = namespaces;
    } catch (e) {}
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    var r;
    try {
      r = exports.storage.debug;
    } catch (e) {}
    // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    if (!r && typeof process !== 'undefined' && 'env' in process)
      r = process.env.DEBUG;
    return r;
  }
  /**
   * Enable namespaces listed in `localStorage.debug` initially.
   */ exports.enable(load());
  /**
   * Localstorage attempts to return the localstorage.
   *
   * This is necessary because safari throws
   * when a user disables cookies/localstorage
   * and you attempt to access it.
   *
   * @return {LocalStorage}
   * @api private
   */ function localstorage() {
    try {
      return window.localStorage;
    } catch (e) {}
  }
});
parcelRegister('akGXv', function (module, exports) {
  /**
   * This is the common logic for both the Node.js and web browser
   * implementations of `debug()`.
   *
   * Expose `debug()` as the module.
   */ exports =
    module.exports =
    createDebug.debug =
    createDebug['default'] =
      createDebug;
  exports.coerce = coerce;
  exports.disable = disable;
  exports.enable = enable;
  exports.enabled = enabled;

  exports.humanize = parcelRequire('5byFq');
  /**
   * The currently active debug mode names, and names to skip.
   */ exports.names = [];
  exports.skips = [];
  /**
   * Map of special "%n" handling functions, for the debug "format" argument.
   *
   * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
   */ exports.formatters = {};
  /**
   * Previous log timestamp.
   */ var prevTime;
  /**
   * Select a color.
   * @param {String} namespace
   * @return {Number}
   * @api private
   */ function selectColor(namespace) {
    var hash = 0,
      i;
    for (i in namespace) {
      hash = (hash << 5) - hash + namespace.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return exports.colors[Math.abs(hash) % exports.colors.length];
  }
  /**
   * Create a debugger with the given `namespace`.
   *
   * @param {String} namespace
   * @return {Function}
   * @api public
   */ function createDebug(namespace) {
    function debug() {
      // disabled?
      if (!debug.enabled) return;
      var self = debug;
      // set `diff` timestamp
      var curr = +new Date();
      var ms = curr - (prevTime || curr);
      self.diff = ms;
      self.prev = prevTime;
      self.curr = curr;
      prevTime = curr;
      // turn the `arguments` into a proper Array
      var args = new Array(arguments.length);
      for (var i = 0; i < args.length; i++) args[i] = arguments[i];
      args[0] = exports.coerce(args[0]);
      if ('string' !== typeof args[0])
        // anything else let's inspect with %O
        args.unshift('%O');
      // apply any `formatters` transformations
      var index = 0;
      args[0] = args[0].replace(/%([a-zA-Z%])/g, function (match, format) {
        // if we encounter an escaped % then don't increase the array index
        if (match === '%%') return match;
        index++;
        var formatter = exports.formatters[format];
        if ('function' === typeof formatter) {
          var val = args[index];
          match = formatter.call(self, val);
          // now we need to remove `args[index]` since it's inlined in the `format`
          args.splice(index, 1);
          index--;
        }
        return match;
      });
      // apply env-specific formatting (colors, etc.)
      exports.formatArgs.call(self, args);
      var logFn = debug.log || exports.log || console.log.bind(console);
      logFn.apply(self, args);
    }
    debug.namespace = namespace;
    debug.enabled = exports.enabled(namespace);
    debug.useColors = exports.useColors();
    debug.color = selectColor(namespace);
    // env-specific initialization logic for debug instances
    if ('function' === typeof exports.init) exports.init(debug);
    return debug;
  }
  /**
   * Enables a debug mode by namespaces. This can include modes
   * separated by a colon and wildcards.
   *
   * @param {String} namespaces
   * @api public
   */ function enable(namespaces) {
    exports.save(namespaces);
    exports.names = [];
    exports.skips = [];
    var split = (typeof namespaces === 'string' ? namespaces : '').split(
      /[\s,]+/,
    );
    var len = split.length;
    for (var i = 0; i < len; i++) {
      if (!split[i]) continue; // ignore empty strings
      namespaces = split[i].replace(/\*/g, '.*?');
      if (namespaces[0] === '-')
        exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
      else exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
  /**
   * Disable debug output.
   *
   * @api public
   */ function disable() {
    exports.enable('');
  }
  /**
   * Returns true if the given mode name is enabled, false otherwise.
   *
   * @param {String} name
   * @return {Boolean}
   * @api public
   */ function enabled(name) {
    var i, len;
    for (i = 0, len = exports.skips.length; i < len; i++) {
      if (exports.skips[i].test(name)) return false;
    }
    for (i = 0, len = exports.names.length; i < len; i++) {
      if (exports.names[i].test(name)) return true;
    }
    return false;
  }
  /**
   * Coerce `val`.
   *
   * @param {Mixed} val
   * @return {Mixed}
   * @api private
   */ function coerce(val) {
    if (val instanceof Error) return val.stack || val.message;
    return val;
  }
});
parcelRegister('5byFq', function (module, exports) {
  /**
   * Helpers.
   */ var $3c68deff4937913b$var$s = 1000;
  var $3c68deff4937913b$var$m = $3c68deff4937913b$var$s * 60;
  var $3c68deff4937913b$var$h = $3c68deff4937913b$var$m * 60;
  var $3c68deff4937913b$var$d = $3c68deff4937913b$var$h * 24;
  var $3c68deff4937913b$var$y = $3c68deff4937913b$var$d * 365.25;
  /**
   * Parse or format the given `val`.
   *
   * Options:
   *
   *  - `long` verbose formatting [false]
   *
   * @param {String|Number} val
   * @param {Object} [options]
   * @throws {Error} throw an error if val is not a non-empty string or a number
   * @return {String|Number}
   * @api public
   */ module.exports = function (val, options) {
    options = options || {};
    var type = typeof val;
    if (type === 'string' && val.length > 0)
      return $3c68deff4937913b$var$parse(val);
    else if (type === 'number' && isNaN(val) === false)
      return options.long
        ? $3c68deff4937913b$var$fmtLong(val)
        : $3c68deff4937913b$var$fmtShort(val);
    throw new Error(
      'val is not a non-empty string or a valid number. val=' +
        JSON.stringify(val),
    );
  };
  /**
   * Parse the given `str` and return milliseconds.
   *
   * @param {String} str
   * @return {Number}
   * @api private
   */ function $3c68deff4937913b$var$parse(str) {
    str = String(str);
    if (str.length > 100) return;
    var match =
      /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
        str,
      );
    if (!match) return;
    var n = parseFloat(match[1]);
    var type = (match[2] || 'ms').toLowerCase();
    switch (type) {
      case 'years':
      case 'year':
      case 'yrs':
      case 'yr':
      case 'y':
        return n * $3c68deff4937913b$var$y;
      case 'days':
      case 'day':
      case 'd':
        return n * $3c68deff4937913b$var$d;
      case 'hours':
      case 'hour':
      case 'hrs':
      case 'hr':
      case 'h':
        return n * $3c68deff4937913b$var$h;
      case 'minutes':
      case 'minute':
      case 'mins':
      case 'min':
      case 'm':
        return n * $3c68deff4937913b$var$m;
      case 'seconds':
      case 'second':
      case 'secs':
      case 'sec':
      case 's':
        return n * $3c68deff4937913b$var$s;
      case 'milliseconds':
      case 'millisecond':
      case 'msecs':
      case 'msec':
      case 'ms':
        return n;
      default:
        return undefined;
    }
  }
  /**
   * Short format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $3c68deff4937913b$var$fmtShort(ms) {
    if (ms >= $3c68deff4937913b$var$d)
      return Math.round(ms / $3c68deff4937913b$var$d) + 'd';
    if (ms >= $3c68deff4937913b$var$h)
      return Math.round(ms / $3c68deff4937913b$var$h) + 'h';
    if (ms >= $3c68deff4937913b$var$m)
      return Math.round(ms / $3c68deff4937913b$var$m) + 'm';
    if (ms >= $3c68deff4937913b$var$s)
      return Math.round(ms / $3c68deff4937913b$var$s) + 's';
    return ms + 'ms';
  }
  /**
   * Long format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $3c68deff4937913b$var$fmtLong(ms) {
    return (
      $3c68deff4937913b$var$plural(ms, $3c68deff4937913b$var$d, 'day') ||
      $3c68deff4937913b$var$plural(ms, $3c68deff4937913b$var$h, 'hour') ||
      $3c68deff4937913b$var$plural(ms, $3c68deff4937913b$var$m, 'minute') ||
      $3c68deff4937913b$var$plural(ms, $3c68deff4937913b$var$s, 'second') ||
      ms + ' ms'
    );
  }
  /**
   * Pluralization helper.
   */ function $3c68deff4937913b$var$plural(ms, n, name) {
    if (ms < n) return;
    if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
    return Math.ceil(ms / n) + ' ' + name + 's';
  }
});

parcelRegister('iOzdr', function (module, exports) {
  /**
   * Module dependencies.
   */

  /**
   * This is the Node.js implementation of `debug()`.
   *
   * Expose `debug()` as the module.
   */ exports = module.exports = parcelRequire('akGXv');
  exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  /**
   * Colors.
   */ exports.colors = [6, 2, 3, 4, 5, 1];
  /**
   * Build up the default `inspectOpts` object from the environment variables.
   *
   *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
   */ exports.inspectOpts = Object.keys(process.env)
    .filter(function (key) {
      return /^debug_/i.test(key);
    })
    .reduce(function (obj, key) {
      // camel-case
      var prop = key
        .substring(6)
        .toLowerCase()
        .replace(/_([a-z])/g, function (_, k) {
          return k.toUpperCase();
        });
      // coerce string value into JS value
      var val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
      else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
      else if (val === 'null') val = null;
      else val = Number(val);
      obj[prop] = val;
      return obj;
    }, {});
  /**
   * The file descriptor to write the `debug()` calls to.
   * Set the `DEBUG_FD` env variable to override with another value. i.e.:
   *
   *   $ DEBUG_FD=3 node script.js 3>debug.log
   */ var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
  if (1 !== fd && 2 !== fd)
    $dmXIQ$util.deprecate(function () {},
    'except for stderr(2) and stdout(1), any other usage of DEBUG_FD is deprecated. Override debug.log if you want to use a different log function (https://git.io/debug_fd)')();
  var stream =
    1 === fd
      ? process.stdout
      : 2 === fd
      ? process.stderr
      : createWritableStdioStream(fd);
  /**
   * Is stdout a TTY? Colored output is enabled when `true`.
   */ function useColors() {
    return 'colors' in exports.inspectOpts
      ? Boolean(exports.inspectOpts.colors)
      : $dmXIQ$tty.isatty(fd);
  }
  /**
   * Map %o to `util.inspect()`, all on a single line.
   */ exports.formatters.o = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util
      .inspect(v, this.inspectOpts)
      .split('\n')
      .map(function (str) {
        return str.trim();
      })
      .join(' ');
  };
  /**
   * Map %o to `util.inspect()`, allowing multiple lines if needed.
   */ exports.formatters.O = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util.inspect(v, this.inspectOpts);
  };
  /**
   * Adds ANSI color escape codes if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    var name = this.namespace;
    var useColors = this.useColors;
    if (useColors) {
      var c = this.color;
      var prefix = '  \x1b[3' + c + ';1m' + name + ' ' + '\x1b[0m';
      args[0] = prefix + args[0].split('\n').join('\n' + prefix);
      args.push('\x1b[3' + c + 'm+' + exports.humanize(this.diff) + '\x1b[0m');
    } else args[0] = new Date().toUTCString() + ' ' + name + ' ' + args[0];
  }
  /**
   * Invokes `util.format()` with the specified arguments and writes to `stream`.
   */ function log() {
    return stream.write(
      $dmXIQ$util.format.apply($dmXIQ$util, arguments) + '\n',
    );
  }
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    if (null == namespaces)
      // If you set a process.env field to null or undefined, it gets cast to the
      // string 'null' or 'undefined'. Just delete instead.
      delete process.env.DEBUG;
    else process.env.DEBUG = namespaces;
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    return process.env.DEBUG;
  }

  /**
   * Copied from `node/src/node.js`.
   *
   * XXX: It's lame that node doesn't expose this API out-of-the-box. It also
   * relies on the undocumented `tty_wrap.guessHandleType()` which is also lame.
   */ function createWritableStdioStream(fd) {
    var stream;
    var tty_wrap = process.binding('tty_wrap');
    // Note stream._type is used for test-module-load-list.js
    switch (tty_wrap.guessHandleType(fd)) {
      case 'TTY':
        stream = new $dmXIQ$tty.WriteStream(fd);
        stream._type = 'tty';
        // Hack to have stream not keep the event loop alive.
        // See https://github.com/joyent/node/issues/1726
        if (stream._handle && stream._handle.unref) stream._handle.unref();
        break;
      case 'FILE':
        var fs = $dmXIQ$fs;
        stream = new fs.SyncWriteStream(fd, {
          autoClose: false,
        });
        stream._type = 'fs';
        break;
      case 'PIPE':
      case 'TCP':
        var net = $dmXIQ$net;
        stream = new net.Socket({
          fd: fd,
          readable: false,
          writable: true,
        });
        // FIXME Should probably have an option in net.Socket to create a
        // stream from an existing fd which is writable only. But for now
        // we'll just add this hack and set the `readable` member to false.
        // Test: ./node test/fixtures/echo.js < /etc/passwd
        stream.readable = false;
        stream.read = null;
        stream._type = 'pipe';
        // FIXME Hack to have stream not keep the event loop alive.
        // See https://github.com/joyent/node/issues/1726
        if (stream._handle && stream._handle.unref) stream._handle.unref();
        break;
      default:
        // Probably an error on in uv_guess_handle()
        throw new Error('Implement me. Unknown stream file type!');
    }
    // For supporting legacy API we put the FD here.
    stream.fd = fd;
    stream._isStdio = true;
    return stream;
  }
  /**
   * Init logic for `debug` instances.
   *
   * Create a new `inspectOpts` object in case `useColors` is set
   * differently for a particular `debug` instance.
   */ function init(debug) {
    debug.inspectOpts = {};
    var keys = Object.keys(exports.inspectOpts);
    for (var i = 0; i < keys.length; i++)
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
  }
  /**
   * Enable namespaces listed in `process.env.DEBUG` initially.
   */ exports.enable(load());
});

parcelRegister('eliWj', function (module, exports) {
  /**
   * Detect Electron renderer process, which is node, but we should
   * treat as a browser.
   */

  if (typeof process !== 'undefined' && process.type === 'renderer')
    module.exports = parcelRequire('4BRLx');
  else module.exports = parcelRequire('cOaH8');
});
parcelRegister('4BRLx', function (module, exports) {
  /**
   * This is the web browser implementation of `debug()`.
   *
   * Expose `debug()` as the module.
   */
  exports = module.exports = parcelRequire('hYtaZ');
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage =
    'undefined' != typeof chrome && 'undefined' != typeof chrome.storage
      ? chrome.storage.local
      : localstorage();
  /**
   * Colors.
   */ exports.colors = [
    'lightseagreen',
    'forestgreen',
    'goldenrod',
    'dodgerblue',
    'darkorchid',
    'crimson',
  ];
  /**
   * Currently only WebKit-based Web Inspectors, Firefox >= v31,
   * and the Firebug extension (any Firefox version) are known
   * to support "%c" CSS customizations.
   *
   * TODO: add a `localStorage` variable to explicitly enable/disable colors
   */ function useColors() {
    // NB: In an Electron preload script, document will be defined but not fully
    // initialized. Since we know we're in Chrome, we'll just detect this case
    // explicitly
    if (
      typeof window !== 'undefined' &&
      window.process &&
      window.process.type === 'renderer'
    )
      return true;
    // is webkit? http://stackoverflow.com/a/16459606/376773
    // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    return (
      (typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.style &&
        document.documentElement.style.WebkitAppearance) || // is firebug? http://stackoverflow.com/a/398120/376773
      (typeof window !== 'undefined' &&
        window.console &&
        (window.console.firebug ||
          (window.console.exception && window.console.table))) || // is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) &&
        parseInt(RegExp.$1, 10) >= 31) || // double check webkit in userAgent just in case we are in a worker
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/))
    );
  }
  /**
   * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
   */ exports.formatters.j = function (v) {
    try {
      return JSON.stringify(v);
    } catch (err) {
      return '[UnexpectedJSONParseError]: ' + err.message;
    }
  };
  /**
   * Colorize log arguments if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    var useColors = this.useColors;
    args[0] =
      (useColors ? '%c' : '') +
      this.namespace +
      (useColors ? ' %c' : ' ') +
      args[0] +
      (useColors ? '%c ' : ' ') +
      '+' +
      exports.humanize(this.diff);
    if (!useColors) return;
    var c = 'color: ' + this.color;
    args.splice(1, 0, c, 'color: inherit');
    // the final "%c" is somewhat tricky, because there could be other
    // arguments passed either before or after the %c, so we need to
    // figure out the correct index to insert the CSS into
    var index = 0;
    var lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, function (match) {
      if ('%%' === match) return;
      index++;
      if ('%c' === match)
        // we only are interested in the *last* %c
        // (the user may have provided their own)
        lastC = index;
    });
    args.splice(lastC, 0, c);
  }
  /**
   * Invokes `console.log()` when available.
   * No-op when `console.log` is not a "function".
   *
   * @api public
   */ function log() {
    // this hackery is required for IE8/9, where
    // the `console.log` function doesn't have 'apply'
    return (
      'object' === typeof console &&
      console.log &&
      Function.prototype.apply.call(console.log, console, arguments)
    );
  }
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    try {
      if (null == namespaces) exports.storage.removeItem('debug');
      else exports.storage.debug = namespaces;
    } catch (e) {}
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    var r;
    try {
      r = exports.storage.debug;
    } catch (e) {}
    // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    if (!r && typeof process !== 'undefined' && 'env' in process)
      r = process.env.DEBUG;
    return r;
  }
  /**
   * Enable namespaces listed in `localStorage.debug` initially.
   */ exports.enable(load());
  /**
   * Localstorage attempts to return the localstorage.
   *
   * This is necessary because safari throws
   * when a user disables cookies/localstorage
   * and you attempt to access it.
   *
   * @return {LocalStorage}
   * @api private
   */ function localstorage() {
    try {
      return window.localStorage;
    } catch (e) {}
  }
});
parcelRegister('hYtaZ', function (module, exports) {
  /**
   * This is the common logic for both the Node.js and web browser
   * implementations of `debug()`.
   *
   * Expose `debug()` as the module.
   */ exports =
    module.exports =
    createDebug.debug =
    createDebug['default'] =
      createDebug;
  exports.coerce = coerce;
  exports.disable = disable;
  exports.enable = enable;
  exports.enabled = enabled;

  exports.humanize = parcelRequire('9giYj');
  /**
   * The currently active debug mode names, and names to skip.
   */ exports.names = [];
  exports.skips = [];
  /**
   * Map of special "%n" handling functions, for the debug "format" argument.
   *
   * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
   */ exports.formatters = {};
  /**
   * Previous log timestamp.
   */ var prevTime;
  /**
   * Select a color.
   * @param {String} namespace
   * @return {Number}
   * @api private
   */ function selectColor(namespace) {
    var hash = 0,
      i;
    for (i in namespace) {
      hash = (hash << 5) - hash + namespace.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return exports.colors[Math.abs(hash) % exports.colors.length];
  }
  /**
   * Create a debugger with the given `namespace`.
   *
   * @param {String} namespace
   * @return {Function}
   * @api public
   */ function createDebug(namespace) {
    function debug() {
      // disabled?
      if (!debug.enabled) return;
      var self = debug;
      // set `diff` timestamp
      var curr = +new Date();
      var ms = curr - (prevTime || curr);
      self.diff = ms;
      self.prev = prevTime;
      self.curr = curr;
      prevTime = curr;
      // turn the `arguments` into a proper Array
      var args = new Array(arguments.length);
      for (var i = 0; i < args.length; i++) args[i] = arguments[i];
      args[0] = exports.coerce(args[0]);
      if ('string' !== typeof args[0])
        // anything else let's inspect with %O
        args.unshift('%O');
      // apply any `formatters` transformations
      var index = 0;
      args[0] = args[0].replace(/%([a-zA-Z%])/g, function (match, format) {
        // if we encounter an escaped % then don't increase the array index
        if (match === '%%') return match;
        index++;
        var formatter = exports.formatters[format];
        if ('function' === typeof formatter) {
          var val = args[index];
          match = formatter.call(self, val);
          // now we need to remove `args[index]` since it's inlined in the `format`
          args.splice(index, 1);
          index--;
        }
        return match;
      });
      // apply env-specific formatting (colors, etc.)
      exports.formatArgs.call(self, args);
      var logFn = debug.log || exports.log || console.log.bind(console);
      logFn.apply(self, args);
    }
    debug.namespace = namespace;
    debug.enabled = exports.enabled(namespace);
    debug.useColors = exports.useColors();
    debug.color = selectColor(namespace);
    // env-specific initialization logic for debug instances
    if ('function' === typeof exports.init) exports.init(debug);
    return debug;
  }
  /**
   * Enables a debug mode by namespaces. This can include modes
   * separated by a colon and wildcards.
   *
   * @param {String} namespaces
   * @api public
   */ function enable(namespaces) {
    exports.save(namespaces);
    exports.names = [];
    exports.skips = [];
    var split = (typeof namespaces === 'string' ? namespaces : '').split(
      /[\s,]+/,
    );
    var len = split.length;
    for (var i = 0; i < len; i++) {
      if (!split[i]) continue; // ignore empty strings
      namespaces = split[i].replace(/\*/g, '.*?');
      if (namespaces[0] === '-')
        exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
      else exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
  /**
   * Disable debug output.
   *
   * @api public
   */ function disable() {
    exports.enable('');
  }
  /**
   * Returns true if the given mode name is enabled, false otherwise.
   *
   * @param {String} name
   * @return {Boolean}
   * @api public
   */ function enabled(name) {
    var i, len;
    for (i = 0, len = exports.skips.length; i < len; i++) {
      if (exports.skips[i].test(name)) return false;
    }
    for (i = 0, len = exports.names.length; i < len; i++) {
      if (exports.names[i].test(name)) return true;
    }
    return false;
  }
  /**
   * Coerce `val`.
   *
   * @param {Mixed} val
   * @return {Mixed}
   * @api private
   */ function coerce(val) {
    if (val instanceof Error) return val.stack || val.message;
    return val;
  }
});
parcelRegister('9giYj', function (module, exports) {
  /**
   * Helpers.
   */ var $6be4530debe3aeed$var$s = 1000;
  var $6be4530debe3aeed$var$m = $6be4530debe3aeed$var$s * 60;
  var $6be4530debe3aeed$var$h = $6be4530debe3aeed$var$m * 60;
  var $6be4530debe3aeed$var$d = $6be4530debe3aeed$var$h * 24;
  var $6be4530debe3aeed$var$y = $6be4530debe3aeed$var$d * 365.25;
  /**
   * Parse or format the given `val`.
   *
   * Options:
   *
   *  - `long` verbose formatting [false]
   *
   * @param {String|Number} val
   * @param {Object} [options]
   * @throws {Error} throw an error if val is not a non-empty string or a number
   * @return {String|Number}
   * @api public
   */ module.exports = function (val, options) {
    options = options || {};
    var type = typeof val;
    if (type === 'string' && val.length > 0)
      return $6be4530debe3aeed$var$parse(val);
    else if (type === 'number' && isNaN(val) === false)
      return options.long
        ? $6be4530debe3aeed$var$fmtLong(val)
        : $6be4530debe3aeed$var$fmtShort(val);
    throw new Error(
      'val is not a non-empty string or a valid number. val=' +
        JSON.stringify(val),
    );
  };
  /**
   * Parse the given `str` and return milliseconds.
   *
   * @param {String} str
   * @return {Number}
   * @api private
   */ function $6be4530debe3aeed$var$parse(str) {
    str = String(str);
    if (str.length > 100) return;
    var match =
      /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(
        str,
      );
    if (!match) return;
    var n = parseFloat(match[1]);
    var type = (match[2] || 'ms').toLowerCase();
    switch (type) {
      case 'years':
      case 'year':
      case 'yrs':
      case 'yr':
      case 'y':
        return n * $6be4530debe3aeed$var$y;
      case 'days':
      case 'day':
      case 'd':
        return n * $6be4530debe3aeed$var$d;
      case 'hours':
      case 'hour':
      case 'hrs':
      case 'hr':
      case 'h':
        return n * $6be4530debe3aeed$var$h;
      case 'minutes':
      case 'minute':
      case 'mins':
      case 'min':
      case 'm':
        return n * $6be4530debe3aeed$var$m;
      case 'seconds':
      case 'second':
      case 'secs':
      case 'sec':
      case 's':
        return n * $6be4530debe3aeed$var$s;
      case 'milliseconds':
      case 'millisecond':
      case 'msecs':
      case 'msec':
      case 'ms':
        return n;
      default:
        return undefined;
    }
  }
  /**
   * Short format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $6be4530debe3aeed$var$fmtShort(ms) {
    if (ms >= $6be4530debe3aeed$var$d)
      return Math.round(ms / $6be4530debe3aeed$var$d) + 'd';
    if (ms >= $6be4530debe3aeed$var$h)
      return Math.round(ms / $6be4530debe3aeed$var$h) + 'h';
    if (ms >= $6be4530debe3aeed$var$m)
      return Math.round(ms / $6be4530debe3aeed$var$m) + 'm';
    if (ms >= $6be4530debe3aeed$var$s)
      return Math.round(ms / $6be4530debe3aeed$var$s) + 's';
    return ms + 'ms';
  }
  /**
   * Long format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $6be4530debe3aeed$var$fmtLong(ms) {
    return (
      $6be4530debe3aeed$var$plural(ms, $6be4530debe3aeed$var$d, 'day') ||
      $6be4530debe3aeed$var$plural(ms, $6be4530debe3aeed$var$h, 'hour') ||
      $6be4530debe3aeed$var$plural(ms, $6be4530debe3aeed$var$m, 'minute') ||
      $6be4530debe3aeed$var$plural(ms, $6be4530debe3aeed$var$s, 'second') ||
      ms + ' ms'
    );
  }
  /**
   * Pluralization helper.
   */ function $6be4530debe3aeed$var$plural(ms, n, name) {
    if (ms < n) return;
    if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
    return Math.ceil(ms / n) + ' ' + name + 's';
  }
});

parcelRegister('cOaH8', function (module, exports) {
  /**
   * Module dependencies.
   */

  /**
   * This is the Node.js implementation of `debug()`.
   *
   * Expose `debug()` as the module.
   */ exports = module.exports = parcelRequire('hYtaZ');
  exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  /**
   * Colors.
   */ exports.colors = [6, 2, 3, 4, 5, 1];
  /**
   * Build up the default `inspectOpts` object from the environment variables.
   *
   *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
   */ exports.inspectOpts = Object.keys(process.env)
    .filter(function (key) {
      return /^debug_/i.test(key);
    })
    .reduce(function (obj, key) {
      // camel-case
      var prop = key
        .substring(6)
        .toLowerCase()
        .replace(/_([a-z])/g, function (_, k) {
          return k.toUpperCase();
        });
      // coerce string value into JS value
      var val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
      else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
      else if (val === 'null') val = null;
      else val = Number(val);
      obj[prop] = val;
      return obj;
    }, {});
  /**
   * The file descriptor to write the `debug()` calls to.
   * Set the `DEBUG_FD` env variable to override with another value. i.e.:
   *
   *   $ DEBUG_FD=3 node script.js 3>debug.log
   */ var fd = parseInt(process.env.DEBUG_FD, 10) || 2;
  if (1 !== fd && 2 !== fd)
    $dmXIQ$util.deprecate(function () {},
    'except for stderr(2) and stdout(1), any other usage of DEBUG_FD is deprecated. Override debug.log if you want to use a different log function (https://git.io/debug_fd)')();
  var stream =
    1 === fd
      ? process.stdout
      : 2 === fd
      ? process.stderr
      : createWritableStdioStream(fd);
  /**
   * Is stdout a TTY? Colored output is enabled when `true`.
   */ function useColors() {
    return 'colors' in exports.inspectOpts
      ? Boolean(exports.inspectOpts.colors)
      : $dmXIQ$tty.isatty(fd);
  }
  /**
   * Map %o to `util.inspect()`, all on a single line.
   */ exports.formatters.o = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util
      .inspect(v, this.inspectOpts)
      .split('\n')
      .map(function (str) {
        return str.trim();
      })
      .join(' ');
  };
  /**
   * Map %o to `util.inspect()`, allowing multiple lines if needed.
   */ exports.formatters.O = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util.inspect(v, this.inspectOpts);
  };
  /**
   * Adds ANSI color escape codes if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    var name = this.namespace;
    var useColors = this.useColors;
    if (useColors) {
      var c = this.color;
      var prefix = '  \x1b[3' + c + ';1m' + name + ' ' + '\x1b[0m';
      args[0] = prefix + args[0].split('\n').join('\n' + prefix);
      args.push('\x1b[3' + c + 'm+' + exports.humanize(this.diff) + '\x1b[0m');
    } else args[0] = new Date().toUTCString() + ' ' + name + ' ' + args[0];
  }
  /**
   * Invokes `util.format()` with the specified arguments and writes to `stream`.
   */ function log() {
    return stream.write(
      $dmXIQ$util.format.apply($dmXIQ$util, arguments) + '\n',
    );
  }
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    if (null == namespaces)
      // If you set a process.env field to null or undefined, it gets cast to the
      // string 'null' or 'undefined'. Just delete instead.
      delete process.env.DEBUG;
    else process.env.DEBUG = namespaces;
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    return process.env.DEBUG;
  }

  /**
   * Copied from `node/src/node.js`.
   *
   * XXX: It's lame that node doesn't expose this API out-of-the-box. It also
   * relies on the undocumented `tty_wrap.guessHandleType()` which is also lame.
   */ function createWritableStdioStream(fd) {
    var stream;
    var tty_wrap = process.binding('tty_wrap');
    // Note stream._type is used for test-module-load-list.js
    switch (tty_wrap.guessHandleType(fd)) {
      case 'TTY':
        stream = new $dmXIQ$tty.WriteStream(fd);
        stream._type = 'tty';
        // Hack to have stream not keep the event loop alive.
        // See https://github.com/joyent/node/issues/1726
        if (stream._handle && stream._handle.unref) stream._handle.unref();
        break;
      case 'FILE':
        var fs = $dmXIQ$fs;
        stream = new fs.SyncWriteStream(fd, {
          autoClose: false,
        });
        stream._type = 'fs';
        break;
      case 'PIPE':
      case 'TCP':
        var net = $dmXIQ$net;
        stream = new net.Socket({
          fd: fd,
          readable: false,
          writable: true,
        });
        // FIXME Should probably have an option in net.Socket to create a
        // stream from an existing fd which is writable only. But for now
        // we'll just add this hack and set the `readable` member to false.
        // Test: ./node test/fixtures/echo.js < /etc/passwd
        stream.readable = false;
        stream.read = null;
        stream._type = 'pipe';
        // FIXME Hack to have stream not keep the event loop alive.
        // See https://github.com/joyent/node/issues/1726
        if (stream._handle && stream._handle.unref) stream._handle.unref();
        break;
      default:
        // Probably an error on in uv_guess_handle()
        throw new Error('Implement me. Unknown stream file type!');
    }
    // For supporting legacy API we put the FD here.
    stream.fd = fd;
    stream._isStdio = true;
    return stream;
  }
  /**
   * Init logic for `debug` instances.
   *
   * Create a new `inspectOpts` object in case `useColors` is set
   * differently for a particular `debug` instance.
   */ function init(debug) {
    debug.inspectOpts = {};
    var keys = Object.keys(exports.inspectOpts);
    for (var i = 0; i < keys.length; i++)
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
  }
  /**
   * Enable namespaces listed in `process.env.DEBUG` initially.
   */ exports.enable(load());
});

parcelRegister('im7pL', function (module, exports) {
  /**
   * Merge object b with object a.
   *
   *     var a = { foo: 'bar' }
   *       , b = { bar: 'baz' };
   *
   *     merge(a, b);
   *     // => { foo: 'bar', bar: 'baz' }
   *
   * @param {Object} a
   * @param {Object} b
   * @return {Object}
   * @api public
   */ exports = module.exports = function (a, b) {
    if (a && b) for (var key in b) a[key] = b[key];
    return a;
  };
});

parcelRegister('fQuRa', function (module, exports) {
  module.exports = JSON.parse(
    '{"application/1d-interleaved-parityfec":{"source":"iana"},"application/3gpdash-qoe-report+xml":{"source":"iana"},"application/3gpp-ims+xml":{"source":"iana"},"application/a2l":{"source":"iana"},"application/activemessage":{"source":"iana"},"application/alto-costmap+json":{"source":"iana","compressible":true},"application/alto-costmapfilter+json":{"source":"iana","compressible":true},"application/alto-directory+json":{"source":"iana","compressible":true},"application/alto-endpointcost+json":{"source":"iana","compressible":true},"application/alto-endpointcostparams+json":{"source":"iana","compressible":true},"application/alto-endpointprop+json":{"source":"iana","compressible":true},"application/alto-endpointpropparams+json":{"source":"iana","compressible":true},"application/alto-error+json":{"source":"iana","compressible":true},"application/alto-networkmap+json":{"source":"iana","compressible":true},"application/alto-networkmapfilter+json":{"source":"iana","compressible":true},"application/aml":{"source":"iana"},"application/andrew-inset":{"source":"iana","extensions":["ez"]},"application/applefile":{"source":"iana"},"application/applixware":{"source":"apache","extensions":["aw"]},"application/atf":{"source":"iana"},"application/atfx":{"source":"iana"},"application/atom+xml":{"source":"iana","compressible":true,"extensions":["atom"]},"application/atomcat+xml":{"source":"iana","extensions":["atomcat"]},"application/atomdeleted+xml":{"source":"iana"},"application/atomicmail":{"source":"iana"},"application/atomsvc+xml":{"source":"iana","extensions":["atomsvc"]},"application/atxml":{"source":"iana"},"application/auth-policy+xml":{"source":"iana"},"application/bacnet-xdd+zip":{"source":"iana"},"application/batch-smtp":{"source":"iana"},"application/bdoc":{"compressible":false,"extensions":["bdoc"]},"application/beep+xml":{"source":"iana"},"application/calendar+json":{"source":"iana","compressible":true},"application/calendar+xml":{"source":"iana"},"application/call-completion":{"source":"iana"},"application/cals-1840":{"source":"iana"},"application/cbor":{"source":"iana"},"application/cccex":{"source":"iana"},"application/ccmp+xml":{"source":"iana"},"application/ccxml+xml":{"source":"iana","extensions":["ccxml"]},"application/cdfx+xml":{"source":"iana"},"application/cdmi-capability":{"source":"iana","extensions":["cdmia"]},"application/cdmi-container":{"source":"iana","extensions":["cdmic"]},"application/cdmi-domain":{"source":"iana","extensions":["cdmid"]},"application/cdmi-object":{"source":"iana","extensions":["cdmio"]},"application/cdmi-queue":{"source":"iana","extensions":["cdmiq"]},"application/cdni":{"source":"iana"},"application/cea":{"source":"iana"},"application/cea-2018+xml":{"source":"iana"},"application/cellml+xml":{"source":"iana"},"application/cfw":{"source":"iana"},"application/clue_info+xml":{"source":"iana"},"application/cms":{"source":"iana"},"application/cnrp+xml":{"source":"iana"},"application/coap-group+json":{"source":"iana","compressible":true},"application/coap-payload":{"source":"iana"},"application/commonground":{"source":"iana"},"application/conference-info+xml":{"source":"iana"},"application/cose":{"source":"iana"},"application/cose-key":{"source":"iana"},"application/cose-key-set":{"source":"iana"},"application/cpl+xml":{"source":"iana"},"application/csrattrs":{"source":"iana"},"application/csta+xml":{"source":"iana"},"application/cstadata+xml":{"source":"iana"},"application/csvm+json":{"source":"iana","compressible":true},"application/cu-seeme":{"source":"apache","extensions":["cu"]},"application/cybercash":{"source":"iana"},"application/dart":{"compressible":true},"application/dash+xml":{"source":"iana","extensions":["mpd"]},"application/dashdelta":{"source":"iana"},"application/davmount+xml":{"source":"iana","extensions":["davmount"]},"application/dca-rft":{"source":"iana"},"application/dcd":{"source":"iana"},"application/dec-dx":{"source":"iana"},"application/dialog-info+xml":{"source":"iana"},"application/dicom":{"source":"iana"},"application/dicom+json":{"source":"iana","compressible":true},"application/dicom+xml":{"source":"iana"},"application/dii":{"source":"iana"},"application/dit":{"source":"iana"},"application/dns":{"source":"iana"},"application/docbook+xml":{"source":"apache","extensions":["dbk"]},"application/dskpp+xml":{"source":"iana"},"application/dssc+der":{"source":"iana","extensions":["dssc"]},"application/dssc+xml":{"source":"iana","extensions":["xdssc"]},"application/dvcs":{"source":"iana"},"application/ecmascript":{"source":"iana","compressible":true,"extensions":["ecma"]},"application/edi-consent":{"source":"iana"},"application/edi-x12":{"source":"iana","compressible":false},"application/edifact":{"source":"iana","compressible":false},"application/efi":{"source":"iana"},"application/emergencycalldata.comment+xml":{"source":"iana"},"application/emergencycalldata.control+xml":{"source":"iana"},"application/emergencycalldata.deviceinfo+xml":{"source":"iana"},"application/emergencycalldata.ecall.msd":{"source":"iana"},"application/emergencycalldata.providerinfo+xml":{"source":"iana"},"application/emergencycalldata.serviceinfo+xml":{"source":"iana"},"application/emergencycalldata.subscriberinfo+xml":{"source":"iana"},"application/emergencycalldata.veds+xml":{"source":"iana"},"application/emma+xml":{"source":"iana","extensions":["emma"]},"application/emotionml+xml":{"source":"iana"},"application/encaprtp":{"source":"iana"},"application/epp+xml":{"source":"iana"},"application/epub+zip":{"source":"iana","extensions":["epub"]},"application/eshop":{"source":"iana"},"application/exi":{"source":"iana","extensions":["exi"]},"application/fastinfoset":{"source":"iana"},"application/fastsoap":{"source":"iana"},"application/fdt+xml":{"source":"iana"},"application/fhir+xml":{"source":"iana"},"application/fido.trusted-apps+json":{"compressible":true},"application/fits":{"source":"iana"},"application/font-sfnt":{"source":"iana"},"application/font-tdpfr":{"source":"iana","extensions":["pfr"]},"application/font-woff":{"source":"iana","compressible":false,"extensions":["woff"]},"application/framework-attributes+xml":{"source":"iana"},"application/geo+json":{"source":"iana","compressible":true,"extensions":["geojson"]},"application/geo+json-seq":{"source":"iana"},"application/geoxacml+xml":{"source":"iana"},"application/gml+xml":{"source":"iana","extensions":["gml"]},"application/gpx+xml":{"source":"apache","extensions":["gpx"]},"application/gxf":{"source":"apache","extensions":["gxf"]},"application/gzip":{"source":"iana","compressible":false,"extensions":["gz"]},"application/h224":{"source":"iana"},"application/held+xml":{"source":"iana"},"application/hjson":{"extensions":["hjson"]},"application/http":{"source":"iana"},"application/hyperstudio":{"source":"iana","extensions":["stk"]},"application/ibe-key-request+xml":{"source":"iana"},"application/ibe-pkg-reply+xml":{"source":"iana"},"application/ibe-pp-data":{"source":"iana"},"application/iges":{"source":"iana"},"application/im-iscomposing+xml":{"source":"iana"},"application/index":{"source":"iana"},"application/index.cmd":{"source":"iana"},"application/index.obj":{"source":"iana"},"application/index.response":{"source":"iana"},"application/index.vnd":{"source":"iana"},"application/inkml+xml":{"source":"iana","extensions":["ink","inkml"]},"application/iotp":{"source":"iana"},"application/ipfix":{"source":"iana","extensions":["ipfix"]},"application/ipp":{"source":"iana"},"application/isup":{"source":"iana"},"application/its+xml":{"source":"iana"},"application/java-archive":{"source":"apache","compressible":false,"extensions":["jar","war","ear"]},"application/java-serialized-object":{"source":"apache","compressible":false,"extensions":["ser"]},"application/java-vm":{"source":"apache","compressible":false,"extensions":["class"]},"application/javascript":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["js","mjs"]},"application/jf2feed+json":{"source":"iana","compressible":true},"application/jose":{"source":"iana"},"application/jose+json":{"source":"iana","compressible":true},"application/jrd+json":{"source":"iana","compressible":true},"application/json":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["json","map"]},"application/json-patch+json":{"source":"iana","compressible":true},"application/json-seq":{"source":"iana"},"application/json5":{"extensions":["json5"]},"application/jsonml+json":{"source":"apache","compressible":true,"extensions":["jsonml"]},"application/jwk+json":{"source":"iana","compressible":true},"application/jwk-set+json":{"source":"iana","compressible":true},"application/jwt":{"source":"iana"},"application/kpml-request+xml":{"source":"iana"},"application/kpml-response+xml":{"source":"iana"},"application/ld+json":{"source":"iana","compressible":true,"extensions":["jsonld"]},"application/lgr+xml":{"source":"iana"},"application/link-format":{"source":"iana"},"application/load-control+xml":{"source":"iana"},"application/lost+xml":{"source":"iana","extensions":["lostxml"]},"application/lostsync+xml":{"source":"iana"},"application/lxf":{"source":"iana"},"application/mac-binhex40":{"source":"iana","extensions":["hqx"]},"application/mac-compactpro":{"source":"apache","extensions":["cpt"]},"application/macwriteii":{"source":"iana"},"application/mads+xml":{"source":"iana","extensions":["mads"]},"application/manifest+json":{"charset":"UTF-8","compressible":true,"extensions":["webmanifest"]},"application/marc":{"source":"iana","extensions":["mrc"]},"application/marcxml+xml":{"source":"iana","extensions":["mrcx"]},"application/mathematica":{"source":"iana","extensions":["ma","nb","mb"]},"application/mathml+xml":{"source":"iana","extensions":["mathml"]},"application/mathml-content+xml":{"source":"iana"},"application/mathml-presentation+xml":{"source":"iana"},"application/mbms-associated-procedure-description+xml":{"source":"iana"},"application/mbms-deregister+xml":{"source":"iana"},"application/mbms-envelope+xml":{"source":"iana"},"application/mbms-msk+xml":{"source":"iana"},"application/mbms-msk-response+xml":{"source":"iana"},"application/mbms-protection-description+xml":{"source":"iana"},"application/mbms-reception-report+xml":{"source":"iana"},"application/mbms-register+xml":{"source":"iana"},"application/mbms-register-response+xml":{"source":"iana"},"application/mbms-schedule+xml":{"source":"iana"},"application/mbms-user-service-description+xml":{"source":"iana"},"application/mbox":{"source":"iana","extensions":["mbox"]},"application/media-policy-dataset+xml":{"source":"iana"},"application/media_control+xml":{"source":"iana"},"application/mediaservercontrol+xml":{"source":"iana","extensions":["mscml"]},"application/merge-patch+json":{"source":"iana","compressible":true},"application/metalink+xml":{"source":"apache","extensions":["metalink"]},"application/metalink4+xml":{"source":"iana","extensions":["meta4"]},"application/mets+xml":{"source":"iana","extensions":["mets"]},"application/mf4":{"source":"iana"},"application/mikey":{"source":"iana"},"application/mmt-usd+xml":{"source":"iana"},"application/mods+xml":{"source":"iana","extensions":["mods"]},"application/moss-keys":{"source":"iana"},"application/moss-signature":{"source":"iana"},"application/mosskey-data":{"source":"iana"},"application/mosskey-request":{"source":"iana"},"application/mp21":{"source":"iana","extensions":["m21","mp21"]},"application/mp4":{"source":"iana","extensions":["mp4s","m4p"]},"application/mpeg4-generic":{"source":"iana"},"application/mpeg4-iod":{"source":"iana"},"application/mpeg4-iod-xmt":{"source":"iana"},"application/mrb-consumer+xml":{"source":"iana"},"application/mrb-publish+xml":{"source":"iana"},"application/msc-ivr+xml":{"source":"iana"},"application/msc-mixer+xml":{"source":"iana"},"application/msword":{"source":"iana","compressible":false,"extensions":["doc","dot"]},"application/mud+json":{"source":"iana","compressible":true},"application/mxf":{"source":"iana","extensions":["mxf"]},"application/n-quads":{"source":"iana"},"application/n-triples":{"source":"iana"},"application/nasdata":{"source":"iana"},"application/news-checkgroups":{"source":"iana"},"application/news-groupinfo":{"source":"iana"},"application/news-transmission":{"source":"iana"},"application/nlsml+xml":{"source":"iana"},"application/node":{"source":"iana"},"application/nss":{"source":"iana"},"application/ocsp-request":{"source":"iana"},"application/ocsp-response":{"source":"iana"},"application/octet-stream":{"source":"iana","compressible":false,"extensions":["bin","dms","lrf","mar","so","dist","distz","pkg","bpk","dump","elc","deploy","exe","dll","deb","dmg","iso","img","msi","msp","msm","buffer"]},"application/oda":{"source":"iana","extensions":["oda"]},"application/odx":{"source":"iana"},"application/oebps-package+xml":{"source":"iana","extensions":["opf"]},"application/ogg":{"source":"iana","compressible":false,"extensions":["ogx"]},"application/omdoc+xml":{"source":"apache","extensions":["omdoc"]},"application/onenote":{"source":"apache","extensions":["onetoc","onetoc2","onetmp","onepkg"]},"application/oxps":{"source":"iana","extensions":["oxps"]},"application/p2p-overlay+xml":{"source":"iana"},"application/parityfec":{"source":"iana"},"application/passport":{"source":"iana"},"application/patch-ops-error+xml":{"source":"iana","extensions":["xer"]},"application/pdf":{"source":"iana","compressible":false,"extensions":["pdf"]},"application/pdx":{"source":"iana"},"application/pgp-encrypted":{"source":"iana","compressible":false,"extensions":["pgp"]},"application/pgp-keys":{"source":"iana"},"application/pgp-signature":{"source":"iana","extensions":["asc","sig"]},"application/pics-rules":{"source":"apache","extensions":["prf"]},"application/pidf+xml":{"source":"iana"},"application/pidf-diff+xml":{"source":"iana"},"application/pkcs10":{"source":"iana","extensions":["p10"]},"application/pkcs12":{"source":"iana"},"application/pkcs7-mime":{"source":"iana","extensions":["p7m","p7c"]},"application/pkcs7-signature":{"source":"iana","extensions":["p7s"]},"application/pkcs8":{"source":"iana","extensions":["p8"]},"application/pkcs8-encrypted":{"source":"iana"},"application/pkix-attr-cert":{"source":"iana","extensions":["ac"]},"application/pkix-cert":{"source":"iana","extensions":["cer"]},"application/pkix-crl":{"source":"iana","extensions":["crl"]},"application/pkix-pkipath":{"source":"iana","extensions":["pkipath"]},"application/pkixcmp":{"source":"iana","extensions":["pki"]},"application/pls+xml":{"source":"iana","extensions":["pls"]},"application/poc-settings+xml":{"source":"iana"},"application/postscript":{"source":"iana","compressible":true,"extensions":["ai","eps","ps"]},"application/ppsp-tracker+json":{"source":"iana","compressible":true},"application/problem+json":{"source":"iana","compressible":true},"application/problem+xml":{"source":"iana"},"application/provenance+xml":{"source":"iana"},"application/prs.alvestrand.titrax-sheet":{"source":"iana"},"application/prs.cww":{"source":"iana","extensions":["cww"]},"application/prs.hpub+zip":{"source":"iana"},"application/prs.nprend":{"source":"iana"},"application/prs.plucker":{"source":"iana"},"application/prs.rdf-xml-crypt":{"source":"iana"},"application/prs.xsf+xml":{"source":"iana"},"application/pskc+xml":{"source":"iana","extensions":["pskcxml"]},"application/qsig":{"source":"iana"},"application/raml+yaml":{"compressible":true,"extensions":["raml"]},"application/raptorfec":{"source":"iana"},"application/rdap+json":{"source":"iana","compressible":true},"application/rdf+xml":{"source":"iana","compressible":true,"extensions":["rdf"]},"application/reginfo+xml":{"source":"iana","extensions":["rif"]},"application/relax-ng-compact-syntax":{"source":"iana","extensions":["rnc"]},"application/remote-printing":{"source":"iana"},"application/reputon+json":{"source":"iana","compressible":true},"application/resource-lists+xml":{"source":"iana","extensions":["rl"]},"application/resource-lists-diff+xml":{"source":"iana","extensions":["rld"]},"application/rfc+xml":{"source":"iana"},"application/riscos":{"source":"iana"},"application/rlmi+xml":{"source":"iana"},"application/rls-services+xml":{"source":"iana","extensions":["rs"]},"application/route-apd+xml":{"source":"iana"},"application/route-s-tsid+xml":{"source":"iana"},"application/route-usd+xml":{"source":"iana"},"application/rpki-ghostbusters":{"source":"iana","extensions":["gbr"]},"application/rpki-manifest":{"source":"iana","extensions":["mft"]},"application/rpki-publication":{"source":"iana"},"application/rpki-roa":{"source":"iana","extensions":["roa"]},"application/rpki-updown":{"source":"iana"},"application/rsd+xml":{"source":"apache","extensions":["rsd"]},"application/rss+xml":{"source":"apache","compressible":true,"extensions":["rss"]},"application/rtf":{"source":"iana","compressible":true,"extensions":["rtf"]},"application/rtploopback":{"source":"iana"},"application/rtx":{"source":"iana"},"application/samlassertion+xml":{"source":"iana"},"application/samlmetadata+xml":{"source":"iana"},"application/sbml+xml":{"source":"iana","extensions":["sbml"]},"application/scaip+xml":{"source":"iana"},"application/scim+json":{"source":"iana","compressible":true},"application/scvp-cv-request":{"source":"iana","extensions":["scq"]},"application/scvp-cv-response":{"source":"iana","extensions":["scs"]},"application/scvp-vp-request":{"source":"iana","extensions":["spq"]},"application/scvp-vp-response":{"source":"iana","extensions":["spp"]},"application/sdp":{"source":"iana","extensions":["sdp"]},"application/sep+xml":{"source":"iana"},"application/sep-exi":{"source":"iana"},"application/session-info":{"source":"iana"},"application/set-payment":{"source":"iana"},"application/set-payment-initiation":{"source":"iana","extensions":["setpay"]},"application/set-registration":{"source":"iana"},"application/set-registration-initiation":{"source":"iana","extensions":["setreg"]},"application/sgml":{"source":"iana"},"application/sgml-open-catalog":{"source":"iana"},"application/shf+xml":{"source":"iana","extensions":["shf"]},"application/sieve":{"source":"iana"},"application/simple-filter+xml":{"source":"iana"},"application/simple-message-summary":{"source":"iana"},"application/simplesymbolcontainer":{"source":"iana"},"application/slate":{"source":"iana"},"application/smil":{"source":"iana"},"application/smil+xml":{"source":"iana","extensions":["smi","smil"]},"application/smpte336m":{"source":"iana"},"application/soap+fastinfoset":{"source":"iana"},"application/soap+xml":{"source":"iana","compressible":true},"application/sparql-query":{"source":"iana","extensions":["rq"]},"application/sparql-results+xml":{"source":"iana","extensions":["srx"]},"application/spirits-event+xml":{"source":"iana"},"application/sql":{"source":"iana"},"application/srgs":{"source":"iana","extensions":["gram"]},"application/srgs+xml":{"source":"iana","extensions":["grxml"]},"application/sru+xml":{"source":"iana","extensions":["sru"]},"application/ssdl+xml":{"source":"apache","extensions":["ssdl"]},"application/ssml+xml":{"source":"iana","extensions":["ssml"]},"application/tamp-apex-update":{"source":"iana"},"application/tamp-apex-update-confirm":{"source":"iana"},"application/tamp-community-update":{"source":"iana"},"application/tamp-community-update-confirm":{"source":"iana"},"application/tamp-error":{"source":"iana"},"application/tamp-sequence-adjust":{"source":"iana"},"application/tamp-sequence-adjust-confirm":{"source":"iana"},"application/tamp-status-query":{"source":"iana"},"application/tamp-status-response":{"source":"iana"},"application/tamp-update":{"source":"iana"},"application/tamp-update-confirm":{"source":"iana"},"application/tar":{"compressible":true},"application/tei+xml":{"source":"iana","extensions":["tei","teicorpus"]},"application/thraud+xml":{"source":"iana","extensions":["tfi"]},"application/timestamp-query":{"source":"iana"},"application/timestamp-reply":{"source":"iana"},"application/timestamped-data":{"source":"iana","extensions":["tsd"]},"application/tnauthlist":{"source":"iana"},"application/trig":{"source":"iana"},"application/ttml+xml":{"source":"iana"},"application/tve-trigger":{"source":"iana"},"application/ulpfec":{"source":"iana"},"application/urc-grpsheet+xml":{"source":"iana"},"application/urc-ressheet+xml":{"source":"iana"},"application/urc-targetdesc+xml":{"source":"iana"},"application/urc-uisocketdesc+xml":{"source":"iana"},"application/vcard+json":{"source":"iana","compressible":true},"application/vcard+xml":{"source":"iana"},"application/vemmi":{"source":"iana"},"application/vividence.scriptfile":{"source":"apache"},"application/vnd.1000minds.decision-model+xml":{"source":"iana"},"application/vnd.3gpp-prose+xml":{"source":"iana"},"application/vnd.3gpp-prose-pc3ch+xml":{"source":"iana"},"application/vnd.3gpp-v2x-local-service-information":{"source":"iana"},"application/vnd.3gpp.access-transfer-events+xml":{"source":"iana"},"application/vnd.3gpp.bsf+xml":{"source":"iana"},"application/vnd.3gpp.gmop+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-affiliation-command+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-floor-request+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-location-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-mbms-usage-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-signed+xml":{"source":"iana"},"application/vnd.3gpp.mid-call+xml":{"source":"iana"},"application/vnd.3gpp.pic-bw-large":{"source":"iana","extensions":["plb"]},"application/vnd.3gpp.pic-bw-small":{"source":"iana","extensions":["psb"]},"application/vnd.3gpp.pic-bw-var":{"source":"iana","extensions":["pvb"]},"application/vnd.3gpp.sms":{"source":"iana"},"application/vnd.3gpp.sms+xml":{"source":"iana"},"application/vnd.3gpp.srvcc-ext+xml":{"source":"iana"},"application/vnd.3gpp.srvcc-info+xml":{"source":"iana"},"application/vnd.3gpp.state-and-event-info+xml":{"source":"iana"},"application/vnd.3gpp.ussd+xml":{"source":"iana"},"application/vnd.3gpp2.bcmcsinfo+xml":{"source":"iana"},"application/vnd.3gpp2.sms":{"source":"iana"},"application/vnd.3gpp2.tcap":{"source":"iana","extensions":["tcap"]},"application/vnd.3lightssoftware.imagescal":{"source":"iana"},"application/vnd.3m.post-it-notes":{"source":"iana","extensions":["pwn"]},"application/vnd.accpac.simply.aso":{"source":"iana","extensions":["aso"]},"application/vnd.accpac.simply.imp":{"source":"iana","extensions":["imp"]},"application/vnd.acucobol":{"source":"iana","extensions":["acu"]},"application/vnd.acucorp":{"source":"iana","extensions":["atc","acutc"]},"application/vnd.adobe.air-application-installer-package+zip":{"source":"apache","extensions":["air"]},"application/vnd.adobe.flash.movie":{"source":"iana"},"application/vnd.adobe.formscentral.fcdt":{"source":"iana","extensions":["fcdt"]},"application/vnd.adobe.fxp":{"source":"iana","extensions":["fxp","fxpl"]},"application/vnd.adobe.partial-upload":{"source":"iana"},"application/vnd.adobe.xdp+xml":{"source":"iana","extensions":["xdp"]},"application/vnd.adobe.xfdf":{"source":"iana","extensions":["xfdf"]},"application/vnd.aether.imp":{"source":"iana"},"application/vnd.ah-barcode":{"source":"iana"},"application/vnd.ahead.space":{"source":"iana","extensions":["ahead"]},"application/vnd.airzip.filesecure.azf":{"source":"iana","extensions":["azf"]},"application/vnd.airzip.filesecure.azs":{"source":"iana","extensions":["azs"]},"application/vnd.amadeus+json":{"source":"iana","compressible":true},"application/vnd.amazon.ebook":{"source":"apache","extensions":["azw"]},"application/vnd.amazon.mobi8-ebook":{"source":"iana"},"application/vnd.americandynamics.acc":{"source":"iana","extensions":["acc"]},"application/vnd.amiga.ami":{"source":"iana","extensions":["ami"]},"application/vnd.amundsen.maze+xml":{"source":"iana"},"application/vnd.android.package-archive":{"source":"apache","compressible":false,"extensions":["apk"]},"application/vnd.anki":{"source":"iana"},"application/vnd.anser-web-certificate-issue-initiation":{"source":"iana","extensions":["cii"]},"application/vnd.anser-web-funds-transfer-initiation":{"source":"apache","extensions":["fti"]},"application/vnd.antix.game-component":{"source":"iana","extensions":["atx"]},"application/vnd.apache.thrift.binary":{"source":"iana"},"application/vnd.apache.thrift.compact":{"source":"iana"},"application/vnd.apache.thrift.json":{"source":"iana"},"application/vnd.api+json":{"source":"iana","compressible":true},"application/vnd.apothekende.reservation+json":{"source":"iana","compressible":true},"application/vnd.apple.installer+xml":{"source":"iana","extensions":["mpkg"]},"application/vnd.apple.mpegurl":{"source":"iana","extensions":["m3u8"]},"application/vnd.apple.pkpass":{"compressible":false,"extensions":["pkpass"]},"application/vnd.arastra.swi":{"source":"iana"},"application/vnd.aristanetworks.swi":{"source":"iana","extensions":["swi"]},"application/vnd.artsquare":{"source":"iana"},"application/vnd.astraea-software.iota":{"source":"iana","extensions":["iota"]},"application/vnd.audiograph":{"source":"iana","extensions":["aep"]},"application/vnd.autopackage":{"source":"iana"},"application/vnd.avalon+json":{"source":"iana","compressible":true},"application/vnd.avistar+xml":{"source":"iana"},"application/vnd.balsamiq.bmml+xml":{"source":"iana"},"application/vnd.balsamiq.bmpr":{"source":"iana"},"application/vnd.bbf.usp.msg":{"source":"iana"},"application/vnd.bbf.usp.msg+json":{"source":"iana","compressible":true},"application/vnd.bekitzur-stech+json":{"source":"iana","compressible":true},"application/vnd.bint.med-content":{"source":"iana"},"application/vnd.biopax.rdf+xml":{"source":"iana"},"application/vnd.blink-idb-value-wrapper":{"source":"iana"},"application/vnd.blueice.multipass":{"source":"iana","extensions":["mpm"]},"application/vnd.bluetooth.ep.oob":{"source":"iana"},"application/vnd.bluetooth.le.oob":{"source":"iana"},"application/vnd.bmi":{"source":"iana","extensions":["bmi"]},"application/vnd.businessobjects":{"source":"iana","extensions":["rep"]},"application/vnd.cab-jscript":{"source":"iana"},"application/vnd.canon-cpdl":{"source":"iana"},"application/vnd.canon-lips":{"source":"iana"},"application/vnd.capasystems-pg+json":{"source":"iana","compressible":true},"application/vnd.cendio.thinlinc.clientconf":{"source":"iana"},"application/vnd.century-systems.tcp_stream":{"source":"iana"},"application/vnd.chemdraw+xml":{"source":"iana","extensions":["cdxml"]},"application/vnd.chess-pgn":{"source":"iana"},"application/vnd.chipnuts.karaoke-mmd":{"source":"iana","extensions":["mmd"]},"application/vnd.cinderella":{"source":"iana","extensions":["cdy"]},"application/vnd.cirpack.isdn-ext":{"source":"iana"},"application/vnd.citationstyles.style+xml":{"source":"iana"},"application/vnd.claymore":{"source":"iana","extensions":["cla"]},"application/vnd.cloanto.rp9":{"source":"iana","extensions":["rp9"]},"application/vnd.clonk.c4group":{"source":"iana","extensions":["c4g","c4d","c4f","c4p","c4u"]},"application/vnd.cluetrust.cartomobile-config":{"source":"iana","extensions":["c11amc"]},"application/vnd.cluetrust.cartomobile-config-pkg":{"source":"iana","extensions":["c11amz"]},"application/vnd.coffeescript":{"source":"iana"},"application/vnd.collabio.xodocuments.document":{"source":"iana"},"application/vnd.collabio.xodocuments.document-template":{"source":"iana"},"application/vnd.collabio.xodocuments.presentation":{"source":"iana"},"application/vnd.collabio.xodocuments.presentation-template":{"source":"iana"},"application/vnd.collabio.xodocuments.spreadsheet":{"source":"iana"},"application/vnd.collabio.xodocuments.spreadsheet-template":{"source":"iana"},"application/vnd.collection+json":{"source":"iana","compressible":true},"application/vnd.collection.doc+json":{"source":"iana","compressible":true},"application/vnd.collection.next+json":{"source":"iana","compressible":true},"application/vnd.comicbook+zip":{"source":"iana"},"application/vnd.comicbook-rar":{"source":"iana"},"application/vnd.commerce-battelle":{"source":"iana"},"application/vnd.commonspace":{"source":"iana","extensions":["csp"]},"application/vnd.contact.cmsg":{"source":"iana","extensions":["cdbcmsg"]},"application/vnd.coreos.ignition+json":{"source":"iana","compressible":true},"application/vnd.cosmocaller":{"source":"iana","extensions":["cmc"]},"application/vnd.crick.clicker":{"source":"iana","extensions":["clkx"]},"application/vnd.crick.clicker.keyboard":{"source":"iana","extensions":["clkk"]},"application/vnd.crick.clicker.palette":{"source":"iana","extensions":["clkp"]},"application/vnd.crick.clicker.template":{"source":"iana","extensions":["clkt"]},"application/vnd.crick.clicker.wordbank":{"source":"iana","extensions":["clkw"]},"application/vnd.criticaltools.wbs+xml":{"source":"iana","extensions":["wbs"]},"application/vnd.ctc-posml":{"source":"iana","extensions":["pml"]},"application/vnd.ctct.ws+xml":{"source":"iana"},"application/vnd.cups-pdf":{"source":"iana"},"application/vnd.cups-postscript":{"source":"iana"},"application/vnd.cups-ppd":{"source":"iana","extensions":["ppd"]},"application/vnd.cups-raster":{"source":"iana"},"application/vnd.cups-raw":{"source":"iana"},"application/vnd.curl":{"source":"iana"},"application/vnd.curl.car":{"source":"apache","extensions":["car"]},"application/vnd.curl.pcurl":{"source":"apache","extensions":["pcurl"]},"application/vnd.cyan.dean.root+xml":{"source":"iana"},"application/vnd.cybank":{"source":"iana"},"application/vnd.d2l.coursepackage1p0+zip":{"source":"iana"},"application/vnd.dart":{"source":"iana","compressible":true,"extensions":["dart"]},"application/vnd.data-vision.rdz":{"source":"iana","extensions":["rdz"]},"application/vnd.datapackage+json":{"source":"iana","compressible":true},"application/vnd.dataresource+json":{"source":"iana","compressible":true},"application/vnd.debian.binary-package":{"source":"iana"},"application/vnd.dece.data":{"source":"iana","extensions":["uvf","uvvf","uvd","uvvd"]},"application/vnd.dece.ttml+xml":{"source":"iana","extensions":["uvt","uvvt"]},"application/vnd.dece.unspecified":{"source":"iana","extensions":["uvx","uvvx"]},"application/vnd.dece.zip":{"source":"iana","extensions":["uvz","uvvz"]},"application/vnd.denovo.fcselayout-link":{"source":"iana","extensions":["fe_launch"]},"application/vnd.desmume-movie":{"source":"iana"},"application/vnd.desmume.movie":{"source":"apache"},"application/vnd.dir-bi.plate-dl-nosuffix":{"source":"iana"},"application/vnd.dm.delegation+xml":{"source":"iana"},"application/vnd.dna":{"source":"iana","extensions":["dna"]},"application/vnd.document+json":{"source":"iana","compressible":true},"application/vnd.dolby.mlp":{"source":"apache","extensions":["mlp"]},"application/vnd.dolby.mobile.1":{"source":"iana"},"application/vnd.dolby.mobile.2":{"source":"iana"},"application/vnd.doremir.scorecloud-binary-document":{"source":"iana"},"application/vnd.dpgraph":{"source":"iana","extensions":["dpg"]},"application/vnd.dreamfactory":{"source":"iana","extensions":["dfac"]},"application/vnd.drive+json":{"source":"iana","compressible":true},"application/vnd.ds-keypoint":{"source":"apache","extensions":["kpxx"]},"application/vnd.dtg.local":{"source":"iana"},"application/vnd.dtg.local.flash":{"source":"iana"},"application/vnd.dtg.local.html":{"source":"iana"},"application/vnd.dvb.ait":{"source":"iana","extensions":["ait"]},"application/vnd.dvb.dvbj":{"source":"iana"},"application/vnd.dvb.esgcontainer":{"source":"iana"},"application/vnd.dvb.ipdcdftnotifaccess":{"source":"iana"},"application/vnd.dvb.ipdcesgaccess":{"source":"iana"},"application/vnd.dvb.ipdcesgaccess2":{"source":"iana"},"application/vnd.dvb.ipdcesgpdd":{"source":"iana"},"application/vnd.dvb.ipdcroaming":{"source":"iana"},"application/vnd.dvb.iptv.alfec-base":{"source":"iana"},"application/vnd.dvb.iptv.alfec-enhancement":{"source":"iana"},"application/vnd.dvb.notif-aggregate-root+xml":{"source":"iana"},"application/vnd.dvb.notif-container+xml":{"source":"iana"},"application/vnd.dvb.notif-generic+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-msglist+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-registration-request+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-registration-response+xml":{"source":"iana"},"application/vnd.dvb.notif-init+xml":{"source":"iana"},"application/vnd.dvb.pfr":{"source":"iana"},"application/vnd.dvb.service":{"source":"iana","extensions":["svc"]},"application/vnd.dxr":{"source":"iana"},"application/vnd.dynageo":{"source":"iana","extensions":["geo"]},"application/vnd.dzr":{"source":"iana"},"application/vnd.easykaraoke.cdgdownload":{"source":"iana"},"application/vnd.ecdis-update":{"source":"iana"},"application/vnd.ecip.rlp":{"source":"iana"},"application/vnd.ecowin.chart":{"source":"iana","extensions":["mag"]},"application/vnd.ecowin.filerequest":{"source":"iana"},"application/vnd.ecowin.fileupdate":{"source":"iana"},"application/vnd.ecowin.series":{"source":"iana"},"application/vnd.ecowin.seriesrequest":{"source":"iana"},"application/vnd.ecowin.seriesupdate":{"source":"iana"},"application/vnd.efi.img":{"source":"iana"},"application/vnd.efi.iso":{"source":"iana"},"application/vnd.emclient.accessrequest+xml":{"source":"iana"},"application/vnd.enliven":{"source":"iana","extensions":["nml"]},"application/vnd.enphase.envoy":{"source":"iana"},"application/vnd.eprints.data+xml":{"source":"iana"},"application/vnd.epson.esf":{"source":"iana","extensions":["esf"]},"application/vnd.epson.msf":{"source":"iana","extensions":["msf"]},"application/vnd.epson.quickanime":{"source":"iana","extensions":["qam"]},"application/vnd.epson.salt":{"source":"iana","extensions":["slt"]},"application/vnd.epson.ssf":{"source":"iana","extensions":["ssf"]},"application/vnd.ericsson.quickcall":{"source":"iana"},"application/vnd.espass-espass+zip":{"source":"iana"},"application/vnd.eszigno3+xml":{"source":"iana","extensions":["es3","et3"]},"application/vnd.etsi.aoc+xml":{"source":"iana"},"application/vnd.etsi.asic-e+zip":{"source":"iana"},"application/vnd.etsi.asic-s+zip":{"source":"iana"},"application/vnd.etsi.cug+xml":{"source":"iana"},"application/vnd.etsi.iptvcommand+xml":{"source":"iana"},"application/vnd.etsi.iptvdiscovery+xml":{"source":"iana"},"application/vnd.etsi.iptvprofile+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-bc+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-cod+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-npvr+xml":{"source":"iana"},"application/vnd.etsi.iptvservice+xml":{"source":"iana"},"application/vnd.etsi.iptvsync+xml":{"source":"iana"},"application/vnd.etsi.iptvueprofile+xml":{"source":"iana"},"application/vnd.etsi.mcid+xml":{"source":"iana"},"application/vnd.etsi.mheg5":{"source":"iana"},"application/vnd.etsi.overload-control-policy-dataset+xml":{"source":"iana"},"application/vnd.etsi.pstn+xml":{"source":"iana"},"application/vnd.etsi.sci+xml":{"source":"iana"},"application/vnd.etsi.simservs+xml":{"source":"iana"},"application/vnd.etsi.timestamp-token":{"source":"iana"},"application/vnd.etsi.tsl+xml":{"source":"iana"},"application/vnd.etsi.tsl.der":{"source":"iana"},"application/vnd.eudora.data":{"source":"iana"},"application/vnd.evolv.ecig.profile":{"source":"iana"},"application/vnd.evolv.ecig.settings":{"source":"iana"},"application/vnd.evolv.ecig.theme":{"source":"iana"},"application/vnd.ezpix-album":{"source":"iana","extensions":["ez2"]},"application/vnd.ezpix-package":{"source":"iana","extensions":["ez3"]},"application/vnd.f-secure.mobile":{"source":"iana"},"application/vnd.fastcopy-disk-image":{"source":"iana"},"application/vnd.fdf":{"source":"iana","extensions":["fdf"]},"application/vnd.fdsn.mseed":{"source":"iana","extensions":["mseed"]},"application/vnd.fdsn.seed":{"source":"iana","extensions":["seed","dataless"]},"application/vnd.ffsns":{"source":"iana"},"application/vnd.filmit.zfc":{"source":"iana"},"application/vnd.fints":{"source":"iana"},"application/vnd.firemonkeys.cloudcell":{"source":"iana"},"application/vnd.flographit":{"source":"iana","extensions":["gph"]},"application/vnd.fluxtime.clip":{"source":"iana","extensions":["ftc"]},"application/vnd.font-fontforge-sfd":{"source":"iana"},"application/vnd.framemaker":{"source":"iana","extensions":["fm","frame","maker","book"]},"application/vnd.frogans.fnc":{"source":"iana","extensions":["fnc"]},"application/vnd.frogans.ltf":{"source":"iana","extensions":["ltf"]},"application/vnd.fsc.weblaunch":{"source":"iana","extensions":["fsc"]},"application/vnd.fujitsu.oasys":{"source":"iana","extensions":["oas"]},"application/vnd.fujitsu.oasys2":{"source":"iana","extensions":["oa2"]},"application/vnd.fujitsu.oasys3":{"source":"iana","extensions":["oa3"]},"application/vnd.fujitsu.oasysgp":{"source":"iana","extensions":["fg5"]},"application/vnd.fujitsu.oasysprs":{"source":"iana","extensions":["bh2"]},"application/vnd.fujixerox.art-ex":{"source":"iana"},"application/vnd.fujixerox.art4":{"source":"iana"},"application/vnd.fujixerox.ddd":{"source":"iana","extensions":["ddd"]},"application/vnd.fujixerox.docuworks":{"source":"iana","extensions":["xdw"]},"application/vnd.fujixerox.docuworks.binder":{"source":"iana","extensions":["xbd"]},"application/vnd.fujixerox.docuworks.container":{"source":"iana"},"application/vnd.fujixerox.hbpl":{"source":"iana"},"application/vnd.fut-misnet":{"source":"iana"},"application/vnd.fuzzysheet":{"source":"iana","extensions":["fzs"]},"application/vnd.genomatix.tuxedo":{"source":"iana","extensions":["txd"]},"application/vnd.geo+json":{"source":"iana","compressible":true},"application/vnd.geocube+xml":{"source":"iana"},"application/vnd.geogebra.file":{"source":"iana","extensions":["ggb"]},"application/vnd.geogebra.tool":{"source":"iana","extensions":["ggt"]},"application/vnd.geometry-explorer":{"source":"iana","extensions":["gex","gre"]},"application/vnd.geonext":{"source":"iana","extensions":["gxt"]},"application/vnd.geoplan":{"source":"iana","extensions":["g2w"]},"application/vnd.geospace":{"source":"iana","extensions":["g3w"]},"application/vnd.gerber":{"source":"iana"},"application/vnd.globalplatform.card-content-mgt":{"source":"iana"},"application/vnd.globalplatform.card-content-mgt-response":{"source":"iana"},"application/vnd.gmx":{"source":"iana","extensions":["gmx"]},"application/vnd.google-apps.document":{"compressible":false,"extensions":["gdoc"]},"application/vnd.google-apps.presentation":{"compressible":false,"extensions":["gslides"]},"application/vnd.google-apps.spreadsheet":{"compressible":false,"extensions":["gsheet"]},"application/vnd.google-earth.kml+xml":{"source":"iana","compressible":true,"extensions":["kml"]},"application/vnd.google-earth.kmz":{"source":"iana","compressible":false,"extensions":["kmz"]},"application/vnd.gov.sk.e-form+xml":{"source":"iana"},"application/vnd.gov.sk.e-form+zip":{"source":"iana"},"application/vnd.gov.sk.xmldatacontainer+xml":{"source":"iana"},"application/vnd.grafeq":{"source":"iana","extensions":["gqf","gqs"]},"application/vnd.gridmp":{"source":"iana"},"application/vnd.groove-account":{"source":"iana","extensions":["gac"]},"application/vnd.groove-help":{"source":"iana","extensions":["ghf"]},"application/vnd.groove-identity-message":{"source":"iana","extensions":["gim"]},"application/vnd.groove-injector":{"source":"iana","extensions":["grv"]},"application/vnd.groove-tool-message":{"source":"iana","extensions":["gtm"]},"application/vnd.groove-tool-template":{"source":"iana","extensions":["tpl"]},"application/vnd.groove-vcard":{"source":"iana","extensions":["vcg"]},"application/vnd.hal+json":{"source":"iana","compressible":true},"application/vnd.hal+xml":{"source":"iana","extensions":["hal"]},"application/vnd.handheld-entertainment+xml":{"source":"iana","extensions":["zmm"]},"application/vnd.hbci":{"source":"iana","extensions":["hbci"]},"application/vnd.hc+json":{"source":"iana","compressible":true},"application/vnd.hcl-bireports":{"source":"iana"},"application/vnd.hdt":{"source":"iana"},"application/vnd.heroku+json":{"source":"iana","compressible":true},"application/vnd.hhe.lesson-player":{"source":"iana","extensions":["les"]},"application/vnd.hp-hpgl":{"source":"iana","extensions":["hpgl"]},"application/vnd.hp-hpid":{"source":"iana","extensions":["hpid"]},"application/vnd.hp-hps":{"source":"iana","extensions":["hps"]},"application/vnd.hp-jlyt":{"source":"iana","extensions":["jlt"]},"application/vnd.hp-pcl":{"source":"iana","extensions":["pcl"]},"application/vnd.hp-pclxl":{"source":"iana","extensions":["pclxl"]},"application/vnd.httphone":{"source":"iana"},"application/vnd.hydrostatix.sof-data":{"source":"iana","extensions":["sfd-hdstx"]},"application/vnd.hyper-item+json":{"source":"iana","compressible":true},"application/vnd.hyperdrive+json":{"source":"iana","compressible":true},"application/vnd.hzn-3d-crossword":{"source":"iana"},"application/vnd.ibm.afplinedata":{"source":"iana"},"application/vnd.ibm.electronic-media":{"source":"iana"},"application/vnd.ibm.minipay":{"source":"iana","extensions":["mpy"]},"application/vnd.ibm.modcap":{"source":"iana","extensions":["afp","listafp","list3820"]},"application/vnd.ibm.rights-management":{"source":"iana","extensions":["irm"]},"application/vnd.ibm.secure-container":{"source":"iana","extensions":["sc"]},"application/vnd.iccprofile":{"source":"iana","extensions":["icc","icm"]},"application/vnd.ieee.1905":{"source":"iana"},"application/vnd.igloader":{"source":"iana","extensions":["igl"]},"application/vnd.imagemeter.folder+zip":{"source":"iana"},"application/vnd.imagemeter.image+zip":{"source":"iana"},"application/vnd.immervision-ivp":{"source":"iana","extensions":["ivp"]},"application/vnd.immervision-ivu":{"source":"iana","extensions":["ivu"]},"application/vnd.ims.imsccv1p1":{"source":"iana"},"application/vnd.ims.imsccv1p2":{"source":"iana"},"application/vnd.ims.imsccv1p3":{"source":"iana"},"application/vnd.ims.lis.v2.result+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolconsumerprofile+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolproxy+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolproxy.id+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolsettings+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolsettings.simple+json":{"source":"iana","compressible":true},"application/vnd.informedcontrol.rms+xml":{"source":"iana"},"application/vnd.informix-visionary":{"source":"iana"},"application/vnd.infotech.project":{"source":"iana"},"application/vnd.infotech.project+xml":{"source":"iana"},"application/vnd.innopath.wamp.notification":{"source":"iana"},"application/vnd.insors.igm":{"source":"iana","extensions":["igm"]},"application/vnd.intercon.formnet":{"source":"iana","extensions":["xpw","xpx"]},"application/vnd.intergeo":{"source":"iana","extensions":["i2g"]},"application/vnd.intertrust.digibox":{"source":"iana"},"application/vnd.intertrust.nncp":{"source":"iana"},"application/vnd.intu.qbo":{"source":"iana","extensions":["qbo"]},"application/vnd.intu.qfx":{"source":"iana","extensions":["qfx"]},"application/vnd.iptc.g2.catalogitem+xml":{"source":"iana"},"application/vnd.iptc.g2.conceptitem+xml":{"source":"iana"},"application/vnd.iptc.g2.knowledgeitem+xml":{"source":"iana"},"application/vnd.iptc.g2.newsitem+xml":{"source":"iana"},"application/vnd.iptc.g2.newsmessage+xml":{"source":"iana"},"application/vnd.iptc.g2.packageitem+xml":{"source":"iana"},"application/vnd.iptc.g2.planningitem+xml":{"source":"iana"},"application/vnd.ipunplugged.rcprofile":{"source":"iana","extensions":["rcprofile"]},"application/vnd.irepository.package+xml":{"source":"iana","extensions":["irp"]},"application/vnd.is-xpr":{"source":"iana","extensions":["xpr"]},"application/vnd.isac.fcs":{"source":"iana","extensions":["fcs"]},"application/vnd.jam":{"source":"iana","extensions":["jam"]},"application/vnd.japannet-directory-service":{"source":"iana"},"application/vnd.japannet-jpnstore-wakeup":{"source":"iana"},"application/vnd.japannet-payment-wakeup":{"source":"iana"},"application/vnd.japannet-registration":{"source":"iana"},"application/vnd.japannet-registration-wakeup":{"source":"iana"},"application/vnd.japannet-setstore-wakeup":{"source":"iana"},"application/vnd.japannet-verification":{"source":"iana"},"application/vnd.japannet-verification-wakeup":{"source":"iana"},"application/vnd.jcp.javame.midlet-rms":{"source":"iana","extensions":["rms"]},"application/vnd.jisp":{"source":"iana","extensions":["jisp"]},"application/vnd.joost.joda-archive":{"source":"iana","extensions":["joda"]},"application/vnd.jsk.isdn-ngn":{"source":"iana"},"application/vnd.kahootz":{"source":"iana","extensions":["ktz","ktr"]},"application/vnd.kde.karbon":{"source":"iana","extensions":["karbon"]},"application/vnd.kde.kchart":{"source":"iana","extensions":["chrt"]},"application/vnd.kde.kformula":{"source":"iana","extensions":["kfo"]},"application/vnd.kde.kivio":{"source":"iana","extensions":["flw"]},"application/vnd.kde.kontour":{"source":"iana","extensions":["kon"]},"application/vnd.kde.kpresenter":{"source":"iana","extensions":["kpr","kpt"]},"application/vnd.kde.kspread":{"source":"iana","extensions":["ksp"]},"application/vnd.kde.kword":{"source":"iana","extensions":["kwd","kwt"]},"application/vnd.kenameaapp":{"source":"iana","extensions":["htke"]},"application/vnd.kidspiration":{"source":"iana","extensions":["kia"]},"application/vnd.kinar":{"source":"iana","extensions":["kne","knp"]},"application/vnd.koan":{"source":"iana","extensions":["skp","skd","skt","skm"]},"application/vnd.kodak-descriptor":{"source":"iana","extensions":["sse"]},"application/vnd.las.las+json":{"source":"iana","compressible":true},"application/vnd.las.las+xml":{"source":"iana","extensions":["lasxml"]},"application/vnd.liberty-request+xml":{"source":"iana"},"application/vnd.llamagraphics.life-balance.desktop":{"source":"iana","extensions":["lbd"]},"application/vnd.llamagraphics.life-balance.exchange+xml":{"source":"iana","extensions":["lbe"]},"application/vnd.lotus-1-2-3":{"source":"iana","extensions":["123"]},"application/vnd.lotus-approach":{"source":"iana","extensions":["apr"]},"application/vnd.lotus-freelance":{"source":"iana","extensions":["pre"]},"application/vnd.lotus-notes":{"source":"iana","extensions":["nsf"]},"application/vnd.lotus-organizer":{"source":"iana","extensions":["org"]},"application/vnd.lotus-screencam":{"source":"iana","extensions":["scm"]},"application/vnd.lotus-wordpro":{"source":"iana","extensions":["lwp"]},"application/vnd.macports.portpkg":{"source":"iana","extensions":["portpkg"]},"application/vnd.mapbox-vector-tile":{"source":"iana"},"application/vnd.marlin.drm.actiontoken+xml":{"source":"iana"},"application/vnd.marlin.drm.conftoken+xml":{"source":"iana"},"application/vnd.marlin.drm.license+xml":{"source":"iana"},"application/vnd.marlin.drm.mdcf":{"source":"iana"},"application/vnd.mason+json":{"source":"iana","compressible":true},"application/vnd.maxmind.maxmind-db":{"source":"iana"},"application/vnd.mcd":{"source":"iana","extensions":["mcd"]},"application/vnd.medcalcdata":{"source":"iana","extensions":["mc1"]},"application/vnd.mediastation.cdkey":{"source":"iana","extensions":["cdkey"]},"application/vnd.meridian-slingshot":{"source":"iana"},"application/vnd.mfer":{"source":"iana","extensions":["mwf"]},"application/vnd.mfmp":{"source":"iana","extensions":["mfm"]},"application/vnd.micro+json":{"source":"iana","compressible":true},"application/vnd.micrografx.flo":{"source":"iana","extensions":["flo"]},"application/vnd.micrografx.igx":{"source":"iana","extensions":["igx"]},"application/vnd.microsoft.portable-executable":{"source":"iana"},"application/vnd.microsoft.windows.thumbnail-cache":{"source":"iana"},"application/vnd.miele+json":{"source":"iana","compressible":true},"application/vnd.mif":{"source":"iana","extensions":["mif"]},"application/vnd.minisoft-hp3000-save":{"source":"iana"},"application/vnd.mitsubishi.misty-guard.trustweb":{"source":"iana"},"application/vnd.mobius.daf":{"source":"iana","extensions":["daf"]},"application/vnd.mobius.dis":{"source":"iana","extensions":["dis"]},"application/vnd.mobius.mbk":{"source":"iana","extensions":["mbk"]},"application/vnd.mobius.mqy":{"source":"iana","extensions":["mqy"]},"application/vnd.mobius.msl":{"source":"iana","extensions":["msl"]},"application/vnd.mobius.plc":{"source":"iana","extensions":["plc"]},"application/vnd.mobius.txf":{"source":"iana","extensions":["txf"]},"application/vnd.mophun.application":{"source":"iana","extensions":["mpn"]},"application/vnd.mophun.certificate":{"source":"iana","extensions":["mpc"]},"application/vnd.motorola.flexsuite":{"source":"iana"},"application/vnd.motorola.flexsuite.adsi":{"source":"iana"},"application/vnd.motorola.flexsuite.fis":{"source":"iana"},"application/vnd.motorola.flexsuite.gotap":{"source":"iana"},"application/vnd.motorola.flexsuite.kmr":{"source":"iana"},"application/vnd.motorola.flexsuite.ttc":{"source":"iana"},"application/vnd.motorola.flexsuite.wem":{"source":"iana"},"application/vnd.motorola.iprm":{"source":"iana"},"application/vnd.mozilla.xul+xml":{"source":"iana","compressible":true,"extensions":["xul"]},"application/vnd.ms-3mfdocument":{"source":"iana"},"application/vnd.ms-artgalry":{"source":"iana","extensions":["cil"]},"application/vnd.ms-asf":{"source":"iana"},"application/vnd.ms-cab-compressed":{"source":"iana","extensions":["cab"]},"application/vnd.ms-color.iccprofile":{"source":"apache"},"application/vnd.ms-excel":{"source":"iana","compressible":false,"extensions":["xls","xlm","xla","xlc","xlt","xlw"]},"application/vnd.ms-excel.addin.macroenabled.12":{"source":"iana","extensions":["xlam"]},"application/vnd.ms-excel.sheet.binary.macroenabled.12":{"source":"iana","extensions":["xlsb"]},"application/vnd.ms-excel.sheet.macroenabled.12":{"source":"iana","extensions":["xlsm"]},"application/vnd.ms-excel.template.macroenabled.12":{"source":"iana","extensions":["xltm"]},"application/vnd.ms-fontobject":{"source":"iana","compressible":true,"extensions":["eot"]},"application/vnd.ms-htmlhelp":{"source":"iana","extensions":["chm"]},"application/vnd.ms-ims":{"source":"iana","extensions":["ims"]},"application/vnd.ms-lrm":{"source":"iana","extensions":["lrm"]},"application/vnd.ms-office.activex+xml":{"source":"iana"},"application/vnd.ms-officetheme":{"source":"iana","extensions":["thmx"]},"application/vnd.ms-opentype":{"source":"apache","compressible":true},"application/vnd.ms-outlook":{"compressible":false,"extensions":["msg"]},"application/vnd.ms-package.obfuscated-opentype":{"source":"apache"},"application/vnd.ms-pki.seccat":{"source":"apache","extensions":["cat"]},"application/vnd.ms-pki.stl":{"source":"apache","extensions":["stl"]},"application/vnd.ms-playready.initiator+xml":{"source":"iana"},"application/vnd.ms-powerpoint":{"source":"iana","compressible":false,"extensions":["ppt","pps","pot"]},"application/vnd.ms-powerpoint.addin.macroenabled.12":{"source":"iana","extensions":["ppam"]},"application/vnd.ms-powerpoint.presentation.macroenabled.12":{"source":"iana","extensions":["pptm"]},"application/vnd.ms-powerpoint.slide.macroenabled.12":{"source":"iana","extensions":["sldm"]},"application/vnd.ms-powerpoint.slideshow.macroenabled.12":{"source":"iana","extensions":["ppsm"]},"application/vnd.ms-powerpoint.template.macroenabled.12":{"source":"iana","extensions":["potm"]},"application/vnd.ms-printdevicecapabilities+xml":{"source":"iana"},"application/vnd.ms-printing.printticket+xml":{"source":"apache"},"application/vnd.ms-printschematicket+xml":{"source":"iana"},"application/vnd.ms-project":{"source":"iana","extensions":["mpp","mpt"]},"application/vnd.ms-tnef":{"source":"iana"},"application/vnd.ms-windows.devicepairing":{"source":"iana"},"application/vnd.ms-windows.nwprinting.oob":{"source":"iana"},"application/vnd.ms-windows.printerpairing":{"source":"iana"},"application/vnd.ms-windows.wsd.oob":{"source":"iana"},"application/vnd.ms-wmdrm.lic-chlg-req":{"source":"iana"},"application/vnd.ms-wmdrm.lic-resp":{"source":"iana"},"application/vnd.ms-wmdrm.meter-chlg-req":{"source":"iana"},"application/vnd.ms-wmdrm.meter-resp":{"source":"iana"},"application/vnd.ms-word.document.macroenabled.12":{"source":"iana","extensions":["docm"]},"application/vnd.ms-word.template.macroenabled.12":{"source":"iana","extensions":["dotm"]},"application/vnd.ms-works":{"source":"iana","extensions":["wps","wks","wcm","wdb"]},"application/vnd.ms-wpl":{"source":"iana","extensions":["wpl"]},"application/vnd.ms-xpsdocument":{"source":"iana","compressible":false,"extensions":["xps"]},"application/vnd.msa-disk-image":{"source":"iana"},"application/vnd.mseq":{"source":"iana","extensions":["mseq"]},"application/vnd.msign":{"source":"iana"},"application/vnd.multiad.creator":{"source":"iana"},"application/vnd.multiad.creator.cif":{"source":"iana"},"application/vnd.music-niff":{"source":"iana"},"application/vnd.musician":{"source":"iana","extensions":["mus"]},"application/vnd.muvee.style":{"source":"iana","extensions":["msty"]},"application/vnd.mynfc":{"source":"iana","extensions":["taglet"]},"application/vnd.ncd.control":{"source":"iana"},"application/vnd.ncd.reference":{"source":"iana"},"application/vnd.nearst.inv+json":{"source":"iana","compressible":true},"application/vnd.nervana":{"source":"iana"},"application/vnd.netfpx":{"source":"iana"},"application/vnd.neurolanguage.nlu":{"source":"iana","extensions":["nlu"]},"application/vnd.nintendo.nitro.rom":{"source":"iana"},"application/vnd.nintendo.snes.rom":{"source":"iana"},"application/vnd.nitf":{"source":"iana","extensions":["ntf","nitf"]},"application/vnd.noblenet-directory":{"source":"iana","extensions":["nnd"]},"application/vnd.noblenet-sealer":{"source":"iana","extensions":["nns"]},"application/vnd.noblenet-web":{"source":"iana","extensions":["nnw"]},"application/vnd.nokia.catalogs":{"source":"iana"},"application/vnd.nokia.conml+wbxml":{"source":"iana"},"application/vnd.nokia.conml+xml":{"source":"iana"},"application/vnd.nokia.iptv.config+xml":{"source":"iana"},"application/vnd.nokia.isds-radio-presets":{"source":"iana"},"application/vnd.nokia.landmark+wbxml":{"source":"iana"},"application/vnd.nokia.landmark+xml":{"source":"iana"},"application/vnd.nokia.landmarkcollection+xml":{"source":"iana"},"application/vnd.nokia.n-gage.ac+xml":{"source":"iana"},"application/vnd.nokia.n-gage.data":{"source":"iana","extensions":["ngdat"]},"application/vnd.nokia.n-gage.symbian.install":{"source":"iana","extensions":["n-gage"]},"application/vnd.nokia.ncd":{"source":"iana"},"application/vnd.nokia.pcd+wbxml":{"source":"iana"},"application/vnd.nokia.pcd+xml":{"source":"iana"},"application/vnd.nokia.radio-preset":{"source":"iana","extensions":["rpst"]},"application/vnd.nokia.radio-presets":{"source":"iana","extensions":["rpss"]},"application/vnd.novadigm.edm":{"source":"iana","extensions":["edm"]},"application/vnd.novadigm.edx":{"source":"iana","extensions":["edx"]},"application/vnd.novadigm.ext":{"source":"iana","extensions":["ext"]},"application/vnd.ntt-local.content-share":{"source":"iana"},"application/vnd.ntt-local.file-transfer":{"source":"iana"},"application/vnd.ntt-local.ogw_remote-access":{"source":"iana"},"application/vnd.ntt-local.sip-ta_remote":{"source":"iana"},"application/vnd.ntt-local.sip-ta_tcp_stream":{"source":"iana"},"application/vnd.oasis.opendocument.chart":{"source":"iana","extensions":["odc"]},"application/vnd.oasis.opendocument.chart-template":{"source":"iana","extensions":["otc"]},"application/vnd.oasis.opendocument.database":{"source":"iana","extensions":["odb"]},"application/vnd.oasis.opendocument.formula":{"source":"iana","extensions":["odf"]},"application/vnd.oasis.opendocument.formula-template":{"source":"iana","extensions":["odft"]},"application/vnd.oasis.opendocument.graphics":{"source":"iana","compressible":false,"extensions":["odg"]},"application/vnd.oasis.opendocument.graphics-template":{"source":"iana","extensions":["otg"]},"application/vnd.oasis.opendocument.image":{"source":"iana","extensions":["odi"]},"application/vnd.oasis.opendocument.image-template":{"source":"iana","extensions":["oti"]},"application/vnd.oasis.opendocument.presentation":{"source":"iana","compressible":false,"extensions":["odp"]},"application/vnd.oasis.opendocument.presentation-template":{"source":"iana","extensions":["otp"]},"application/vnd.oasis.opendocument.spreadsheet":{"source":"iana","compressible":false,"extensions":["ods"]},"application/vnd.oasis.opendocument.spreadsheet-template":{"source":"iana","extensions":["ots"]},"application/vnd.oasis.opendocument.text":{"source":"iana","compressible":false,"extensions":["odt"]},"application/vnd.oasis.opendocument.text-master":{"source":"iana","extensions":["odm"]},"application/vnd.oasis.opendocument.text-template":{"source":"iana","extensions":["ott"]},"application/vnd.oasis.opendocument.text-web":{"source":"iana","extensions":["oth"]},"application/vnd.obn":{"source":"iana"},"application/vnd.ocf+cbor":{"source":"iana"},"application/vnd.oftn.l10n+json":{"source":"iana","compressible":true},"application/vnd.oipf.contentaccessdownload+xml":{"source":"iana"},"application/vnd.oipf.contentaccessstreaming+xml":{"source":"iana"},"application/vnd.oipf.cspg-hexbinary":{"source":"iana"},"application/vnd.oipf.dae.svg+xml":{"source":"iana"},"application/vnd.oipf.dae.xhtml+xml":{"source":"iana"},"application/vnd.oipf.mippvcontrolmessage+xml":{"source":"iana"},"application/vnd.oipf.pae.gem":{"source":"iana"},"application/vnd.oipf.spdiscovery+xml":{"source":"iana"},"application/vnd.oipf.spdlist+xml":{"source":"iana"},"application/vnd.oipf.ueprofile+xml":{"source":"iana"},"application/vnd.oipf.userprofile+xml":{"source":"iana"},"application/vnd.olpc-sugar":{"source":"iana","extensions":["xo"]},"application/vnd.oma-scws-config":{"source":"iana"},"application/vnd.oma-scws-http-request":{"source":"iana"},"application/vnd.oma-scws-http-response":{"source":"iana"},"application/vnd.oma.bcast.associated-procedure-parameter+xml":{"source":"iana"},"application/vnd.oma.bcast.drm-trigger+xml":{"source":"iana"},"application/vnd.oma.bcast.imd+xml":{"source":"iana"},"application/vnd.oma.bcast.ltkm":{"source":"iana"},"application/vnd.oma.bcast.notification+xml":{"source":"iana"},"application/vnd.oma.bcast.provisioningtrigger":{"source":"iana"},"application/vnd.oma.bcast.sgboot":{"source":"iana"},"application/vnd.oma.bcast.sgdd+xml":{"source":"iana"},"application/vnd.oma.bcast.sgdu":{"source":"iana"},"application/vnd.oma.bcast.simple-symbol-container":{"source":"iana"},"application/vnd.oma.bcast.smartcard-trigger+xml":{"source":"iana"},"application/vnd.oma.bcast.sprov+xml":{"source":"iana"},"application/vnd.oma.bcast.stkm":{"source":"iana"},"application/vnd.oma.cab-address-book+xml":{"source":"iana"},"application/vnd.oma.cab-feature-handler+xml":{"source":"iana"},"application/vnd.oma.cab-pcc+xml":{"source":"iana"},"application/vnd.oma.cab-subs-invite+xml":{"source":"iana"},"application/vnd.oma.cab-user-prefs+xml":{"source":"iana"},"application/vnd.oma.dcd":{"source":"iana"},"application/vnd.oma.dcdc":{"source":"iana"},"application/vnd.oma.dd2+xml":{"source":"iana","extensions":["dd2"]},"application/vnd.oma.drm.risd+xml":{"source":"iana"},"application/vnd.oma.group-usage-list+xml":{"source":"iana"},"application/vnd.oma.lwm2m+json":{"source":"iana","compressible":true},"application/vnd.oma.lwm2m+tlv":{"source":"iana"},"application/vnd.oma.pal+xml":{"source":"iana"},"application/vnd.oma.poc.detailed-progress-report+xml":{"source":"iana"},"application/vnd.oma.poc.final-report+xml":{"source":"iana"},"application/vnd.oma.poc.groups+xml":{"source":"iana"},"application/vnd.oma.poc.invocation-descriptor+xml":{"source":"iana"},"application/vnd.oma.poc.optimized-progress-report+xml":{"source":"iana"},"application/vnd.oma.push":{"source":"iana"},"application/vnd.oma.scidm.messages+xml":{"source":"iana"},"application/vnd.oma.xcap-directory+xml":{"source":"iana"},"application/vnd.omads-email+xml":{"source":"iana"},"application/vnd.omads-file+xml":{"source":"iana"},"application/vnd.omads-folder+xml":{"source":"iana"},"application/vnd.omaloc-supl-init":{"source":"iana"},"application/vnd.onepager":{"source":"iana"},"application/vnd.onepagertamp":{"source":"iana"},"application/vnd.onepagertamx":{"source":"iana"},"application/vnd.onepagertat":{"source":"iana"},"application/vnd.onepagertatp":{"source":"iana"},"application/vnd.onepagertatx":{"source":"iana"},"application/vnd.openblox.game+xml":{"source":"iana"},"application/vnd.openblox.game-binary":{"source":"iana"},"application/vnd.openeye.oeb":{"source":"iana"},"application/vnd.openofficeorg.extension":{"source":"apache","extensions":["oxt"]},"application/vnd.openstreetmap.data+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.custom-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.customxmlproperties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawing+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.chart+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.extended-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.presentation":{"source":"iana","compressible":false,"extensions":["pptx"]},"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.presprops+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slide":{"source":"iana","extensions":["sldx"]},"application/vnd.openxmlformats-officedocument.presentationml.slide+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slideshow":{"source":"iana","extensions":["ppsx"]},"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.tags+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.template":{"source":"iana","extensions":["potx"]},"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":{"source":"iana","compressible":false,"extensions":["xlsx"]},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.template":{"source":"iana","extensions":["xltx"]},"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.theme+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.themeoverride+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.vmldrawing":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.document":{"source":"iana","compressible":false,"extensions":["docx"]},"application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.template":{"source":"iana","extensions":["dotx"]},"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml":{"source":"iana"},"application/vnd.openxmlformats-package.core-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml":{"source":"iana"},"application/vnd.openxmlformats-package.relationships+xml":{"source":"iana"},"application/vnd.oracle.resource+json":{"source":"iana","compressible":true},"application/vnd.orange.indata":{"source":"iana"},"application/vnd.osa.netdeploy":{"source":"iana"},"application/vnd.osgeo.mapguide.package":{"source":"iana","extensions":["mgp"]},"application/vnd.osgi.bundle":{"source":"iana"},"application/vnd.osgi.dp":{"source":"iana","extensions":["dp"]},"application/vnd.osgi.subsystem":{"source":"iana","extensions":["esa"]},"application/vnd.otps.ct-kip+xml":{"source":"iana"},"application/vnd.oxli.countgraph":{"source":"iana"},"application/vnd.pagerduty+json":{"source":"iana","compressible":true},"application/vnd.palm":{"source":"iana","extensions":["pdb","pqa","oprc"]},"application/vnd.panoply":{"source":"iana"},"application/vnd.paos+xml":{"source":"iana"},"application/vnd.paos.xml":{"source":"apache"},"application/vnd.patentdive":{"source":"iana"},"application/vnd.pawaafile":{"source":"iana","extensions":["paw"]},"application/vnd.pcos":{"source":"iana"},"application/vnd.pg.format":{"source":"iana","extensions":["str"]},"application/vnd.pg.osasli":{"source":"iana","extensions":["ei6"]},"application/vnd.piaccess.application-licence":{"source":"iana"},"application/vnd.picsel":{"source":"iana","extensions":["efif"]},"application/vnd.pmi.widget":{"source":"iana","extensions":["wg"]},"application/vnd.poc.group-advertisement+xml":{"source":"iana"},"application/vnd.pocketlearn":{"source":"iana","extensions":["plf"]},"application/vnd.powerbuilder6":{"source":"iana","extensions":["pbd"]},"application/vnd.powerbuilder6-s":{"source":"iana"},"application/vnd.powerbuilder7":{"source":"iana"},"application/vnd.powerbuilder7-s":{"source":"iana"},"application/vnd.powerbuilder75":{"source":"iana"},"application/vnd.powerbuilder75-s":{"source":"iana"},"application/vnd.preminet":{"source":"iana"},"application/vnd.previewsystems.box":{"source":"iana","extensions":["box"]},"application/vnd.proteus.magazine":{"source":"iana","extensions":["mgz"]},"application/vnd.publishare-delta-tree":{"source":"iana","extensions":["qps"]},"application/vnd.pvi.ptid1":{"source":"iana","extensions":["ptid"]},"application/vnd.pwg-multiplexed":{"source":"iana"},"application/vnd.pwg-xhtml-print+xml":{"source":"iana"},"application/vnd.qualcomm.brew-app-res":{"source":"iana"},"application/vnd.quarantainenet":{"source":"iana"},"application/vnd.quark.quarkxpress":{"source":"iana","extensions":["qxd","qxt","qwd","qwt","qxl","qxb"]},"application/vnd.quobject-quoxdocument":{"source":"iana"},"application/vnd.radisys.moml+xml":{"source":"iana"},"application/vnd.radisys.msml+xml":{"source":"iana"},"application/vnd.radisys.msml-audit+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-conf+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-conn+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-dialog+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-stream+xml":{"source":"iana"},"application/vnd.radisys.msml-conf+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-base+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-fax-detect+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-fax-sendrecv+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-group+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-speech+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-transform+xml":{"source":"iana"},"application/vnd.rainstor.data":{"source":"iana"},"application/vnd.rapid":{"source":"iana"},"application/vnd.rar":{"source":"iana"},"application/vnd.realvnc.bed":{"source":"iana","extensions":["bed"]},"application/vnd.recordare.musicxml":{"source":"iana","extensions":["mxl"]},"application/vnd.recordare.musicxml+xml":{"source":"iana","extensions":["musicxml"]},"application/vnd.renlearn.rlprint":{"source":"iana"},"application/vnd.restful+json":{"source":"iana","compressible":true},"application/vnd.rig.cryptonote":{"source":"iana","extensions":["cryptonote"]},"application/vnd.rim.cod":{"source":"apache","extensions":["cod"]},"application/vnd.rn-realmedia":{"source":"apache","extensions":["rm"]},"application/vnd.rn-realmedia-vbr":{"source":"apache","extensions":["rmvb"]},"application/vnd.route66.link66+xml":{"source":"iana","extensions":["link66"]},"application/vnd.rs-274x":{"source":"iana"},"application/vnd.ruckus.download":{"source":"iana"},"application/vnd.s3sms":{"source":"iana"},"application/vnd.sailingtracker.track":{"source":"iana","extensions":["st"]},"application/vnd.sbm.cid":{"source":"iana"},"application/vnd.sbm.mid2":{"source":"iana"},"application/vnd.scribus":{"source":"iana"},"application/vnd.sealed.3df":{"source":"iana"},"application/vnd.sealed.csf":{"source":"iana"},"application/vnd.sealed.doc":{"source":"iana"},"application/vnd.sealed.eml":{"source":"iana"},"application/vnd.sealed.mht":{"source":"iana"},"application/vnd.sealed.net":{"source":"iana"},"application/vnd.sealed.ppt":{"source":"iana"},"application/vnd.sealed.tiff":{"source":"iana"},"application/vnd.sealed.xls":{"source":"iana"},"application/vnd.sealedmedia.softseal.html":{"source":"iana"},"application/vnd.sealedmedia.softseal.pdf":{"source":"iana"},"application/vnd.seemail":{"source":"iana","extensions":["see"]},"application/vnd.sema":{"source":"iana","extensions":["sema"]},"application/vnd.semd":{"source":"iana","extensions":["semd"]},"application/vnd.semf":{"source":"iana","extensions":["semf"]},"application/vnd.shana.informed.formdata":{"source":"iana","extensions":["ifm"]},"application/vnd.shana.informed.formtemplate":{"source":"iana","extensions":["itp"]},"application/vnd.shana.informed.interchange":{"source":"iana","extensions":["iif"]},"application/vnd.shana.informed.package":{"source":"iana","extensions":["ipk"]},"application/vnd.sigrok.session":{"source":"iana"},"application/vnd.simtech-mindmapper":{"source":"iana","extensions":["twd","twds"]},"application/vnd.siren+json":{"source":"iana","compressible":true},"application/vnd.smaf":{"source":"iana","extensions":["mmf"]},"application/vnd.smart.notebook":{"source":"iana"},"application/vnd.smart.teacher":{"source":"iana","extensions":["teacher"]},"application/vnd.software602.filler.form+xml":{"source":"iana"},"application/vnd.software602.filler.form-xml-zip":{"source":"iana"},"application/vnd.solent.sdkm+xml":{"source":"iana","extensions":["sdkm","sdkd"]},"application/vnd.spotfire.dxp":{"source":"iana","extensions":["dxp"]},"application/vnd.spotfire.sfs":{"source":"iana","extensions":["sfs"]},"application/vnd.sqlite3":{"source":"iana"},"application/vnd.sss-cod":{"source":"iana"},"application/vnd.sss-dtf":{"source":"iana"},"application/vnd.sss-ntf":{"source":"iana"},"application/vnd.stardivision.calc":{"source":"apache","extensions":["sdc"]},"application/vnd.stardivision.draw":{"source":"apache","extensions":["sda"]},"application/vnd.stardivision.impress":{"source":"apache","extensions":["sdd"]},"application/vnd.stardivision.math":{"source":"apache","extensions":["smf"]},"application/vnd.stardivision.writer":{"source":"apache","extensions":["sdw","vor"]},"application/vnd.stardivision.writer-global":{"source":"apache","extensions":["sgl"]},"application/vnd.stepmania.package":{"source":"iana","extensions":["smzip"]},"application/vnd.stepmania.stepchart":{"source":"iana","extensions":["sm"]},"application/vnd.street-stream":{"source":"iana"},"application/vnd.sun.wadl+xml":{"source":"iana","compressible":true,"extensions":["wadl"]},"application/vnd.sun.xml.calc":{"source":"apache","extensions":["sxc"]},"application/vnd.sun.xml.calc.template":{"source":"apache","extensions":["stc"]},"application/vnd.sun.xml.draw":{"source":"apache","extensions":["sxd"]},"application/vnd.sun.xml.draw.template":{"source":"apache","extensions":["std"]},"application/vnd.sun.xml.impress":{"source":"apache","extensions":["sxi"]},"application/vnd.sun.xml.impress.template":{"source":"apache","extensions":["sti"]},"application/vnd.sun.xml.math":{"source":"apache","extensions":["sxm"]},"application/vnd.sun.xml.writer":{"source":"apache","extensions":["sxw"]},"application/vnd.sun.xml.writer.global":{"source":"apache","extensions":["sxg"]},"application/vnd.sun.xml.writer.template":{"source":"apache","extensions":["stw"]},"application/vnd.sus-calendar":{"source":"iana","extensions":["sus","susp"]},"application/vnd.svd":{"source":"iana","extensions":["svd"]},"application/vnd.swiftview-ics":{"source":"iana"},"application/vnd.symbian.install":{"source":"apache","extensions":["sis","sisx"]},"application/vnd.syncml+xml":{"source":"iana","extensions":["xsm"]},"application/vnd.syncml.dm+wbxml":{"source":"iana","extensions":["bdm"]},"application/vnd.syncml.dm+xml":{"source":"iana","extensions":["xdm"]},"application/vnd.syncml.dm.notification":{"source":"iana"},"application/vnd.syncml.dmddf+wbxml":{"source":"iana"},"application/vnd.syncml.dmddf+xml":{"source":"iana"},"application/vnd.syncml.dmtnds+wbxml":{"source":"iana"},"application/vnd.syncml.dmtnds+xml":{"source":"iana"},"application/vnd.syncml.ds.notification":{"source":"iana"},"application/vnd.tableschema+json":{"source":"iana","compressible":true},"application/vnd.tao.intent-module-archive":{"source":"iana","extensions":["tao"]},"application/vnd.tcpdump.pcap":{"source":"iana","extensions":["pcap","cap","dmp"]},"application/vnd.tmd.mediaflex.api+xml":{"source":"iana"},"application/vnd.tml":{"source":"iana"},"application/vnd.tmobile-livetv":{"source":"iana","extensions":["tmo"]},"application/vnd.tri.onesource":{"source":"iana"},"application/vnd.trid.tpt":{"source":"iana","extensions":["tpt"]},"application/vnd.triscape.mxs":{"source":"iana","extensions":["mxs"]},"application/vnd.trueapp":{"source":"iana","extensions":["tra"]},"application/vnd.truedoc":{"source":"iana"},"application/vnd.ubisoft.webplayer":{"source":"iana"},"application/vnd.ufdl":{"source":"iana","extensions":["ufd","ufdl"]},"application/vnd.uiq.theme":{"source":"iana","extensions":["utz"]},"application/vnd.umajin":{"source":"iana","extensions":["umj"]},"application/vnd.unity":{"source":"iana","extensions":["unityweb"]},"application/vnd.uoml+xml":{"source":"iana","extensions":["uoml"]},"application/vnd.uplanet.alert":{"source":"iana"},"application/vnd.uplanet.alert-wbxml":{"source":"iana"},"application/vnd.uplanet.bearer-choice":{"source":"iana"},"application/vnd.uplanet.bearer-choice-wbxml":{"source":"iana"},"application/vnd.uplanet.cacheop":{"source":"iana"},"application/vnd.uplanet.cacheop-wbxml":{"source":"iana"},"application/vnd.uplanet.channel":{"source":"iana"},"application/vnd.uplanet.channel-wbxml":{"source":"iana"},"application/vnd.uplanet.list":{"source":"iana"},"application/vnd.uplanet.list-wbxml":{"source":"iana"},"application/vnd.uplanet.listcmd":{"source":"iana"},"application/vnd.uplanet.listcmd-wbxml":{"source":"iana"},"application/vnd.uplanet.signal":{"source":"iana"},"application/vnd.uri-map":{"source":"iana"},"application/vnd.valve.source.material":{"source":"iana"},"application/vnd.vcx":{"source":"iana","extensions":["vcx"]},"application/vnd.vd-study":{"source":"iana"},"application/vnd.vectorworks":{"source":"iana"},"application/vnd.vel+json":{"source":"iana","compressible":true},"application/vnd.verimatrix.vcas":{"source":"iana"},"application/vnd.vidsoft.vidconference":{"source":"iana"},"application/vnd.visio":{"source":"iana","extensions":["vsd","vst","vss","vsw"]},"application/vnd.visionary":{"source":"iana","extensions":["vis"]},"application/vnd.vividence.scriptfile":{"source":"iana"},"application/vnd.vsf":{"source":"iana","extensions":["vsf"]},"application/vnd.wap.sic":{"source":"iana"},"application/vnd.wap.slc":{"source":"iana"},"application/vnd.wap.wbxml":{"source":"iana","extensions":["wbxml"]},"application/vnd.wap.wmlc":{"source":"iana","extensions":["wmlc"]},"application/vnd.wap.wmlscriptc":{"source":"iana","extensions":["wmlsc"]},"application/vnd.webturbo":{"source":"iana","extensions":["wtb"]},"application/vnd.wfa.p2p":{"source":"iana"},"application/vnd.wfa.wsc":{"source":"iana"},"application/vnd.windows.devicepairing":{"source":"iana"},"application/vnd.wmc":{"source":"iana"},"application/vnd.wmf.bootstrap":{"source":"iana"},"application/vnd.wolfram.mathematica":{"source":"iana"},"application/vnd.wolfram.mathematica.package":{"source":"iana"},"application/vnd.wolfram.player":{"source":"iana","extensions":["nbp"]},"application/vnd.wordperfect":{"source":"iana","extensions":["wpd"]},"application/vnd.wqd":{"source":"iana","extensions":["wqd"]},"application/vnd.wrq-hp3000-labelled":{"source":"iana"},"application/vnd.wt.stf":{"source":"iana","extensions":["stf"]},"application/vnd.wv.csp+wbxml":{"source":"iana"},"application/vnd.wv.csp+xml":{"source":"iana"},"application/vnd.wv.ssp+xml":{"source":"iana"},"application/vnd.xacml+json":{"source":"iana","compressible":true},"application/vnd.xara":{"source":"iana","extensions":["xar"]},"application/vnd.xfdl":{"source":"iana","extensions":["xfdl"]},"application/vnd.xfdl.webform":{"source":"iana"},"application/vnd.xmi+xml":{"source":"iana"},"application/vnd.xmpie.cpkg":{"source":"iana"},"application/vnd.xmpie.dpkg":{"source":"iana"},"application/vnd.xmpie.plan":{"source":"iana"},"application/vnd.xmpie.ppkg":{"source":"iana"},"application/vnd.xmpie.xlim":{"source":"iana"},"application/vnd.yamaha.hv-dic":{"source":"iana","extensions":["hvd"]},"application/vnd.yamaha.hv-script":{"source":"iana","extensions":["hvs"]},"application/vnd.yamaha.hv-voice":{"source":"iana","extensions":["hvp"]},"application/vnd.yamaha.openscoreformat":{"source":"iana","extensions":["osf"]},"application/vnd.yamaha.openscoreformat.osfpvg+xml":{"source":"iana","extensions":["osfpvg"]},"application/vnd.yamaha.remote-setup":{"source":"iana"},"application/vnd.yamaha.smaf-audio":{"source":"iana","extensions":["saf"]},"application/vnd.yamaha.smaf-phrase":{"source":"iana","extensions":["spf"]},"application/vnd.yamaha.through-ngn":{"source":"iana"},"application/vnd.yamaha.tunnel-udpencap":{"source":"iana"},"application/vnd.yaoweme":{"source":"iana"},"application/vnd.yellowriver-custom-menu":{"source":"iana","extensions":["cmp"]},"application/vnd.youtube.yt":{"source":"iana"},"application/vnd.zul":{"source":"iana","extensions":["zir","zirz"]},"application/vnd.zzazz.deck+xml":{"source":"iana","extensions":["zaz"]},"application/voicexml+xml":{"source":"iana","extensions":["vxml"]},"application/voucher-cms+json":{"source":"iana","compressible":true},"application/vq-rtcpxr":{"source":"iana"},"application/wasm":{"compressible":true,"extensions":["wasm"]},"application/watcherinfo+xml":{"source":"iana"},"application/webpush-options+json":{"source":"iana","compressible":true},"application/whoispp-query":{"source":"iana"},"application/whoispp-response":{"source":"iana"},"application/widget":{"source":"iana","extensions":["wgt"]},"application/winhlp":{"source":"apache","extensions":["hlp"]},"application/wita":{"source":"iana"},"application/wordperfect5.1":{"source":"iana"},"application/wsdl+xml":{"source":"iana","extensions":["wsdl"]},"application/wspolicy+xml":{"source":"iana","extensions":["wspolicy"]},"application/x-7z-compressed":{"source":"apache","compressible":false,"extensions":["7z"]},"application/x-abiword":{"source":"apache","extensions":["abw"]},"application/x-ace-compressed":{"source":"apache","extensions":["ace"]},"application/x-amf":{"source":"apache"},"application/x-apple-diskimage":{"source":"apache","extensions":["dmg"]},"application/x-arj":{"compressible":false,"extensions":["arj"]},"application/x-authorware-bin":{"source":"apache","extensions":["aab","x32","u32","vox"]},"application/x-authorware-map":{"source":"apache","extensions":["aam"]},"application/x-authorware-seg":{"source":"apache","extensions":["aas"]},"application/x-bcpio":{"source":"apache","extensions":["bcpio"]},"application/x-bdoc":{"compressible":false,"extensions":["bdoc"]},"application/x-bittorrent":{"source":"apache","extensions":["torrent"]},"application/x-blorb":{"source":"apache","extensions":["blb","blorb"]},"application/x-bzip":{"source":"apache","compressible":false,"extensions":["bz"]},"application/x-bzip2":{"source":"apache","compressible":false,"extensions":["bz2","boz"]},"application/x-cbr":{"source":"apache","extensions":["cbr","cba","cbt","cbz","cb7"]},"application/x-cdlink":{"source":"apache","extensions":["vcd"]},"application/x-cfs-compressed":{"source":"apache","extensions":["cfs"]},"application/x-chat":{"source":"apache","extensions":["chat"]},"application/x-chess-pgn":{"source":"apache","extensions":["pgn"]},"application/x-chrome-extension":{"extensions":["crx"]},"application/x-cocoa":{"source":"nginx","extensions":["cco"]},"application/x-compress":{"source":"apache"},"application/x-conference":{"source":"apache","extensions":["nsc"]},"application/x-cpio":{"source":"apache","extensions":["cpio"]},"application/x-csh":{"source":"apache","extensions":["csh"]},"application/x-deb":{"compressible":false},"application/x-debian-package":{"source":"apache","extensions":["deb","udeb"]},"application/x-dgc-compressed":{"source":"apache","extensions":["dgc"]},"application/x-director":{"source":"apache","extensions":["dir","dcr","dxr","cst","cct","cxt","w3d","fgd","swa"]},"application/x-doom":{"source":"apache","extensions":["wad"]},"application/x-dtbncx+xml":{"source":"apache","extensions":["ncx"]},"application/x-dtbook+xml":{"source":"apache","extensions":["dtb"]},"application/x-dtbresource+xml":{"source":"apache","extensions":["res"]},"application/x-dvi":{"source":"apache","compressible":false,"extensions":["dvi"]},"application/x-envoy":{"source":"apache","extensions":["evy"]},"application/x-eva":{"source":"apache","extensions":["eva"]},"application/x-font-bdf":{"source":"apache","extensions":["bdf"]},"application/x-font-dos":{"source":"apache"},"application/x-font-framemaker":{"source":"apache"},"application/x-font-ghostscript":{"source":"apache","extensions":["gsf"]},"application/x-font-libgrx":{"source":"apache"},"application/x-font-linux-psf":{"source":"apache","extensions":["psf"]},"application/x-font-pcf":{"source":"apache","extensions":["pcf"]},"application/x-font-snf":{"source":"apache","extensions":["snf"]},"application/x-font-speedo":{"source":"apache"},"application/x-font-sunos-news":{"source":"apache"},"application/x-font-type1":{"source":"apache","extensions":["pfa","pfb","pfm","afm"]},"application/x-font-vfont":{"source":"apache"},"application/x-freearc":{"source":"apache","extensions":["arc"]},"application/x-futuresplash":{"source":"apache","extensions":["spl"]},"application/x-gca-compressed":{"source":"apache","extensions":["gca"]},"application/x-glulx":{"source":"apache","extensions":["ulx"]},"application/x-gnumeric":{"source":"apache","extensions":["gnumeric"]},"application/x-gramps-xml":{"source":"apache","extensions":["gramps"]},"application/x-gtar":{"source":"apache","extensions":["gtar"]},"application/x-gzip":{"source":"apache"},"application/x-hdf":{"source":"apache","extensions":["hdf"]},"application/x-httpd-php":{"compressible":true,"extensions":["php"]},"application/x-install-instructions":{"source":"apache","extensions":["install"]},"application/x-iso9660-image":{"source":"apache","extensions":["iso"]},"application/x-java-archive-diff":{"source":"nginx","extensions":["jardiff"]},"application/x-java-jnlp-file":{"source":"apache","compressible":false,"extensions":["jnlp"]},"application/x-javascript":{"compressible":true},"application/x-latex":{"source":"apache","compressible":false,"extensions":["latex"]},"application/x-lua-bytecode":{"extensions":["luac"]},"application/x-lzh-compressed":{"source":"apache","extensions":["lzh","lha"]},"application/x-makeself":{"source":"nginx","extensions":["run"]},"application/x-mie":{"source":"apache","extensions":["mie"]},"application/x-mobipocket-ebook":{"source":"apache","extensions":["prc","mobi"]},"application/x-mpegurl":{"compressible":false},"application/x-ms-application":{"source":"apache","extensions":["application"]},"application/x-ms-shortcut":{"source":"apache","extensions":["lnk"]},"application/x-ms-wmd":{"source":"apache","extensions":["wmd"]},"application/x-ms-wmz":{"source":"apache","extensions":["wmz"]},"application/x-ms-xbap":{"source":"apache","extensions":["xbap"]},"application/x-msaccess":{"source":"apache","extensions":["mdb"]},"application/x-msbinder":{"source":"apache","extensions":["obd"]},"application/x-mscardfile":{"source":"apache","extensions":["crd"]},"application/x-msclip":{"source":"apache","extensions":["clp"]},"application/x-msdos-program":{"extensions":["exe"]},"application/x-msdownload":{"source":"apache","extensions":["exe","dll","com","bat","msi"]},"application/x-msmediaview":{"source":"apache","extensions":["mvb","m13","m14"]},"application/x-msmetafile":{"source":"apache","extensions":["wmf","wmz","emf","emz"]},"application/x-msmoney":{"source":"apache","extensions":["mny"]},"application/x-mspublisher":{"source":"apache","extensions":["pub"]},"application/x-msschedule":{"source":"apache","extensions":["scd"]},"application/x-msterminal":{"source":"apache","extensions":["trm"]},"application/x-mswrite":{"source":"apache","extensions":["wri"]},"application/x-netcdf":{"source":"apache","extensions":["nc","cdf"]},"application/x-ns-proxy-autoconfig":{"compressible":true,"extensions":["pac"]},"application/x-nzb":{"source":"apache","extensions":["nzb"]},"application/x-perl":{"source":"nginx","extensions":["pl","pm"]},"application/x-pilot":{"source":"nginx","extensions":["prc","pdb"]},"application/x-pkcs12":{"source":"apache","compressible":false,"extensions":["p12","pfx"]},"application/x-pkcs7-certificates":{"source":"apache","extensions":["p7b","spc"]},"application/x-pkcs7-certreqresp":{"source":"apache","extensions":["p7r"]},"application/x-rar-compressed":{"source":"apache","compressible":false,"extensions":["rar"]},"application/x-redhat-package-manager":{"source":"nginx","extensions":["rpm"]},"application/x-research-info-systems":{"source":"apache","extensions":["ris"]},"application/x-sea":{"source":"nginx","extensions":["sea"]},"application/x-sh":{"source":"apache","compressible":true,"extensions":["sh"]},"application/x-shar":{"source":"apache","extensions":["shar"]},"application/x-shockwave-flash":{"source":"apache","compressible":false,"extensions":["swf"]},"application/x-silverlight-app":{"source":"apache","extensions":["xap"]},"application/x-sql":{"source":"apache","extensions":["sql"]},"application/x-stuffit":{"source":"apache","compressible":false,"extensions":["sit"]},"application/x-stuffitx":{"source":"apache","extensions":["sitx"]},"application/x-subrip":{"source":"apache","extensions":["srt"]},"application/x-sv4cpio":{"source":"apache","extensions":["sv4cpio"]},"application/x-sv4crc":{"source":"apache","extensions":["sv4crc"]},"application/x-t3vm-image":{"source":"apache","extensions":["t3"]},"application/x-tads":{"source":"apache","extensions":["gam"]},"application/x-tar":{"source":"apache","compressible":true,"extensions":["tar"]},"application/x-tcl":{"source":"apache","extensions":["tcl","tk"]},"application/x-tex":{"source":"apache","extensions":["tex"]},"application/x-tex-tfm":{"source":"apache","extensions":["tfm"]},"application/x-texinfo":{"source":"apache","extensions":["texinfo","texi"]},"application/x-tgif":{"source":"apache","extensions":["obj"]},"application/x-ustar":{"source":"apache","extensions":["ustar"]},"application/x-virtualbox-hdd":{"compressible":true,"extensions":["hdd"]},"application/x-virtualbox-ova":{"compressible":true,"extensions":["ova"]},"application/x-virtualbox-ovf":{"compressible":true,"extensions":["ovf"]},"application/x-virtualbox-vbox":{"compressible":true,"extensions":["vbox"]},"application/x-virtualbox-vbox-extpack":{"compressible":false,"extensions":["vbox-extpack"]},"application/x-virtualbox-vdi":{"compressible":true,"extensions":["vdi"]},"application/x-virtualbox-vhd":{"compressible":true,"extensions":["vhd"]},"application/x-virtualbox-vmdk":{"compressible":true,"extensions":["vmdk"]},"application/x-wais-source":{"source":"apache","extensions":["src"]},"application/x-web-app-manifest+json":{"compressible":true,"extensions":["webapp"]},"application/x-www-form-urlencoded":{"source":"iana","compressible":true},"application/x-x509-ca-cert":{"source":"apache","extensions":["der","crt","pem"]},"application/x-xfig":{"source":"apache","extensions":["fig"]},"application/x-xliff+xml":{"source":"apache","extensions":["xlf"]},"application/x-xpinstall":{"source":"apache","compressible":false,"extensions":["xpi"]},"application/x-xz":{"source":"apache","extensions":["xz"]},"application/x-zmachine":{"source":"apache","extensions":["z1","z2","z3","z4","z5","z6","z7","z8"]},"application/x400-bp":{"source":"iana"},"application/xacml+xml":{"source":"iana"},"application/xaml+xml":{"source":"apache","extensions":["xaml"]},"application/xcap-att+xml":{"source":"iana"},"application/xcap-caps+xml":{"source":"iana"},"application/xcap-diff+xml":{"source":"iana","extensions":["xdf"]},"application/xcap-el+xml":{"source":"iana"},"application/xcap-error+xml":{"source":"iana"},"application/xcap-ns+xml":{"source":"iana"},"application/xcon-conference-info+xml":{"source":"iana"},"application/xcon-conference-info-diff+xml":{"source":"iana"},"application/xenc+xml":{"source":"iana","extensions":["xenc"]},"application/xhtml+xml":{"source":"iana","compressible":true,"extensions":["xhtml","xht"]},"application/xhtml-voice+xml":{"source":"apache"},"application/xml":{"source":"iana","compressible":true,"extensions":["xml","xsl","xsd","rng"]},"application/xml-dtd":{"source":"iana","compressible":true,"extensions":["dtd"]},"application/xml-external-parsed-entity":{"source":"iana"},"application/xml-patch+xml":{"source":"iana"},"application/xmpp+xml":{"source":"iana"},"application/xop+xml":{"source":"iana","compressible":true,"extensions":["xop"]},"application/xproc+xml":{"source":"apache","extensions":["xpl"]},"application/xslt+xml":{"source":"iana","extensions":["xslt"]},"application/xspf+xml":{"source":"apache","extensions":["xspf"]},"application/xv+xml":{"source":"iana","extensions":["mxml","xhvml","xvml","xvm"]},"application/yang":{"source":"iana","extensions":["yang"]},"application/yang-data+json":{"source":"iana","compressible":true},"application/yang-data+xml":{"source":"iana"},"application/yang-patch+json":{"source":"iana","compressible":true},"application/yang-patch+xml":{"source":"iana"},"application/yin+xml":{"source":"iana","extensions":["yin"]},"application/zip":{"source":"iana","compressible":false,"extensions":["zip"]},"application/zlib":{"source":"iana"},"audio/1d-interleaved-parityfec":{"source":"iana"},"audio/32kadpcm":{"source":"iana"},"audio/3gpp":{"source":"iana","compressible":false,"extensions":["3gpp"]},"audio/3gpp2":{"source":"iana"},"audio/ac3":{"source":"iana"},"audio/adpcm":{"source":"apache","extensions":["adp"]},"audio/amr":{"source":"iana"},"audio/amr-wb":{"source":"iana"},"audio/amr-wb+":{"source":"iana"},"audio/aptx":{"source":"iana"},"audio/asc":{"source":"iana"},"audio/atrac-advanced-lossless":{"source":"iana"},"audio/atrac-x":{"source":"iana"},"audio/atrac3":{"source":"iana"},"audio/basic":{"source":"iana","compressible":false,"extensions":["au","snd"]},"audio/bv16":{"source":"iana"},"audio/bv32":{"source":"iana"},"audio/clearmode":{"source":"iana"},"audio/cn":{"source":"iana"},"audio/dat12":{"source":"iana"},"audio/dls":{"source":"iana"},"audio/dsr-es201108":{"source":"iana"},"audio/dsr-es202050":{"source":"iana"},"audio/dsr-es202211":{"source":"iana"},"audio/dsr-es202212":{"source":"iana"},"audio/dv":{"source":"iana"},"audio/dvi4":{"source":"iana"},"audio/eac3":{"source":"iana"},"audio/encaprtp":{"source":"iana"},"audio/evrc":{"source":"iana"},"audio/evrc-qcp":{"source":"iana"},"audio/evrc0":{"source":"iana"},"audio/evrc1":{"source":"iana"},"audio/evrcb":{"source":"iana"},"audio/evrcb0":{"source":"iana"},"audio/evrcb1":{"source":"iana"},"audio/evrcnw":{"source":"iana"},"audio/evrcnw0":{"source":"iana"},"audio/evrcnw1":{"source":"iana"},"audio/evrcwb":{"source":"iana"},"audio/evrcwb0":{"source":"iana"},"audio/evrcwb1":{"source":"iana"},"audio/evs":{"source":"iana"},"audio/fwdred":{"source":"iana"},"audio/g711-0":{"source":"iana"},"audio/g719":{"source":"iana"},"audio/g722":{"source":"iana"},"audio/g7221":{"source":"iana"},"audio/g723":{"source":"iana"},"audio/g726-16":{"source":"iana"},"audio/g726-24":{"source":"iana"},"audio/g726-32":{"source":"iana"},"audio/g726-40":{"source":"iana"},"audio/g728":{"source":"iana"},"audio/g729":{"source":"iana"},"audio/g7291":{"source":"iana"},"audio/g729d":{"source":"iana"},"audio/g729e":{"source":"iana"},"audio/gsm":{"source":"iana"},"audio/gsm-efr":{"source":"iana"},"audio/gsm-hr-08":{"source":"iana"},"audio/ilbc":{"source":"iana"},"audio/ip-mr_v2.5":{"source":"iana"},"audio/isac":{"source":"apache"},"audio/l16":{"source":"iana"},"audio/l20":{"source":"iana"},"audio/l24":{"source":"iana","compressible":false},"audio/l8":{"source":"iana"},"audio/lpc":{"source":"iana"},"audio/melp":{"source":"iana"},"audio/melp1200":{"source":"iana"},"audio/melp2400":{"source":"iana"},"audio/melp600":{"source":"iana"},"audio/midi":{"source":"apache","extensions":["mid","midi","kar","rmi"]},"audio/mobile-xmf":{"source":"iana"},"audio/mp3":{"compressible":false,"extensions":["mp3"]},"audio/mp4":{"source":"iana","compressible":false,"extensions":["m4a","mp4a"]},"audio/mp4a-latm":{"source":"iana"},"audio/mpa":{"source":"iana"},"audio/mpa-robust":{"source":"iana"},"audio/mpeg":{"source":"iana","compressible":false,"extensions":["mpga","mp2","mp2a","mp3","m2a","m3a"]},"audio/mpeg4-generic":{"source":"iana"},"audio/musepack":{"source":"apache"},"audio/ogg":{"source":"iana","compressible":false,"extensions":["oga","ogg","spx"]},"audio/opus":{"source":"iana"},"audio/parityfec":{"source":"iana"},"audio/pcma":{"source":"iana"},"audio/pcma-wb":{"source":"iana"},"audio/pcmu":{"source":"iana"},"audio/pcmu-wb":{"source":"iana"},"audio/prs.sid":{"source":"iana"},"audio/qcelp":{"source":"iana"},"audio/raptorfec":{"source":"iana"},"audio/red":{"source":"iana"},"audio/rtp-enc-aescm128":{"source":"iana"},"audio/rtp-midi":{"source":"iana"},"audio/rtploopback":{"source":"iana"},"audio/rtx":{"source":"iana"},"audio/s3m":{"source":"apache","extensions":["s3m"]},"audio/silk":{"source":"apache","extensions":["sil"]},"audio/smv":{"source":"iana"},"audio/smv-qcp":{"source":"iana"},"audio/smv0":{"source":"iana"},"audio/sp-midi":{"source":"iana"},"audio/speex":{"source":"iana"},"audio/t140c":{"source":"iana"},"audio/t38":{"source":"iana"},"audio/telephone-event":{"source":"iana"},"audio/tone":{"source":"iana"},"audio/uemclip":{"source":"iana"},"audio/ulpfec":{"source":"iana"},"audio/vdvi":{"source":"iana"},"audio/vmr-wb":{"source":"iana"},"audio/vnd.3gpp.iufp":{"source":"iana"},"audio/vnd.4sb":{"source":"iana"},"audio/vnd.audiokoz":{"source":"iana"},"audio/vnd.celp":{"source":"iana"},"audio/vnd.cisco.nse":{"source":"iana"},"audio/vnd.cmles.radio-events":{"source":"iana"},"audio/vnd.cns.anp1":{"source":"iana"},"audio/vnd.cns.inf1":{"source":"iana"},"audio/vnd.dece.audio":{"source":"iana","extensions":["uva","uvva"]},"audio/vnd.digital-winds":{"source":"iana","extensions":["eol"]},"audio/vnd.dlna.adts":{"source":"iana"},"audio/vnd.dolby.heaac.1":{"source":"iana"},"audio/vnd.dolby.heaac.2":{"source":"iana"},"audio/vnd.dolby.mlp":{"source":"iana"},"audio/vnd.dolby.mps":{"source":"iana"},"audio/vnd.dolby.pl2":{"source":"iana"},"audio/vnd.dolby.pl2x":{"source":"iana"},"audio/vnd.dolby.pl2z":{"source":"iana"},"audio/vnd.dolby.pulse.1":{"source":"iana"},"audio/vnd.dra":{"source":"iana","extensions":["dra"]},"audio/vnd.dts":{"source":"iana","extensions":["dts"]},"audio/vnd.dts.hd":{"source":"iana","extensions":["dtshd"]},"audio/vnd.dvb.file":{"source":"iana"},"audio/vnd.everad.plj":{"source":"iana"},"audio/vnd.hns.audio":{"source":"iana"},"audio/vnd.lucent.voice":{"source":"iana","extensions":["lvp"]},"audio/vnd.ms-playready.media.pya":{"source":"iana","extensions":["pya"]},"audio/vnd.nokia.mobile-xmf":{"source":"iana"},"audio/vnd.nortel.vbk":{"source":"iana"},"audio/vnd.nuera.ecelp4800":{"source":"iana","extensions":["ecelp4800"]},"audio/vnd.nuera.ecelp7470":{"source":"iana","extensions":["ecelp7470"]},"audio/vnd.nuera.ecelp9600":{"source":"iana","extensions":["ecelp9600"]},"audio/vnd.octel.sbc":{"source":"iana"},"audio/vnd.presonus.multitrack":{"source":"iana"},"audio/vnd.qcelp":{"source":"iana"},"audio/vnd.rhetorex.32kadpcm":{"source":"iana"},"audio/vnd.rip":{"source":"iana","extensions":["rip"]},"audio/vnd.rn-realaudio":{"compressible":false},"audio/vnd.sealedmedia.softseal.mpeg":{"source":"iana"},"audio/vnd.vmx.cvsd":{"source":"iana"},"audio/vnd.wave":{"compressible":false},"audio/vorbis":{"source":"iana","compressible":false},"audio/vorbis-config":{"source":"iana"},"audio/wav":{"compressible":false,"extensions":["wav"]},"audio/wave":{"compressible":false,"extensions":["wav"]},"audio/webm":{"source":"apache","compressible":false,"extensions":["weba"]},"audio/x-aac":{"source":"apache","compressible":false,"extensions":["aac"]},"audio/x-aiff":{"source":"apache","extensions":["aif","aiff","aifc"]},"audio/x-caf":{"source":"apache","compressible":false,"extensions":["caf"]},"audio/x-flac":{"source":"apache","extensions":["flac"]},"audio/x-m4a":{"source":"nginx","extensions":["m4a"]},"audio/x-matroska":{"source":"apache","extensions":["mka"]},"audio/x-mpegurl":{"source":"apache","extensions":["m3u"]},"audio/x-ms-wax":{"source":"apache","extensions":["wax"]},"audio/x-ms-wma":{"source":"apache","extensions":["wma"]},"audio/x-pn-realaudio":{"source":"apache","extensions":["ram","ra"]},"audio/x-pn-realaudio-plugin":{"source":"apache","extensions":["rmp"]},"audio/x-realaudio":{"source":"nginx","extensions":["ra"]},"audio/x-tta":{"source":"apache"},"audio/x-wav":{"source":"apache","extensions":["wav"]},"audio/xm":{"source":"apache","extensions":["xm"]},"chemical/x-cdx":{"source":"apache","extensions":["cdx"]},"chemical/x-cif":{"source":"apache","extensions":["cif"]},"chemical/x-cmdf":{"source":"apache","extensions":["cmdf"]},"chemical/x-cml":{"source":"apache","extensions":["cml"]},"chemical/x-csml":{"source":"apache","extensions":["csml"]},"chemical/x-pdb":{"source":"apache"},"chemical/x-xyz":{"source":"apache","extensions":["xyz"]},"font/collection":{"source":"iana","extensions":["ttc"]},"font/otf":{"source":"iana","compressible":true,"extensions":["otf"]},"font/sfnt":{"source":"iana"},"font/ttf":{"source":"iana","extensions":["ttf"]},"font/woff":{"source":"iana","extensions":["woff"]},"font/woff2":{"source":"iana","extensions":["woff2"]},"image/aces":{"source":"iana"},"image/apng":{"compressible":false,"extensions":["apng"]},"image/bmp":{"source":"iana","compressible":true,"extensions":["bmp"]},"image/cgm":{"source":"iana","extensions":["cgm"]},"image/dicom-rle":{"source":"iana"},"image/emf":{"source":"iana"},"image/fits":{"source":"iana"},"image/g3fax":{"source":"iana","extensions":["g3"]},"image/gif":{"source":"iana","compressible":false,"extensions":["gif"]},"image/ief":{"source":"iana","extensions":["ief"]},"image/jls":{"source":"iana"},"image/jp2":{"source":"iana","compressible":false,"extensions":["jp2","jpg2"]},"image/jpeg":{"source":"iana","compressible":false,"extensions":["jpeg","jpg","jpe"]},"image/jpm":{"source":"iana","compressible":false,"extensions":["jpm"]},"image/jpx":{"source":"iana","compressible":false,"extensions":["jpx","jpf"]},"image/ktx":{"source":"iana","extensions":["ktx"]},"image/naplps":{"source":"iana"},"image/pjpeg":{"compressible":false},"image/png":{"source":"iana","compressible":false,"extensions":["png"]},"image/prs.btif":{"source":"iana","extensions":["btif"]},"image/prs.pti":{"source":"iana"},"image/pwg-raster":{"source":"iana"},"image/sgi":{"source":"apache","extensions":["sgi"]},"image/svg+xml":{"source":"iana","compressible":true,"extensions":["svg","svgz"]},"image/t38":{"source":"iana"},"image/tiff":{"source":"iana","compressible":false,"extensions":["tiff","tif"]},"image/tiff-fx":{"source":"iana"},"image/vnd.adobe.photoshop":{"source":"iana","compressible":true,"extensions":["psd"]},"image/vnd.airzip.accelerator.azv":{"source":"iana"},"image/vnd.cns.inf2":{"source":"iana"},"image/vnd.dece.graphic":{"source":"iana","extensions":["uvi","uvvi","uvg","uvvg"]},"image/vnd.djvu":{"source":"iana","extensions":["djvu","djv"]},"image/vnd.dvb.subtitle":{"source":"iana","extensions":["sub"]},"image/vnd.dwg":{"source":"iana","extensions":["dwg"]},"image/vnd.dxf":{"source":"iana","extensions":["dxf"]},"image/vnd.fastbidsheet":{"source":"iana","extensions":["fbs"]},"image/vnd.fpx":{"source":"iana","extensions":["fpx"]},"image/vnd.fst":{"source":"iana","extensions":["fst"]},"image/vnd.fujixerox.edmics-mmr":{"source":"iana","extensions":["mmr"]},"image/vnd.fujixerox.edmics-rlc":{"source":"iana","extensions":["rlc"]},"image/vnd.globalgraphics.pgb":{"source":"iana"},"image/vnd.microsoft.icon":{"source":"iana"},"image/vnd.mix":{"source":"iana"},"image/vnd.mozilla.apng":{"source":"iana"},"image/vnd.ms-modi":{"source":"iana","extensions":["mdi"]},"image/vnd.ms-photo":{"source":"apache","extensions":["wdp"]},"image/vnd.net-fpx":{"source":"iana","extensions":["npx"]},"image/vnd.radiance":{"source":"iana"},"image/vnd.sealed.png":{"source":"iana"},"image/vnd.sealedmedia.softseal.gif":{"source":"iana"},"image/vnd.sealedmedia.softseal.jpg":{"source":"iana"},"image/vnd.svf":{"source":"iana"},"image/vnd.tencent.tap":{"source":"iana"},"image/vnd.valve.source.texture":{"source":"iana"},"image/vnd.wap.wbmp":{"source":"iana","extensions":["wbmp"]},"image/vnd.xiff":{"source":"iana","extensions":["xif"]},"image/vnd.zbrush.pcx":{"source":"iana"},"image/webp":{"source":"apache","extensions":["webp"]},"image/wmf":{"source":"iana"},"image/x-3ds":{"source":"apache","extensions":["3ds"]},"image/x-cmu-raster":{"source":"apache","extensions":["ras"]},"image/x-cmx":{"source":"apache","extensions":["cmx"]},"image/x-freehand":{"source":"apache","extensions":["fh","fhc","fh4","fh5","fh7"]},"image/x-icon":{"source":"apache","compressible":true,"extensions":["ico"]},"image/x-jng":{"source":"nginx","extensions":["jng"]},"image/x-mrsid-image":{"source":"apache","extensions":["sid"]},"image/x-ms-bmp":{"source":"nginx","compressible":true,"extensions":["bmp"]},"image/x-pcx":{"source":"apache","extensions":["pcx"]},"image/x-pict":{"source":"apache","extensions":["pic","pct"]},"image/x-portable-anymap":{"source":"apache","extensions":["pnm"]},"image/x-portable-bitmap":{"source":"apache","extensions":["pbm"]},"image/x-portable-graymap":{"source":"apache","extensions":["pgm"]},"image/x-portable-pixmap":{"source":"apache","extensions":["ppm"]},"image/x-rgb":{"source":"apache","extensions":["rgb"]},"image/x-tga":{"source":"apache","extensions":["tga"]},"image/x-xbitmap":{"source":"apache","extensions":["xbm"]},"image/x-xcf":{"compressible":false},"image/x-xpixmap":{"source":"apache","extensions":["xpm"]},"image/x-xwindowdump":{"source":"apache","extensions":["xwd"]},"message/cpim":{"source":"iana"},"message/delivery-status":{"source":"iana"},"message/disposition-notification":{"source":"iana","extensions":["disposition-notification"]},"message/external-body":{"source":"iana"},"message/feedback-report":{"source":"iana"},"message/global":{"source":"iana","extensions":["u8msg"]},"message/global-delivery-status":{"source":"iana","extensions":["u8dsn"]},"message/global-disposition-notification":{"source":"iana","extensions":["u8mdn"]},"message/global-headers":{"source":"iana","extensions":["u8hdr"]},"message/http":{"source":"iana","compressible":false},"message/imdn+xml":{"source":"iana","compressible":true},"message/news":{"source":"iana"},"message/partial":{"source":"iana","compressible":false},"message/rfc822":{"source":"iana","compressible":true,"extensions":["eml","mime"]},"message/s-http":{"source":"iana"},"message/sip":{"source":"iana"},"message/sipfrag":{"source":"iana"},"message/tracking-status":{"source":"iana"},"message/vnd.si.simp":{"source":"iana"},"message/vnd.wfa.wsc":{"source":"iana","extensions":["wsc"]},"model/3mf":{"source":"iana"},"model/gltf+json":{"source":"iana","compressible":true,"extensions":["gltf"]},"model/gltf-binary":{"source":"iana","compressible":true,"extensions":["glb"]},"model/iges":{"source":"iana","compressible":false,"extensions":["igs","iges"]},"model/mesh":{"source":"iana","compressible":false,"extensions":["msh","mesh","silo"]},"model/vnd.collada+xml":{"source":"iana","extensions":["dae"]},"model/vnd.dwf":{"source":"iana","extensions":["dwf"]},"model/vnd.flatland.3dml":{"source":"iana"},"model/vnd.gdl":{"source":"iana","extensions":["gdl"]},"model/vnd.gs-gdl":{"source":"apache"},"model/vnd.gs.gdl":{"source":"iana"},"model/vnd.gtw":{"source":"iana","extensions":["gtw"]},"model/vnd.moml+xml":{"source":"iana"},"model/vnd.mts":{"source":"iana","extensions":["mts"]},"model/vnd.opengex":{"source":"iana"},"model/vnd.parasolid.transmit.binary":{"source":"iana"},"model/vnd.parasolid.transmit.text":{"source":"iana"},"model/vnd.rosette.annotated-data-model":{"source":"iana"},"model/vnd.valve.source.compiled-map":{"source":"iana"},"model/vnd.vtu":{"source":"iana","extensions":["vtu"]},"model/vrml":{"source":"iana","compressible":false,"extensions":["wrl","vrml"]},"model/x3d+binary":{"source":"apache","compressible":false,"extensions":["x3db","x3dbz"]},"model/x3d+fastinfoset":{"source":"iana"},"model/x3d+vrml":{"source":"apache","compressible":false,"extensions":["x3dv","x3dvz"]},"model/x3d+xml":{"source":"iana","compressible":true,"extensions":["x3d","x3dz"]},"model/x3d-vrml":{"source":"iana"},"multipart/alternative":{"source":"iana","compressible":false},"multipart/appledouble":{"source":"iana"},"multipart/byteranges":{"source":"iana"},"multipart/digest":{"source":"iana"},"multipart/encrypted":{"source":"iana","compressible":false},"multipart/form-data":{"source":"iana","compressible":false},"multipart/header-set":{"source":"iana"},"multipart/mixed":{"source":"iana","compressible":false},"multipart/multilingual":{"source":"iana"},"multipart/parallel":{"source":"iana"},"multipart/related":{"source":"iana","compressible":false},"multipart/report":{"source":"iana"},"multipart/signed":{"source":"iana","compressible":false},"multipart/vnd.bint.med-plus":{"source":"iana"},"multipart/voice-message":{"source":"iana"},"multipart/x-mixed-replace":{"source":"iana"},"text/1d-interleaved-parityfec":{"source":"iana"},"text/cache-manifest":{"source":"iana","compressible":true,"extensions":["appcache","manifest"]},"text/calendar":{"source":"iana","extensions":["ics","ifb"]},"text/calender":{"compressible":true},"text/cmd":{"compressible":true},"text/coffeescript":{"extensions":["coffee","litcoffee"]},"text/css":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["css"]},"text/csv":{"source":"iana","compressible":true,"extensions":["csv"]},"text/csv-schema":{"source":"iana"},"text/directory":{"source":"iana"},"text/dns":{"source":"iana"},"text/ecmascript":{"source":"iana"},"text/encaprtp":{"source":"iana"},"text/enriched":{"source":"iana"},"text/fwdred":{"source":"iana"},"text/grammar-ref-list":{"source":"iana"},"text/html":{"source":"iana","compressible":true,"extensions":["html","htm","shtml"]},"text/jade":{"extensions":["jade"]},"text/javascript":{"source":"iana","compressible":true},"text/jcr-cnd":{"source":"iana"},"text/jsx":{"compressible":true,"extensions":["jsx"]},"text/less":{"extensions":["less"]},"text/markdown":{"source":"iana","compressible":true,"extensions":["markdown","md"]},"text/mathml":{"source":"nginx","extensions":["mml"]},"text/mizar":{"source":"iana"},"text/n3":{"source":"iana","compressible":true,"extensions":["n3"]},"text/parameters":{"source":"iana"},"text/parityfec":{"source":"iana"},"text/plain":{"source":"iana","compressible":true,"extensions":["txt","text","conf","def","list","log","in","ini"]},"text/provenance-notation":{"source":"iana"},"text/prs.fallenstein.rst":{"source":"iana"},"text/prs.lines.tag":{"source":"iana","extensions":["dsc"]},"text/prs.prop.logic":{"source":"iana"},"text/raptorfec":{"source":"iana"},"text/red":{"source":"iana"},"text/rfc822-headers":{"source":"iana"},"text/richtext":{"source":"iana","compressible":true,"extensions":["rtx"]},"text/rtf":{"source":"iana","compressible":true,"extensions":["rtf"]},"text/rtp-enc-aescm128":{"source":"iana"},"text/rtploopback":{"source":"iana"},"text/rtx":{"source":"iana"},"text/sgml":{"source":"iana","extensions":["sgml","sgm"]},"text/shex":{"extensions":["shex"]},"text/slim":{"extensions":["slim","slm"]},"text/strings":{"source":"iana"},"text/stylus":{"extensions":["stylus","styl"]},"text/t140":{"source":"iana"},"text/tab-separated-values":{"source":"iana","compressible":true,"extensions":["tsv"]},"text/troff":{"source":"iana","extensions":["t","tr","roff","man","me","ms"]},"text/turtle":{"source":"iana","extensions":["ttl"]},"text/ulpfec":{"source":"iana"},"text/uri-list":{"source":"iana","compressible":true,"extensions":["uri","uris","urls"]},"text/vcard":{"source":"iana","compressible":true,"extensions":["vcard"]},"text/vnd.a":{"source":"iana"},"text/vnd.abc":{"source":"iana"},"text/vnd.ascii-art":{"source":"iana"},"text/vnd.curl":{"source":"iana","extensions":["curl"]},"text/vnd.curl.dcurl":{"source":"apache","extensions":["dcurl"]},"text/vnd.curl.mcurl":{"source":"apache","extensions":["mcurl"]},"text/vnd.curl.scurl":{"source":"apache","extensions":["scurl"]},"text/vnd.debian.copyright":{"source":"iana"},"text/vnd.dmclientscript":{"source":"iana"},"text/vnd.dvb.subtitle":{"source":"iana","extensions":["sub"]},"text/vnd.esmertec.theme-descriptor":{"source":"iana"},"text/vnd.fly":{"source":"iana","extensions":["fly"]},"text/vnd.fmi.flexstor":{"source":"iana","extensions":["flx"]},"text/vnd.graphviz":{"source":"iana","extensions":["gv"]},"text/vnd.in3d.3dml":{"source":"iana","extensions":["3dml"]},"text/vnd.in3d.spot":{"source":"iana","extensions":["spot"]},"text/vnd.iptc.newsml":{"source":"iana"},"text/vnd.iptc.nitf":{"source":"iana"},"text/vnd.latex-z":{"source":"iana"},"text/vnd.motorola.reflex":{"source":"iana"},"text/vnd.ms-mediapackage":{"source":"iana"},"text/vnd.net2phone.commcenter.command":{"source":"iana"},"text/vnd.radisys.msml-basic-layout":{"source":"iana"},"text/vnd.si.uricatalogue":{"source":"iana"},"text/vnd.sun.j2me.app-descriptor":{"source":"iana","extensions":["jad"]},"text/vnd.trolltech.linguist":{"source":"iana"},"text/vnd.wap.si":{"source":"iana"},"text/vnd.wap.sl":{"source":"iana"},"text/vnd.wap.wml":{"source":"iana","extensions":["wml"]},"text/vnd.wap.wmlscript":{"source":"iana","extensions":["wmls"]},"text/vtt":{"charset":"UTF-8","compressible":true,"extensions":["vtt"]},"text/x-asm":{"source":"apache","extensions":["s","asm"]},"text/x-c":{"source":"apache","extensions":["c","cc","cxx","cpp","h","hh","dic"]},"text/x-component":{"source":"nginx","extensions":["htc"]},"text/x-fortran":{"source":"apache","extensions":["f","for","f77","f90"]},"text/x-gwt-rpc":{"compressible":true},"text/x-handlebars-template":{"extensions":["hbs"]},"text/x-java-source":{"source":"apache","extensions":["java"]},"text/x-jquery-tmpl":{"compressible":true},"text/x-lua":{"extensions":["lua"]},"text/x-markdown":{"compressible":true,"extensions":["mkd"]},"text/x-nfo":{"source":"apache","extensions":["nfo"]},"text/x-opml":{"source":"apache","extensions":["opml"]},"text/x-org":{"compressible":true,"extensions":["org"]},"text/x-pascal":{"source":"apache","extensions":["p","pas"]},"text/x-processing":{"compressible":true,"extensions":["pde"]},"text/x-sass":{"extensions":["sass"]},"text/x-scss":{"extensions":["scss"]},"text/x-setext":{"source":"apache","extensions":["etx"]},"text/x-sfv":{"source":"apache","extensions":["sfv"]},"text/x-suse-ymp":{"compressible":true,"extensions":["ymp"]},"text/x-uuencode":{"source":"apache","extensions":["uu"]},"text/x-vcalendar":{"source":"apache","extensions":["vcs"]},"text/x-vcard":{"source":"apache","extensions":["vcf"]},"text/xml":{"source":"iana","compressible":true,"extensions":["xml"]},"text/xml-external-parsed-entity":{"source":"iana"},"text/yaml":{"extensions":["yaml","yml"]},"video/1d-interleaved-parityfec":{"source":"iana"},"video/3gpp":{"source":"iana","extensions":["3gp","3gpp"]},"video/3gpp-tt":{"source":"iana"},"video/3gpp2":{"source":"iana","extensions":["3g2"]},"video/bmpeg":{"source":"iana"},"video/bt656":{"source":"iana"},"video/celb":{"source":"iana"},"video/dv":{"source":"iana"},"video/encaprtp":{"source":"iana"},"video/h261":{"source":"iana","extensions":["h261"]},"video/h263":{"source":"iana","extensions":["h263"]},"video/h263-1998":{"source":"iana"},"video/h263-2000":{"source":"iana"},"video/h264":{"source":"iana","extensions":["h264"]},"video/h264-rcdo":{"source":"iana"},"video/h264-svc":{"source":"iana"},"video/h265":{"source":"iana"},"video/iso.segment":{"source":"iana"},"video/jpeg":{"source":"iana","extensions":["jpgv"]},"video/jpeg2000":{"source":"iana"},"video/jpm":{"source":"apache","extensions":["jpm","jpgm"]},"video/mj2":{"source":"iana","extensions":["mj2","mjp2"]},"video/mp1s":{"source":"iana"},"video/mp2p":{"source":"iana"},"video/mp2t":{"source":"iana","extensions":["ts"]},"video/mp4":{"source":"iana","compressible":false,"extensions":["mp4","mp4v","mpg4"]},"video/mp4v-es":{"source":"iana"},"video/mpeg":{"source":"iana","compressible":false,"extensions":["mpeg","mpg","mpe","m1v","m2v"]},"video/mpeg4-generic":{"source":"iana"},"video/mpv":{"source":"iana"},"video/nv":{"source":"iana"},"video/ogg":{"source":"iana","compressible":false,"extensions":["ogv"]},"video/parityfec":{"source":"iana"},"video/pointer":{"source":"iana"},"video/quicktime":{"source":"iana","compressible":false,"extensions":["qt","mov"]},"video/raptorfec":{"source":"iana"},"video/raw":{"source":"iana"},"video/rtp-enc-aescm128":{"source":"iana"},"video/rtploopback":{"source":"iana"},"video/rtx":{"source":"iana"},"video/smpte291":{"source":"iana"},"video/smpte292m":{"source":"iana"},"video/ulpfec":{"source":"iana"},"video/vc1":{"source":"iana"},"video/vnd.cctv":{"source":"iana"},"video/vnd.dece.hd":{"source":"iana","extensions":["uvh","uvvh"]},"video/vnd.dece.mobile":{"source":"iana","extensions":["uvm","uvvm"]},"video/vnd.dece.mp4":{"source":"iana"},"video/vnd.dece.pd":{"source":"iana","extensions":["uvp","uvvp"]},"video/vnd.dece.sd":{"source":"iana","extensions":["uvs","uvvs"]},"video/vnd.dece.video":{"source":"iana","extensions":["uvv","uvvv"]},"video/vnd.directv.mpeg":{"source":"iana"},"video/vnd.directv.mpeg-tts":{"source":"iana"},"video/vnd.dlna.mpeg-tts":{"source":"iana"},"video/vnd.dvb.file":{"source":"iana","extensions":["dvb"]},"video/vnd.fvt":{"source":"iana","extensions":["fvt"]},"video/vnd.hns.video":{"source":"iana"},"video/vnd.iptvforum.1dparityfec-1010":{"source":"iana"},"video/vnd.iptvforum.1dparityfec-2005":{"source":"iana"},"video/vnd.iptvforum.2dparityfec-1010":{"source":"iana"},"video/vnd.iptvforum.2dparityfec-2005":{"source":"iana"},"video/vnd.iptvforum.ttsavc":{"source":"iana"},"video/vnd.iptvforum.ttsmpeg2":{"source":"iana"},"video/vnd.motorola.video":{"source":"iana"},"video/vnd.motorola.videop":{"source":"iana"},"video/vnd.mpegurl":{"source":"iana","extensions":["mxu","m4u"]},"video/vnd.ms-playready.media.pyv":{"source":"iana","extensions":["pyv"]},"video/vnd.nokia.interleaved-multimedia":{"source":"iana"},"video/vnd.nokia.mp4vr":{"source":"iana"},"video/vnd.nokia.videovoip":{"source":"iana"},"video/vnd.objectvideo":{"source":"iana"},"video/vnd.radgamettools.bink":{"source":"iana"},"video/vnd.radgamettools.smacker":{"source":"iana"},"video/vnd.sealed.mpeg1":{"source":"iana"},"video/vnd.sealed.mpeg4":{"source":"iana"},"video/vnd.sealed.swf":{"source":"iana"},"video/vnd.sealedmedia.softseal.mov":{"source":"iana"},"video/vnd.uvvu.mp4":{"source":"iana","extensions":["uvu","uvvu"]},"video/vnd.vivo":{"source":"iana","extensions":["viv"]},"video/vp8":{"source":"iana"},"video/webm":{"source":"apache","compressible":false,"extensions":["webm"]},"video/x-f4v":{"source":"apache","extensions":["f4v"]},"video/x-fli":{"source":"apache","extensions":["fli"]},"video/x-flv":{"source":"apache","compressible":false,"extensions":["flv"]},"video/x-m4v":{"source":"apache","extensions":["m4v"]},"video/x-matroska":{"source":"apache","compressible":false,"extensions":["mkv","mk3d","mks"]},"video/x-mng":{"source":"apache","extensions":["mng"]},"video/x-ms-asf":{"source":"apache","extensions":["asf","asx"]},"video/x-ms-vob":{"source":"apache","extensions":["vob"]},"video/x-ms-wm":{"source":"apache","extensions":["wm"]},"video/x-ms-wmv":{"source":"apache","compressible":false,"extensions":["wmv"]},"video/x-ms-wmx":{"source":"apache","extensions":["wmx"]},"video/x-ms-wvx":{"source":"apache","extensions":["wvx"]},"video/x-msvideo":{"source":"apache","extensions":["avi"]},"video/x-sgi-movie":{"source":"apache","extensions":["movie"]},"video/x-smv":{"source":"apache","extensions":["smv"]},"x-conference/x-cooltalk":{"source":"apache","extensions":["ice"]},"x-shader/x-fragment":{"compressible":true},"x-shader/x-vertex":{"compressible":true}}',
  );
});

parcelRegister('l3tNL', function (module, exports) {
  // Use explicit /index.js to help browserify negociation in require '/lib/http-proxy' (!)

  var $hEaMl = parcelRequire('hEaMl');
  var $f540fec936920a3b$require$ProxyServer = $hEaMl.Server;
  /**
   * Creates the proxy server.
   *
   * Examples:
   *
   *    httpProxy.createProxyServer({ .. }, 8000)
   *    // => '{ web: [Function], ws: [Function] ... }'
   *
   * @param {Object} Options Config object passed to the proxy
   *
   * @return {Object} Proxy Proxy object with handlers for `ws` and `web` requests
   *
   * @api public
   */ function $f540fec936920a3b$var$createProxyServer(options) {
    /*
     *  `options` is needed and it must have the following layout:
     *
     *  {
     *    target : <url string to be parsed with the url module>
     *    forward: <url string to be parsed with the url module>
     *    agent  : <object to be passed to http(s).request>
     *    ssl    : <object to be passed to https.createServer()>
     *    ws     : <true/false, if you want to proxy websockets>
     *    xfwd   : <true/false, adds x-forward headers>
     *    secure : <true/false, verify SSL certificate>
     *    toProxy: <true/false, explicitly specify if we are proxying to another proxy>
     *    prependPath: <true/false, Default: true - specify whether you want to prepend the target's path to the proxy path>
     *    ignorePath: <true/false, Default: false - specify whether you want to ignore the proxy path of the incoming request>
     *    localAddress : <Local interface string to bind for outgoing connections>
     *    changeOrigin: <true/false, Default: false - changes the origin of the host header to the target URL>
     *    preserveHeaderKeyCase: <true/false, Default: false - specify whether you want to keep letter case of response header key >
     *    auth   : Basic authentication i.e. 'user:password' to compute an Authorization header.
     *    hostRewrite: rewrites the location hostname on (201/301/302/307/308) redirects, Default: null.
     *    autoRewrite: rewrites the location host/port on (201/301/302/307/308) redirects based on requested host/port. Default: false.
     *    protocolRewrite: rewrites the location protocol on (201/301/302/307/308) redirects to 'http' or 'https'. Default: null.
     *  }
     *
     *  NOTE: `options.ws` and `options.ssl` are optional.
     *    `options.target and `options.forward` cannot be
     *    both missing
     *  }
     */ return new $f540fec936920a3b$require$ProxyServer(options);
  }
  $f540fec936920a3b$require$ProxyServer.createProxyServer =
    $f540fec936920a3b$var$createProxyServer;
  $f540fec936920a3b$require$ProxyServer.createServer =
    $f540fec936920a3b$var$createProxyServer;
  $f540fec936920a3b$require$ProxyServer.createProxy =
    $f540fec936920a3b$var$createProxyServer;
  /**
   * Export the proxy "Server" as the main export.
   */ module.exports = $f540fec936920a3b$require$ProxyServer;
});
parcelRegister('hEaMl', function (module, exports) {
  var $cd8e8882787f8781$var$httpProxy = module.exports;

  var $cd8e8882787f8781$require$extend = $dmXIQ$util._extend;

  var $cd8e8882787f8781$require$parse_url = $dmXIQ$url.parse;

  var $fNOal = parcelRequire('fNOal');

  var $haUo1 = parcelRequire('haUo1');

  var $2S1NY = parcelRequire('2S1NY');
  $cd8e8882787f8781$var$httpProxy.Server = $cd8e8882787f8781$var$ProxyServer;
  /**
   * Returns a function that creates the loader for
   * either `ws` or `web`'s  passes.
   *
   * Examples:
   *
   *    httpProxy.createRightProxy('ws')
   *    // => [Function]
   *
   * @param {String} Type Either 'ws' or 'web'
   *
   * @return {Function} Loader Function that when called returns an iterator for the right passes
   *
   * @api private
   */ function $cd8e8882787f8781$var$createRightProxy(type) {
    return function (options) {
      return function (req, res /*, [head], [opts] */) {
        var passes = type === 'ws' ? this.wsPasses : this.webPasses,
          args = [].slice.call(arguments),
          cntr = args.length - 1,
          head,
          cbl;
        /* optional args parse begin */ if (typeof args[cntr] === 'function') {
          cbl = args[cntr];
          cntr--;
        }
        var requestOptions = options;
        if (!(args[cntr] instanceof Buffer) && args[cntr] !== res) {
          //Copy global options
          requestOptions = $cd8e8882787f8781$require$extend({}, options);
          //Overwrite with request options
          $cd8e8882787f8781$require$extend(requestOptions, args[cntr]);
          cntr--;
        }
        if (args[cntr] instanceof Buffer) head = args[cntr];
        /* optional args parse end */ ['target', 'forward'].forEach(function (
          e,
        ) {
          if (typeof requestOptions[e] === 'string')
            requestOptions[e] = $cd8e8882787f8781$require$parse_url(
              requestOptions[e],
            );
        });
        if (!requestOptions.target && !requestOptions.forward)
          return this.emit(
            'error',
            new Error('Must provide a proper URL as target'),
          );
        for (var i = 0; i < passes.length; i++) {
          /**
           * Call of passes functions
           * pass(req, res, options, head)
           *
           * In WebSockets case the `res` variable
           * refer to the connection socket
           * pass(req, socket, options, head)
           */ if (passes[i](req, res, requestOptions, head, this, cbl)) break;
        }
      };
    };
  }
  $cd8e8882787f8781$var$httpProxy.createRightProxy =
    $cd8e8882787f8781$var$createRightProxy;
  function $cd8e8882787f8781$var$ProxyServer(options) {
    $fNOal.call(this);
    options = options || {};
    options.prependPath = options.prependPath === false ? false : true;
    this.web = this.proxyRequest =
      $cd8e8882787f8781$var$createRightProxy('web')(options);
    this.ws = this.proxyWebsocketRequest =
      $cd8e8882787f8781$var$createRightProxy('ws')(options);
    this.options = options;
    this.webPasses = Object.keys($haUo1).map(function (pass) {
      return $haUo1[pass];
    });
    this.wsPasses = Object.keys($2S1NY).map(function (pass) {
      return $2S1NY[pass];
    });
    this.on('error', this.onError, this);
  }

  $dmXIQ$util.inherits($cd8e8882787f8781$var$ProxyServer, $fNOal);
  $cd8e8882787f8781$var$ProxyServer.prototype.onError = function (err) {
    //
    // Remark: Replicate node core behavior using EE3
    // so we force people to handle their own errors
    //
    if (this.listeners('error').length === 1) throw err;
  };
  $cd8e8882787f8781$var$ProxyServer.prototype.listen = function (
    port,
    hostname,
  ) {
    var self = this,
      closure = function (req, res) {
        self.web(req, res);
      };
    this._server = this.options.ssl
      ? $dmXIQ$https.createServer(this.options.ssl, closure)
      : $dmXIQ$http.createServer(closure);
    if (this.options.ws)
      this._server.on('upgrade', function (req, socket, head) {
        self.ws(req, socket, head);
      });
    this._server.listen(port, hostname);
    return this;
  };
  $cd8e8882787f8781$var$ProxyServer.prototype.close = function (callback) {
    var self = this;
    if (this._server) this._server.close(done);
    // Wrap callback to nullify server after all open connections are closed.
    function done() {
      self._server = null;
      if (callback) callback.apply(null, arguments);
    }
  };
  $cd8e8882787f8781$var$ProxyServer.prototype.before = function (
    type,
    passName,
    callback,
  ) {
    if (type !== 'ws' && type !== 'web')
      throw new Error('type must be `web` or `ws`');
    var passes = type === 'ws' ? this.wsPasses : this.webPasses,
      i = false;
    passes.forEach(function (v, idx) {
      if (v.name === passName) i = idx;
    });
    if (i === false) throw new Error('No such pass');
    passes.splice(i, 0, callback);
  };
  $cd8e8882787f8781$var$ProxyServer.prototype.after = function (
    type,
    passName,
    callback,
  ) {
    if (type !== 'ws' && type !== 'web')
      throw new Error('type must be `web` or `ws`');
    var passes = type === 'ws' ? this.wsPasses : this.webPasses,
      i = false;
    passes.forEach(function (v, idx) {
      if (v.name === passName) i = idx;
    });
    if (i === false) throw new Error('No such pass');
    passes.splice(i++, 0, callback);
  };
});
parcelRegister('fNOal', function (module, exports) {
  'use strict';
  var $b81258815b2f790a$var$has = Object.prototype.hasOwnProperty,
    $b81258815b2f790a$var$prefix = '~';
  /**
   * Constructor to create a storage for our `EE` objects.
   * An `Events` instance is a plain object whose properties are event names.
   *
   * @constructor
   * @private
   */ function $b81258815b2f790a$var$Events() {}
  //
  // We try to not inherit from `Object.prototype`. In some engines creating an
  // instance in this way is faster than calling `Object.create(null)` directly.
  // If `Object.create(null)` is not supported we prefix the event names with a
  // character to make sure that the built-in object properties are not
  // overridden or used as an attack vector.
  //
  if (Object.create) {
    $b81258815b2f790a$var$Events.prototype = Object.create(null);
    //
    // This hack is needed because the `__proto__` property is still inherited in
    // some old browsers like Android 4, iPhone 5.1, Opera 11 and Safari 5.
    //
    if (!new $b81258815b2f790a$var$Events().__proto__)
      $b81258815b2f790a$var$prefix = false;
  }
  /**
   * Representation of a single event listener.
   *
   * @param {Function} fn The listener function.
   * @param {*} context The context to invoke the listener with.
   * @param {Boolean} [once=false] Specify if the listener is a one-time listener.
   * @constructor
   * @private
   */ function $b81258815b2f790a$var$EE(fn, context, once) {
    this.fn = fn;
    this.context = context;
    this.once = once || false;
  }
  /**
   * Add a listener for a given event.
   *
   * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
   * @param {(String|Symbol)} event The event name.
   * @param {Function} fn The listener function.
   * @param {*} context The context to invoke the listener with.
   * @param {Boolean} once Specify if the listener is a one-time listener.
   * @returns {EventEmitter}
   * @private
   */ function $b81258815b2f790a$var$addListener(
    emitter,
    event,
    fn,
    context,
    once,
  ) {
    if (typeof fn !== 'function')
      throw new TypeError('The listener must be a function');
    var listener = new $b81258815b2f790a$var$EE(fn, context || emitter, once),
      evt = $b81258815b2f790a$var$prefix
        ? $b81258815b2f790a$var$prefix + event
        : event;
    if (!emitter._events[evt])
      (emitter._events[evt] = listener), emitter._eventsCount++;
    else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
    else emitter._events[evt] = [emitter._events[evt], listener];
    return emitter;
  }
  /**
   * Clear event by name.
   *
   * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
   * @param {(String|Symbol)} evt The Event name.
   * @private
   */ function $b81258815b2f790a$var$clearEvent(emitter, evt) {
    if (--emitter._eventsCount === 0)
      emitter._events = new $b81258815b2f790a$var$Events();
    else delete emitter._events[evt];
  }
  /**
   * Minimal `EventEmitter` interface that is molded against the Node.js
   * `EventEmitter` interface.
   *
   * @constructor
   * @public
   */ function $b81258815b2f790a$var$EventEmitter() {
    this._events = new $b81258815b2f790a$var$Events();
    this._eventsCount = 0;
  }
  /**
   * Return an array listing the events for which the emitter has registered
   * listeners.
   *
   * @returns {Array}
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.eventNames =
    function eventNames() {
      var names = [],
        events,
        name;
      if (this._eventsCount === 0) return names;
      for (name in (events = this._events))
        if ($b81258815b2f790a$var$has.call(events, name))
          names.push($b81258815b2f790a$var$prefix ? name.slice(1) : name);
      if (Object.getOwnPropertySymbols)
        return names.concat(Object.getOwnPropertySymbols(events));
      return names;
    };
  /**
   * Return the listeners registered for a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @returns {Array} The registered listeners.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.listeners =
    function listeners(event) {
      var evt = $b81258815b2f790a$var$prefix
          ? $b81258815b2f790a$var$prefix + event
          : event,
        handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++)
        ee[i] = handlers[i].fn;
      return ee;
    };
  /**
   * Return the number of listeners listening to a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @returns {Number} The number of listeners.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.listenerCount =
    function listenerCount(event) {
      var evt = $b81258815b2f790a$var$prefix
          ? $b81258815b2f790a$var$prefix + event
          : event,
        listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
  /**
   * Calls each of the listeners registered for a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @returns {Boolean} `true` if the event had listeners, else `false`.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.emit = function emit(
    event,
    a1,
    a2,
    a3,
    a4,
    a5,
  ) {
    var evt = $b81258815b2f790a$var$prefix
      ? $b81258815b2f790a$var$prefix + event
      : event;
    if (!this._events[evt]) return false;
    var listeners = this._events[evt],
      len = arguments.length,
      args,
      i;
    if (listeners.fn) {
      if (listeners.once)
        this.removeListener(event, listeners.fn, undefined, true);
      switch (len) {
        case 1:
          return listeners.fn.call(listeners.context), true;
        case 2:
          return listeners.fn.call(listeners.context, a1), true;
        case 3:
          return listeners.fn.call(listeners.context, a1, a2), true;
        case 4:
          return listeners.fn.call(listeners.context, a1, a2, a3), true;
        case 5:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
        case 6:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
      }
      for (i = 1, args = new Array(len - 1); i < len; i++)
        args[i - 1] = arguments[i];
      listeners.fn.apply(listeners.context, args);
    } else {
      var length = listeners.length,
        j;
      for (i = 0; i < length; i++) {
        if (listeners[i].once)
          this.removeListener(event, listeners[i].fn, undefined, true);
        switch (len) {
          case 1:
            listeners[i].fn.call(listeners[i].context);
            break;
          case 2:
            listeners[i].fn.call(listeners[i].context, a1);
            break;
          case 3:
            listeners[i].fn.call(listeners[i].context, a1, a2);
            break;
          case 4:
            listeners[i].fn.call(listeners[i].context, a1, a2, a3);
            break;
          default:
            if (!args)
              for (j = 1, args = new Array(len - 1); j < len; j++)
                args[j - 1] = arguments[j];
            listeners[i].fn.apply(listeners[i].context, args);
        }
      }
    }
    return true;
  };
  /**
   * Add a listener for a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @param {Function} fn The listener function.
   * @param {*} [context=this] The context to invoke the listener with.
   * @returns {EventEmitter} `this`.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.on = function on(
    event,
    fn,
    context,
  ) {
    return $b81258815b2f790a$var$addListener(this, event, fn, context, false);
  };
  /**
   * Add a one-time listener for a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @param {Function} fn The listener function.
   * @param {*} [context=this] The context to invoke the listener with.
   * @returns {EventEmitter} `this`.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.once = function once(
    event,
    fn,
    context,
  ) {
    return $b81258815b2f790a$var$addListener(this, event, fn, context, true);
  };
  /**
   * Remove the listeners of a given event.
   *
   * @param {(String|Symbol)} event The event name.
   * @param {Function} fn Only remove the listeners that match this function.
   * @param {*} context Only remove the listeners that have this context.
   * @param {Boolean} once Only remove one-time listeners.
   * @returns {EventEmitter} `this`.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.removeListener =
    function removeListener(event, fn, context, once) {
      var evt = $b81258815b2f790a$var$prefix
        ? $b81258815b2f790a$var$prefix + event
        : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        $b81258815b2f790a$var$clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (
          listeners.fn === fn &&
          (!once || listeners.once) &&
          (!context || listeners.context === context)
        )
          $b81258815b2f790a$var$clearEvent(this, evt);
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++)
          if (
            listeners[i].fn !== fn ||
            (once && !listeners[i].once) ||
            (context && listeners[i].context !== context)
          )
            events.push(listeners[i]);
        //
        // Reset the array, or remove it completely if we have no more listeners.
        //
        if (events.length)
          this._events[evt] = events.length === 1 ? events[0] : events;
        else $b81258815b2f790a$var$clearEvent(this, evt);
      }
      return this;
    };
  /**
   * Remove all listeners, or those of the specified event.
   *
   * @param {(String|Symbol)} [event] The event name.
   * @returns {EventEmitter} `this`.
   * @public
   */ $b81258815b2f790a$var$EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = $b81258815b2f790a$var$prefix
          ? $b81258815b2f790a$var$prefix + event
          : event;
        if (this._events[evt]) $b81258815b2f790a$var$clearEvent(this, evt);
      } else {
        this._events = new $b81258815b2f790a$var$Events();
        this._eventsCount = 0;
      }
      return this;
    };
  //
  // Alias methods names because people roll like that.
  //
  $b81258815b2f790a$var$EventEmitter.prototype.off =
    $b81258815b2f790a$var$EventEmitter.prototype.removeListener;
  $b81258815b2f790a$var$EventEmitter.prototype.addListener =
    $b81258815b2f790a$var$EventEmitter.prototype.on;
  //
  // Expose the prefix.
  //
  $b81258815b2f790a$var$EventEmitter.prefixed = $b81258815b2f790a$var$prefix;
  //
  // Allow `EventEmitter` to be imported as module namespace.
  //
  $b81258815b2f790a$var$EventEmitter.EventEmitter =
    $b81258815b2f790a$var$EventEmitter;
  module.exports = $b81258815b2f790a$var$EventEmitter;
});

parcelRegister('haUo1', function (module, exports) {
  var $bwLp6 = parcelRequire('bwLp6');
  var $c80f1c04525be956$require$web_o = $bwLp6;

  var $lP3ge = parcelRequire('lP3ge');

  var $cRyUo = parcelRequire('cRyUo');
  $c80f1c04525be956$require$web_o = Object.keys(
    $c80f1c04525be956$require$web_o,
  ).map(function (pass) {
    return $c80f1c04525be956$require$web_o[pass];
  });
  var $c80f1c04525be956$var$nativeAgents = {
    http: $dmXIQ$http,
    https: $dmXIQ$https,
  };
  /*!
   * Array of passes.
   *
   * A `pass` is just a function that is executed on `req, res, options`
   * so that you can easily add new checks while still keeping the base
   * flexible.
   */ module.exports = {
    /**
     * Sets `content-length` to '0' if request is of DELETE type.
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ deleteLength: function deleteLength(req, res, options) {
      if (
        (req.method === 'DELETE' || req.method === 'OPTIONS') &&
        !req.headers['content-length']
      ) {
        req.headers['content-length'] = '0';
        delete req.headers['transfer-encoding'];
      }
    },
    /**
     * Sets timeout in request socket if it was specified in options.
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ timeout: function timeout(req, res, options) {
      if (options.timeout) req.socket.setTimeout(options.timeout);
    },
    /**
     * Sets `x-forwarded-*` headers if specified in config.
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ XHeaders: function XHeaders(req, res, options) {
      if (!options.xfwd) return;
      var encrypted = req.isSpdy || $lP3ge.hasEncryptedConnection(req);
      var values = {
        for: req.connection.remoteAddress || req.socket.remoteAddress,
        port: $lP3ge.getPort(req),
        proto: encrypted ? 'https' : 'http',
      };
      ['for', 'port', 'proto'].forEach(function (header) {
        req.headers['x-forwarded-' + header] =
          (req.headers['x-forwarded-' + header] || '') +
          (req.headers['x-forwarded-' + header] ? ',' : '') +
          values[header];
      });
      req.headers['x-forwarded-host'] =
        req.headers['x-forwarded-host'] || req.headers['host'] || '';
    },
    /**
     * Does the actual proxying. If `forward` is enabled fires up
     * a ForwardStream, same happens for ProxyStream. The request
     * just dies otherwise.
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ stream: function stream(req, res, options, _, server, clb) {
      // And we begin!
      server.emit('start', req, res, options.target || options.forward);
      var agents = options.followRedirects
        ? $cRyUo
        : $c80f1c04525be956$var$nativeAgents;
      var http = agents.http;
      var https = agents.https;
      if (options.forward) {
        // If forward enable, so just pipe the request
        var forwardReq = (
          options.forward.protocol === 'https:' ? https : http
        ).request(
          $lP3ge.setupOutgoing(options.ssl || {}, options, req, 'forward'),
        );
        // error handler (e.g. ECONNRESET, ECONNREFUSED)
        // Handle errors on incoming request as well as it makes sense to
        var forwardError = createErrorHandler(forwardReq, options.forward);
        req.on('error', forwardError);
        forwardReq.on('error', forwardError);
        (options.buffer || req).pipe(forwardReq);
        if (!options.target) return res.end();
      }
      // Request initalization
      var proxyReq = (
        options.target.protocol === 'https:' ? https : http
      ).request($lP3ge.setupOutgoing(options.ssl || {}, options, req));
      // Enable developers to modify the proxyReq before headers are sent
      proxyReq.on('socket', function (socket) {
        if (server && !proxyReq.getHeader('expect'))
          server.emit('proxyReq', proxyReq, req, res, options);
      });
      // allow outgoing socket to timeout so that we could
      // show an error page at the initial request
      if (options.proxyTimeout)
        proxyReq.setTimeout(options.proxyTimeout, function () {
          proxyReq.abort();
        });
      // Ensure we abort proxy if request is aborted
      req.on('aborted', function () {
        proxyReq.abort();
      });
      // handle errors in proxy and incoming request, just like for forward proxy
      var proxyError = createErrorHandler(proxyReq, options.target);
      req.on('error', proxyError);
      proxyReq.on('error', proxyError);
      function createErrorHandler(proxyReq, url) {
        return function proxyError(err) {
          if (req.socket.destroyed && err.code === 'ECONNRESET') {
            server.emit('econnreset', err, req, res, url);
            return proxyReq.abort();
          }
          if (clb) clb(err, req, res, url);
          else server.emit('error', err, req, res, url);
        };
      }
      (options.buffer || req).pipe(proxyReq);
      proxyReq.on('response', function (proxyRes) {
        if (server) server.emit('proxyRes', proxyRes, req, res);
        if (!res.headersSent && !options.selfHandleResponse)
          for (var i = 0; i < $c80f1c04525be956$require$web_o.length; i++) {
            if ($c80f1c04525be956$require$web_o[i](req, res, proxyRes, options))
              break;
          }
        if (!res.finished) {
          // Allow us to listen when the proxy has completed
          proxyRes.on('end', function () {
            if (server) server.emit('end', req, res, proxyRes);
          });
          // We pipe to the response unless its expected to be handled by the user
          if (!options.selfHandleResponse) proxyRes.pipe(res);
        } else if (server) server.emit('end', req, res, proxyRes);
      });
    },
  };
});
parcelRegister('bwLp6', function (module, exports) {
  var $lP3ge = parcelRequire('lP3ge');
  var $864774501299115a$var$redirectRegex = /^201|30(1|2|7|8)$/;
  /*!
   * Array of passes.
   *
   * A `pass` is just a function that is executed on `req, res, options`
   * so that you can easily add new checks while still keeping the base
   * flexible.
   */ module.exports = {
    /**
     * If is a HTTP 1.0 request, remove chunk headers
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {proxyResponse} Res Response object from the proxy request
     *
     * @api private
     */ removeChunked: function removeChunked(req, res, proxyRes) {
      if (req.httpVersion === '1.0')
        delete proxyRes.headers['transfer-encoding'];
    },
    /**
     * If is a HTTP 1.0 request, set the correct connection header
     * or if connection header not present, then use `keep-alive`
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {proxyResponse} Res Response object from the proxy request
     *
     * @api private
     */ setConnection: function setConnection(req, res, proxyRes) {
      if (req.httpVersion === '1.0')
        proxyRes.headers.connection = req.headers.connection || 'close';
      else if (req.httpVersion !== '2.0' && !proxyRes.headers.connection)
        proxyRes.headers.connection = req.headers.connection || 'keep-alive';
    },
    setRedirectHostRewrite: function setRedirectHostRewrite(
      req,
      res,
      proxyRes,
      options,
    ) {
      if (
        (options.hostRewrite ||
          options.autoRewrite ||
          options.protocolRewrite) &&
        proxyRes.headers['location'] &&
        $864774501299115a$var$redirectRegex.test(proxyRes.statusCode)
      ) {
        var target = $dmXIQ$url.parse(options.target);
        var u = $dmXIQ$url.parse(proxyRes.headers['location']);
        // make sure the redirected host matches the target host before rewriting
        if (target.host != u.host) return;
        if (options.hostRewrite) u.host = options.hostRewrite;
        else if (options.autoRewrite) u.host = req.headers['host'];
        if (options.protocolRewrite) u.protocol = options.protocolRewrite;
        proxyRes.headers['location'] = u.format();
      }
    },
    /**
     * Copy headers from proxyResponse to response
     * set each header in response object.
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {proxyResponse} Res Response object from the proxy request
     * @param {Object} Options options.cookieDomainRewrite: Config to rewrite cookie domain
     *
     * @api private
     */ writeHeaders: function writeHeaders(req, res, proxyRes, options) {
      var rewriteCookieDomainConfig = options.cookieDomainRewrite,
        rewriteCookiePathConfig = options.cookiePathRewrite,
        preserveHeaderKeyCase = options.preserveHeaderKeyCase,
        rawHeaderKeyMap,
        setHeader = function (key, header) {
          if (header == undefined) return;
          if (rewriteCookieDomainConfig && key.toLowerCase() === 'set-cookie')
            header = $lP3ge.rewriteCookieProperty(
              header,
              rewriteCookieDomainConfig,
              'domain',
            );
          if (rewriteCookiePathConfig && key.toLowerCase() === 'set-cookie')
            header = $lP3ge.rewriteCookieProperty(
              header,
              rewriteCookiePathConfig,
              'path',
            );
          res.setHeader(String(key).trim(), header);
        };
      if (typeof rewriteCookieDomainConfig === 'string')
        rewriteCookieDomainConfig = {
          '*': rewriteCookieDomainConfig,
        };
      if (typeof rewriteCookiePathConfig === 'string')
        rewriteCookiePathConfig = {
          '*': rewriteCookiePathConfig,
        };
      // message.rawHeaders is added in: v0.11.6
      // https://nodejs.org/api/http.html#http_message_rawheaders
      if (preserveHeaderKeyCase && proxyRes.rawHeaders != undefined) {
        rawHeaderKeyMap = {};
        for (var i = 0; i < proxyRes.rawHeaders.length; i += 2) {
          var key = proxyRes.rawHeaders[i];
          rawHeaderKeyMap[key.toLowerCase()] = key;
        }
      }
      Object.keys(proxyRes.headers).forEach(function (key) {
        var header = proxyRes.headers[key];
        if (preserveHeaderKeyCase && rawHeaderKeyMap)
          key = rawHeaderKeyMap[key] || key;
        setHeader(key, header);
      });
    },
    /**
     * Set the statusCode from the proxyResponse
     *
     * @param {ClientRequest} Req Request object
     * @param {IncomingMessage} Res Response object
     * @param {proxyResponse} Res Response object from the proxy request
     *
     * @api private
     */ writeStatusCode: function writeStatusCode(req, res, proxyRes) {
      // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
      if (proxyRes.statusMessage) {
        res.statusCode = proxyRes.statusCode;
        res.statusMessage = proxyRes.statusMessage;
      } else res.statusCode = proxyRes.statusCode;
    },
  };
});
parcelRegister('lP3ge', function (module, exports) {
  var $fe30e3f180614c0c$var$common = module.exports;

  var $fe30e3f180614c0c$require$extend = $dmXIQ$util._extend;

  var $eYhgv = parcelRequire('eYhgv');
  var $fe30e3f180614c0c$var$upgradeHeader = /(^|,)\s*upgrade\s*($|,)/i,
    $fe30e3f180614c0c$var$isSSL = /^https|wss/;
  /**
   * Simple Regex for testing if protocol is https
   */ $fe30e3f180614c0c$var$common.isSSL = $fe30e3f180614c0c$var$isSSL;
  /**
   * Copies the right headers from `options` and `req` to
   * `outgoing` which is then used to fire the proxied
   * request.
   *
   * Examples:
   *
   *    common.setupOutgoing(outgoing, options, req)
   *    // => { host: ..., hostname: ...}
   *
   * @param {Object} Outgoing Base object to be filled with required properties
   * @param {Object} Options Config object passed to the proxy
   * @param {ClientRequest} Req Request Object
   * @param {String} Forward String to select forward or target
   *
   * @return {Object} Outgoing Object with all required properties set
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.setupOutgoing = function (
    outgoing,
    options,
    req,
    forward,
  ) {
    outgoing.port =
      options[forward || 'target'].port ||
      ($fe30e3f180614c0c$var$isSSL.test(options[forward || 'target'].protocol)
        ? 443
        : 80);
    [
      'host',
      'hostname',
      'socketPath',
      'pfx',
      'key',
      'passphrase',
      'cert',
      'ca',
      'ciphers',
      'secureProtocol',
    ].forEach(function (e) {
      outgoing[e] = options[forward || 'target'][e];
    });
    outgoing.method = options.method || req.method;
    outgoing.headers = $fe30e3f180614c0c$require$extend({}, req.headers);
    if (options.headers)
      $fe30e3f180614c0c$require$extend(outgoing.headers, options.headers);
    if (options.auth) outgoing.auth = options.auth;
    if (options.ca) outgoing.ca = options.ca;
    if ($fe30e3f180614c0c$var$isSSL.test(options[forward || 'target'].protocol))
      outgoing.rejectUnauthorized =
        typeof options.secure === 'undefined' ? true : options.secure;
    outgoing.agent = options.agent || false;
    outgoing.localAddress = options.localAddress;
    //
    // Remark: If we are false and not upgrading, set the connection: close. This is the right thing to do
    // as node core doesn't handle this COMPLETELY properly yet.
    //
    if (!outgoing.agent) {
      outgoing.headers = outgoing.headers || {};
      if (
        typeof outgoing.headers.connection !== 'string' ||
        !$fe30e3f180614c0c$var$upgradeHeader.test(outgoing.headers.connection)
      )
        outgoing.headers.connection = 'close';
    }
    // the final path is target path + relative path requested by user:
    var target = options[forward || 'target'];
    var targetPath =
      target && options.prependPath !== false ? target.path || '' : '';
    //
    // Remark: Can we somehow not use url.parse as a perf optimization?
    //
    var outgoingPath = !options.toProxy
      ? $dmXIQ$url.parse(req.url).path || ''
      : req.url;
    //
    // Remark: ignorePath will just straight up ignore whatever the request's
    // path is. This can be labeled as FOOT-GUN material if you do not know what
    // you are doing and are using conflicting options.
    //
    outgoingPath = !options.ignorePath ? outgoingPath : '';
    outgoing.path = $fe30e3f180614c0c$var$common.urlJoin(
      targetPath,
      outgoingPath,
    );
    if (options.changeOrigin)
      outgoing.headers.host =
        $eYhgv(outgoing.port, options[forward || 'target'].protocol) &&
        !$fe30e3f180614c0c$var$hasPort(outgoing.host)
          ? outgoing.host + ':' + outgoing.port
          : outgoing.host;
    return outgoing;
  };
  /**
   * Set the proper configuration for sockets,
   * set no delay and set keep alive, also set
   * the timeout to 0.
   *
   * Examples:
   *
   *    common.setupSocket(socket)
   *    // => Socket
   *
   * @param {Socket} Socket instance to setup
   *
   * @return {Socket} Return the configured socket.
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.setupSocket = function (socket) {
    socket.setTimeout(0);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 0);
    return socket;
  };
  /**
   * Get the port number from the host. Or guess it based on the connection type.
   *
   * @param {Request} req Incoming HTTP request.
   *
   * @return {String} The port number.
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.getPort = function (req) {
    var res = req.headers.host ? req.headers.host.match(/:(\d+)/) : '';
    return res
      ? res[1]
      : $fe30e3f180614c0c$var$common.hasEncryptedConnection(req)
      ? '443'
      : '80';
  };
  /**
   * Check if the request has an encrypted connection.
   *
   * @param {Request} req Incoming HTTP request.
   *
   * @return {Boolean} Whether the connection is encrypted or not.
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.hasEncryptedConnection = function (req) {
    return Boolean(req.connection.encrypted || req.connection.pair);
  };
  /**
   * OS-agnostic join (doesn't break on URLs like path.join does on Windows)>
   *
   * @return {String} The generated path.
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.urlJoin = function () {
    //
    // We do not want to mess with the query string. All we want to touch is the path.
    //
    var args = Array.prototype.slice.call(arguments),
      lastIndex = args.length - 1,
      last = args[lastIndex],
      lastSegs = last.split('?'),
      retSegs;
    args[lastIndex] = lastSegs.shift();
    //
    // Join all strings, but remove empty strings so we don't get extra slashes from
    // joining e.g. ['', 'am']
    //
    retSegs = [
      args
        .filter(Boolean)
        .join('/')
        .replace(/\/+/g, '/')
        .replace('http:/', 'http://')
        .replace('https:/', 'https://'),
    ];
    // Only join the query string if it exists so we don't have trailing a '?'
    // on every request
    // Handle case where there could be multiple ? in the URL.
    retSegs.push.apply(retSegs, lastSegs);
    return retSegs.join('?');
  };
  /**
   * Rewrites or removes the domain of a cookie header
   *
   * @param {String|Array} Header
   * @param {Object} Config, mapping of domain to rewritten domain.
   *                 '*' key to match any domain, null value to remove the domain.
   *
   * @api private
   */ $fe30e3f180614c0c$var$common.rewriteCookieProperty =
    function rewriteCookieProperty(header, config, property) {
      if (Array.isArray(header))
        return header.map(function (headerElement) {
          return rewriteCookieProperty(headerElement, config, property);
        });
      return header.replace(
        new RegExp('(;\\s*' + property + '=)([^;]+)', 'i'),
        function (match, prefix, previousValue) {
          var newValue;
          if (previousValue in config) newValue = config[previousValue];
          else if ('*' in config) newValue = config['*'];
          //no match, return previous value
          else return match;
          if (newValue)
            //replace value
            return prefix + newValue;
          //remove value
          else return '';
        },
      );
    };
  /**
   * Check the host and see if it potentially has a port in it (keep it simple)
   *
   * @returns {Boolean} Whether we have one or not
   *
   * @api private
   */ function $fe30e3f180614c0c$var$hasPort(host) {
    return !!~host.indexOf(':');
  }
});
parcelRegister('eYhgv', function (module, exports) {
  'use strict';
  /**
   * Check if we're required to add a port number.
   *
   * @see https://url.spec.whatwg.org/#default-port
   * @param {Number|String} port Port number we need to check
   * @param {String} protocol Protocol we need to check against.
   * @returns {Boolean} Is it a default port for the given protocol
   * @api private
   */ module.exports = function required(port, protocol) {
    protocol = protocol.split(':')[0];
    port = +port;
    if (!port) return false;
    switch (protocol) {
      case 'http':
      case 'ws':
        return port !== 80;
      case 'https':
      case 'wss':
        return port !== 443;
      case 'ftp':
        return port !== 21;
      case 'gopher':
        return port !== 70;
      case 'file':
        return false;
    }
    return port !== 0;
  };
});

parcelRegister('cRyUo', function (module, exports) {
  var $95d583622e74143b$var$URL = $dmXIQ$url.URL;

  var $95d583622e74143b$require$Writable = $dmXIQ$stream.Writable;

  var $9b5EA = parcelRequire('9b5EA');
  // Whether to use the native URL object or the legacy url module
  var $95d583622e74143b$var$useNativeURL = false;
  try {
    $dmXIQ$assert(new $95d583622e74143b$var$URL());
  } catch (error) {
    $95d583622e74143b$var$useNativeURL = error.code === 'ERR_INVALID_URL';
  }
  // URL fields to preserve in copy operations
  var $95d583622e74143b$var$preservedUrlFields = [
    'auth',
    'host',
    'hostname',
    'href',
    'path',
    'pathname',
    'port',
    'protocol',
    'query',
    'search',
  ];
  // Create handlers that pass events from native requests
  var $95d583622e74143b$var$events = [
    'abort',
    'aborted',
    'connect',
    'error',
    'socket',
    'timeout',
  ];
  var $95d583622e74143b$var$eventHandlers = Object.create(null);
  $95d583622e74143b$var$events.forEach(function (event) {
    $95d583622e74143b$var$eventHandlers[event] = function (arg1, arg2, arg3) {
      this._redirectable.emit(event, arg1, arg2, arg3);
    };
  });
  // Error types with codes
  var $95d583622e74143b$var$InvalidUrlError =
    $95d583622e74143b$var$createErrorType(
      'ERR_INVALID_URL',
      'Invalid URL',
      TypeError,
    );
  var $95d583622e74143b$var$RedirectionError =
    $95d583622e74143b$var$createErrorType(
      'ERR_FR_REDIRECTION_FAILURE',
      'Redirected request failed',
    );
  var $95d583622e74143b$var$TooManyRedirectsError =
    $95d583622e74143b$var$createErrorType(
      'ERR_FR_TOO_MANY_REDIRECTS',
      'Maximum number of redirects exceeded',
      $95d583622e74143b$var$RedirectionError,
    );
  var $95d583622e74143b$var$MaxBodyLengthExceededError =
    $95d583622e74143b$var$createErrorType(
      'ERR_FR_MAX_BODY_LENGTH_EXCEEDED',
      'Request body larger than maxBodyLength limit',
    );
  var $95d583622e74143b$var$WriteAfterEndError =
    $95d583622e74143b$var$createErrorType(
      'ERR_STREAM_WRITE_AFTER_END',
      'write after end',
    );
  // istanbul ignore next
  var $95d583622e74143b$var$destroy =
    $95d583622e74143b$require$Writable.prototype.destroy ||
    $95d583622e74143b$var$noop;
  // An HTTP(S) request that can be redirected
  function $95d583622e74143b$var$RedirectableRequest(
    options,
    responseCallback,
  ) {
    // Initialize the request
    $95d583622e74143b$require$Writable.call(this);
    this._sanitizeOptions(options);
    this._options = options;
    this._ended = false;
    this._ending = false;
    this._redirectCount = 0;
    this._redirects = [];
    this._requestBodyLength = 0;
    this._requestBodyBuffers = [];
    // Attach a callback if passed
    if (responseCallback) this.on('response', responseCallback);
    // React to responses of native requests
    var self = this;
    this._onNativeResponse = function (response) {
      try {
        self._processResponse(response);
      } catch (cause) {
        self.emit(
          'error',
          cause instanceof $95d583622e74143b$var$RedirectionError
            ? cause
            : new $95d583622e74143b$var$RedirectionError({
                cause: cause,
              }),
        );
      }
    };
    // Perform the first request
    this._performRequest();
  }
  $95d583622e74143b$var$RedirectableRequest.prototype = Object.create(
    $95d583622e74143b$require$Writable.prototype,
  );
  $95d583622e74143b$var$RedirectableRequest.prototype.abort = function () {
    $95d583622e74143b$var$destroyRequest(this._currentRequest);
    this._currentRequest.abort();
    this.emit('abort');
  };
  $95d583622e74143b$var$RedirectableRequest.prototype.destroy = function (
    error,
  ) {
    $95d583622e74143b$var$destroyRequest(this._currentRequest, error);
    $95d583622e74143b$var$destroy.call(this, error);
    return this;
  };
  // Writes buffered data to the current native request
  $95d583622e74143b$var$RedirectableRequest.prototype.write = function (
    data,
    encoding,
    callback,
  ) {
    // Writing is not allowed if end has been called
    if (this._ending) throw new $95d583622e74143b$var$WriteAfterEndError();
    // Validate input and shift parameters if necessary
    if (
      !$95d583622e74143b$var$isString(data) &&
      !$95d583622e74143b$var$isBuffer(data)
    )
      throw new TypeError('data should be a string, Buffer or Uint8Array');
    if ($95d583622e74143b$var$isFunction(encoding)) {
      callback = encoding;
      encoding = null;
    }
    // Ignore empty buffers, since writing them doesn't invoke the callback
    // https://github.com/nodejs/node/issues/22066
    if (data.length === 0) {
      if (callback) callback();
      return;
    }
    // Only write when we don't exceed the maximum body length
    if (this._requestBodyLength + data.length <= this._options.maxBodyLength) {
      this._requestBodyLength += data.length;
      this._requestBodyBuffers.push({
        data: data,
        encoding: encoding,
      });
      this._currentRequest.write(data, encoding, callback);
    } else {
      this.emit(
        'error',
        new $95d583622e74143b$var$MaxBodyLengthExceededError(),
      );
      this.abort();
    }
  };
  // Ends the current native request
  $95d583622e74143b$var$RedirectableRequest.prototype.end = function (
    data,
    encoding,
    callback,
  ) {
    // Shift parameters if necessary
    if ($95d583622e74143b$var$isFunction(data)) {
      callback = data;
      data = encoding = null;
    } else if ($95d583622e74143b$var$isFunction(encoding)) {
      callback = encoding;
      encoding = null;
    }
    // Write data if needed and end
    if (!data) {
      this._ended = this._ending = true;
      this._currentRequest.end(null, null, callback);
    } else {
      var self = this;
      var currentRequest = this._currentRequest;
      this.write(data, encoding, function () {
        self._ended = true;
        currentRequest.end(null, null, callback);
      });
      this._ending = true;
    }
  };
  // Sets a header value on the current native request
  $95d583622e74143b$var$RedirectableRequest.prototype.setHeader = function (
    name,
    value,
  ) {
    this._options.headers[name] = value;
    this._currentRequest.setHeader(name, value);
  };
  // Clears a header value on the current native request
  $95d583622e74143b$var$RedirectableRequest.prototype.removeHeader = function (
    name,
  ) {
    delete this._options.headers[name];
    this._currentRequest.removeHeader(name);
  };
  // Global timeout for all underlying requests
  $95d583622e74143b$var$RedirectableRequest.prototype.setTimeout = function (
    msecs,
    callback,
  ) {
    var self = this;
    // Destroys the socket on timeout
    function destroyOnTimeout(socket) {
      socket.setTimeout(msecs);
      socket.removeListener('timeout', socket.destroy);
      socket.addListener('timeout', socket.destroy);
    }
    // Sets up a timer to trigger a timeout event
    function startTimer(socket) {
      if (self._timeout) clearTimeout(self._timeout);
      self._timeout = setTimeout(function () {
        self.emit('timeout');
        clearTimer();
      }, msecs);
      destroyOnTimeout(socket);
    }
    // Stops a timeout from triggering
    function clearTimer() {
      // Clear the timeout
      if (self._timeout) {
        clearTimeout(self._timeout);
        self._timeout = null;
      }
      // Clean up all attached listeners
      self.removeListener('abort', clearTimer);
      self.removeListener('error', clearTimer);
      self.removeListener('response', clearTimer);
      self.removeListener('close', clearTimer);
      if (callback) self.removeListener('timeout', callback);
      if (!self.socket)
        self._currentRequest.removeListener('socket', startTimer);
    }
    // Attach callback if passed
    if (callback) this.on('timeout', callback);
    // Start the timer if or when the socket is opened
    if (this.socket) startTimer(this.socket);
    else this._currentRequest.once('socket', startTimer);
    // Clean up on events
    this.on('socket', destroyOnTimeout);
    this.on('abort', clearTimer);
    this.on('error', clearTimer);
    this.on('response', clearTimer);
    this.on('close', clearTimer);
    return this;
  };
  // Proxy all other public ClientRequest methods
  ['flushHeaders', 'getHeader', 'setNoDelay', 'setSocketKeepAlive'].forEach(
    function (method) {
      $95d583622e74143b$var$RedirectableRequest.prototype[method] = function (
        a,
        b,
      ) {
        return this._currentRequest[method](a, b);
      };
    },
  );
  // Proxy all public ClientRequest properties
  ['aborted', 'connection', 'socket'].forEach(function (property) {
    Object.defineProperty(
      $95d583622e74143b$var$RedirectableRequest.prototype,
      property,
      {
        get: function () {
          return this._currentRequest[property];
        },
      },
    );
  });
  $95d583622e74143b$var$RedirectableRequest.prototype._sanitizeOptions =
    function (options) {
      // Ensure headers are always present
      if (!options.headers) options.headers = {};
      // Since http.request treats host as an alias of hostname,
      // but the url module interprets host as hostname plus port,
      // eliminate the host property to avoid confusion.
      if (options.host) {
        // Use hostname if set, because it has precedence
        if (!options.hostname) options.hostname = options.host;
        delete options.host;
      }
      // Complete the URL object when necessary
      if (!options.pathname && options.path) {
        var searchPos = options.path.indexOf('?');
        if (searchPos < 0) options.pathname = options.path;
        else {
          options.pathname = options.path.substring(0, searchPos);
          options.search = options.path.substring(searchPos);
        }
      }
    };
  // Executes the next native request (initial or redirect)
  $95d583622e74143b$var$RedirectableRequest.prototype._performRequest =
    function () {
      // Load the native protocol
      var protocol = this._options.protocol;
      var nativeProtocol = this._options.nativeProtocols[protocol];
      if (!nativeProtocol)
        throw new TypeError('Unsupported protocol ' + protocol);
      // If specified, use the agent corresponding to the protocol
      // (HTTP and HTTPS use different types of agents)
      if (this._options.agents) {
        var scheme = protocol.slice(0, -1);
        this._options.agent = this._options.agents[scheme];
      }
      // Create the native request and set up its event handlers
      var request = (this._currentRequest = nativeProtocol.request(
        this._options,
        this._onNativeResponse,
      ));
      request._redirectable = this;
      for (var event of $95d583622e74143b$var$events)
        request.on(event, $95d583622e74143b$var$eventHandlers[event]);
      // RFC7230§5.3.1: When making a request directly to an origin server, […]
      // a client MUST send only the absolute path […] as the request-target.
      this._currentUrl = /^\//.test(this._options.path)
        ? $dmXIQ$url.format(this._options) // When making a request to a proxy, […]
        : // a client MUST send the target URI in absolute-form […].
          this._options.path;
      // End a redirected request
      // (The first request must be ended explicitly with RedirectableRequest#end)
      if (this._isRedirect) {
        // Write the request entity and end
        var i = 0;
        var self = this;
        var buffers = this._requestBodyBuffers;
        (function writeNext(error) {
          // Only write if this request has not been redirected yet
          /* istanbul ignore else */ if (request === self._currentRequest) {
            // Report any write errors
            /* istanbul ignore if */ if (error) self.emit('error', error);
            else if (i < buffers.length) {
              var buffer = buffers[i++];
              /* istanbul ignore else */ if (!request.finished)
                request.write(buffer.data, buffer.encoding, writeNext);
            } else if (self._ended) request.end();
          }
        })();
      }
    };
  // Processes a response from the current native request
  $95d583622e74143b$var$RedirectableRequest.prototype._processResponse =
    function (response) {
      // Store the redirected response
      var statusCode = response.statusCode;
      if (this._options.trackRedirects)
        this._redirects.push({
          url: this._currentUrl,
          headers: response.headers,
          statusCode: statusCode,
        });
      // RFC7231§6.4: The 3xx (Redirection) class of status code indicates
      // that further action needs to be taken by the user agent in order to
      // fulfill the request. If a Location header field is provided,
      // the user agent MAY automatically redirect its request to the URI
      // referenced by the Location field value,
      // even if the specific status code is not understood.
      // If the response is not a redirect; return it as-is
      var location = response.headers.location;
      if (
        !location ||
        this._options.followRedirects === false ||
        statusCode < 300 ||
        statusCode >= 400
      ) {
        response.responseUrl = this._currentUrl;
        response.redirects = this._redirects;
        this.emit('response', response);
        // Clean up
        this._requestBodyBuffers = [];
        return;
      }
      // The response is a redirect, so abort the current request
      $95d583622e74143b$var$destroyRequest(this._currentRequest);
      // Discard the remainder of the response to avoid waiting for data
      response.destroy();
      // RFC7231§6.4: A client SHOULD detect and intervene
      // in cyclical redirections (i.e., "infinite" redirection loops).
      if (++this._redirectCount > this._options.maxRedirects)
        throw new $95d583622e74143b$var$TooManyRedirectsError();
      // Store the request headers if applicable
      var requestHeaders;
      var beforeRedirect = this._options.beforeRedirect;
      if (beforeRedirect)
        requestHeaders = Object.assign(
          {
            // The Host header was set by nativeProtocol.request
            Host: response.req.getHeader('host'),
          },
          this._options.headers,
        );
      // RFC7231§6.4: Automatic redirection needs to done with
      // care for methods not known to be safe, […]
      // RFC7231§6.4.2–3: For historical reasons, a user agent MAY change
      // the request method from POST to GET for the subsequent request.
      var method = this._options.method;
      if (
        ((statusCode === 301 || statusCode === 302) &&
          this._options.method === 'POST') || // RFC7231§6.4.4: The 303 (See Other) status code indicates that
        // the server is redirecting the user agent to a different resource […]
        // A user agent can perform a retrieval request targeting that URI
        // (a GET or HEAD request if using HTTP) […]
        (statusCode === 303 && !/^(?:GET|HEAD)$/.test(this._options.method))
      ) {
        this._options.method = 'GET';
        // Drop a possible entity and headers related to it
        this._requestBodyBuffers = [];
        $95d583622e74143b$var$removeMatchingHeaders(
          /^content-/i,
          this._options.headers,
        );
      }
      // Drop the Host header, as the redirect might lead to a different host
      var currentHostHeader = $95d583622e74143b$var$removeMatchingHeaders(
        /^host$/i,
        this._options.headers,
      );
      // If the redirect is relative, carry over the host of the last request
      var currentUrlParts = $95d583622e74143b$var$parseUrl(this._currentUrl);
      var currentHost = currentHostHeader || currentUrlParts.host;
      var currentUrl = /^\w+:/.test(location)
        ? this._currentUrl
        : $dmXIQ$url.format(
            Object.assign(currentUrlParts, {
              host: currentHost,
            }),
          );
      // Create the redirected request
      var redirectUrl = $95d583622e74143b$var$resolveUrl(location, currentUrl);
      $9b5EA('redirecting to', redirectUrl.href);
      this._isRedirect = true;
      $95d583622e74143b$var$spreadUrlObject(redirectUrl, this._options);
      // Drop confidential headers when redirecting to a less secure protocol
      // or to a different domain that is not a superdomain
      if (
        (redirectUrl.protocol !== currentUrlParts.protocol &&
          redirectUrl.protocol !== 'https:') ||
        (redirectUrl.host !== currentHost &&
          !$95d583622e74143b$var$isSubdomain(redirectUrl.host, currentHost))
      )
        $95d583622e74143b$var$removeMatchingHeaders(
          /^(?:authorization|cookie)$/i,
          this._options.headers,
        );
      // Evaluate the beforeRedirect callback
      if ($95d583622e74143b$var$isFunction(beforeRedirect)) {
        var responseDetails = {
          headers: response.headers,
          statusCode: statusCode,
        };
        var requestDetails = {
          url: currentUrl,
          method: method,
          headers: requestHeaders,
        };
        beforeRedirect(this._options, responseDetails, requestDetails);
        this._sanitizeOptions(this._options);
      }
      // Perform the redirected request
      this._performRequest();
    };
  // Wraps the key/value object of protocols with redirect functionality
  function $95d583622e74143b$var$wrap(protocols) {
    // Default settings
    var exports = {
      maxRedirects: 21,
      maxBodyLength: 10485760,
    };
    // Wrap each protocol
    var nativeProtocols = {};
    Object.keys(protocols).forEach(function (scheme) {
      var protocol = scheme + ':';
      var nativeProtocol = (nativeProtocols[protocol] = protocols[scheme]);
      var wrappedProtocol = (exports[scheme] = Object.create(nativeProtocol));
      // Executes a request, following redirects
      function request(input, options, callback) {
        // Parse parameters, ensuring that input is an object
        if ($95d583622e74143b$var$isURL(input))
          input = $95d583622e74143b$var$spreadUrlObject(input);
        else if ($95d583622e74143b$var$isString(input))
          input = $95d583622e74143b$var$spreadUrlObject(
            $95d583622e74143b$var$parseUrl(input),
          );
        else {
          callback = options;
          options = $95d583622e74143b$var$validateUrl(input);
          input = {
            protocol: protocol,
          };
        }
        if ($95d583622e74143b$var$isFunction(options)) {
          callback = options;
          options = null;
        }
        // Set defaults
        options = Object.assign(
          {
            maxRedirects: exports.maxRedirects,
            maxBodyLength: exports.maxBodyLength,
          },
          input,
          options,
        );
        options.nativeProtocols = nativeProtocols;
        if (
          !$95d583622e74143b$var$isString(options.host) &&
          !$95d583622e74143b$var$isString(options.hostname)
        )
          options.hostname = '::1';
        $dmXIQ$assert.equal(options.protocol, protocol, 'protocol mismatch');
        $9b5EA('options', options);
        return new $95d583622e74143b$var$RedirectableRequest(options, callback);
      }
      // Executes a GET request, following redirects
      function get(input, options, callback) {
        var wrappedRequest = wrappedProtocol.request(input, options, callback);
        wrappedRequest.end();
        return wrappedRequest;
      }
      // Expose the properties on the wrapped protocol
      Object.defineProperties(wrappedProtocol, {
        request: {
          value: request,
          configurable: true,
          enumerable: true,
          writable: true,
        },
        get: {
          value: get,
          configurable: true,
          enumerable: true,
          writable: true,
        },
      });
    });
    return exports;
  }
  function $95d583622e74143b$var$noop() {}
  function $95d583622e74143b$var$parseUrl(input) {
    var parsed;
    /* istanbul ignore else */ if ($95d583622e74143b$var$useNativeURL)
      parsed = new $95d583622e74143b$var$URL(input);
    else {
      // Ensure the URL is valid and absolute
      parsed = $95d583622e74143b$var$validateUrl($dmXIQ$url.parse(input));
      if (!$95d583622e74143b$var$isString(parsed.protocol))
        throw new $95d583622e74143b$var$InvalidUrlError({
          input: input,
        });
    }
    return parsed;
  }
  function $95d583622e74143b$var$resolveUrl(relative, base) {
    /* istanbul ignore next */ return $95d583622e74143b$var$useNativeURL
      ? new $95d583622e74143b$var$URL(relative, base)
      : $95d583622e74143b$var$parseUrl($dmXIQ$url.resolve(base, relative));
  }
  function $95d583622e74143b$var$validateUrl(input) {
    if (/^\[/.test(input.hostname) && !/^\[[:0-9a-f]+\]$/i.test(input.hostname))
      throw new $95d583622e74143b$var$InvalidUrlError({
        input: input.href || input,
      });
    if (/^\[/.test(input.host) && !/^\[[:0-9a-f]+\](:\d+)?$/i.test(input.host))
      throw new $95d583622e74143b$var$InvalidUrlError({
        input: input.href || input,
      });
    return input;
  }
  function $95d583622e74143b$var$spreadUrlObject(urlObject, target) {
    var spread = target || {};
    for (var key of $95d583622e74143b$var$preservedUrlFields)
      spread[key] = urlObject[key];
    // Fix IPv6 hostname
    if (spread.hostname.startsWith('['))
      spread.hostname = spread.hostname.slice(1, -1);
    // Ensure port is a number
    if (spread.port !== '') spread.port = Number(spread.port);
    // Concatenate path
    spread.path = spread.search
      ? spread.pathname + spread.search
      : spread.pathname;
    return spread;
  }
  function $95d583622e74143b$var$removeMatchingHeaders(regex, headers) {
    var lastValue;
    for (var header in headers)
      if (regex.test(header)) {
        lastValue = headers[header];
        delete headers[header];
      }
    return lastValue === null || typeof lastValue === 'undefined'
      ? undefined
      : String(lastValue).trim();
  }
  function $95d583622e74143b$var$createErrorType(code, message, baseClass) {
    // Create constructor
    function CustomError(properties) {
      Error.captureStackTrace(this, this.constructor);
      Object.assign(this, properties || {});
      this.code = code;
      this.message = this.cause ? message + ': ' + this.cause.message : message;
    }
    // Attach constructor and set default properties
    CustomError.prototype = new (baseClass || Error)();
    Object.defineProperties(CustomError.prototype, {
      constructor: {
        value: CustomError,
        enumerable: false,
      },
      name: {
        value: 'Error [' + code + ']',
        enumerable: false,
      },
    });
    return CustomError;
  }
  function $95d583622e74143b$var$destroyRequest(request, error) {
    for (var event of $95d583622e74143b$var$events)
      request.removeListener(event, $95d583622e74143b$var$eventHandlers[event]);
    request.on('error', $95d583622e74143b$var$noop);
    request.destroy(error);
  }
  function $95d583622e74143b$var$isSubdomain(subdomain, domain) {
    $dmXIQ$assert(
      $95d583622e74143b$var$isString(subdomain) &&
        $95d583622e74143b$var$isString(domain),
    );
    var dot = subdomain.length - domain.length - 1;
    return dot > 0 && subdomain[dot] === '.' && subdomain.endsWith(domain);
  }
  function $95d583622e74143b$var$isString(value) {
    return typeof value === 'string' || value instanceof String;
  }
  function $95d583622e74143b$var$isFunction(value) {
    return typeof value === 'function';
  }
  function $95d583622e74143b$var$isBuffer(value) {
    return typeof value === 'object' && 'length' in value;
  }
  function $95d583622e74143b$var$isURL(value) {
    return (
      $95d583622e74143b$var$URL && value instanceof $95d583622e74143b$var$URL
    );
  }
  // Exports
  module.exports = $95d583622e74143b$var$wrap({
    http: $dmXIQ$http,
    https: $dmXIQ$https,
  });
  module.exports.wrap = $95d583622e74143b$var$wrap;
});
parcelRegister('9b5EA', function (module, exports) {
  var $6ae986d3472d1017$var$debug;

  module.exports = function () {
    if (!$6ae986d3472d1017$var$debug) {
      try {
        /* eslint global-require: off */ $6ae986d3472d1017$var$debug =
          parcelRequire('auPB5')('follow-redirects');
      } catch (error) {}
      if (typeof $6ae986d3472d1017$var$debug !== 'function')
        $6ae986d3472d1017$var$debug = function () {};
    }
    $6ae986d3472d1017$var$debug.apply(null, arguments);
  };
});
parcelRegister('auPB5', function (module, exports) {
  /**
   * Detect Electron renderer / nwjs process, which is node, but we should
   * treat as a browser.
   */

  if (
    typeof process === 'undefined' ||
    process.type === 'renderer' ||
    process.browser === true ||
    process.__nwjs
  )
    module.exports = parcelRequire('3kevq');
  else module.exports = parcelRequire('6pqZR');
});
parcelRegister('3kevq', function (module, exports) {
  /* eslint-env browser */ /**
   * This is the web browser implementation of `debug()`.
   */ exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage = localstorage();
  exports.destroy = (() => {
    let warned = false;
    return () => {
      if (!warned) {
        warned = true;
        console.warn(
          'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.',
        );
      }
    };
  })();
  /**
   * Colors.
   */ exports.colors = [
    '#0000CC',
    '#0000FF',
    '#0033CC',
    '#0033FF',
    '#0066CC',
    '#0066FF',
    '#0099CC',
    '#0099FF',
    '#00CC00',
    '#00CC33',
    '#00CC66',
    '#00CC99',
    '#00CCCC',
    '#00CCFF',
    '#3300CC',
    '#3300FF',
    '#3333CC',
    '#3333FF',
    '#3366CC',
    '#3366FF',
    '#3399CC',
    '#3399FF',
    '#33CC00',
    '#33CC33',
    '#33CC66',
    '#33CC99',
    '#33CCCC',
    '#33CCFF',
    '#6600CC',
    '#6600FF',
    '#6633CC',
    '#6633FF',
    '#66CC00',
    '#66CC33',
    '#9900CC',
    '#9900FF',
    '#9933CC',
    '#9933FF',
    '#99CC00',
    '#99CC33',
    '#CC0000',
    '#CC0033',
    '#CC0066',
    '#CC0099',
    '#CC00CC',
    '#CC00FF',
    '#CC3300',
    '#CC3333',
    '#CC3366',
    '#CC3399',
    '#CC33CC',
    '#CC33FF',
    '#CC6600',
    '#CC6633',
    '#CC9900',
    '#CC9933',
    '#CCCC00',
    '#CCCC33',
    '#FF0000',
    '#FF0033',
    '#FF0066',
    '#FF0099',
    '#FF00CC',
    '#FF00FF',
    '#FF3300',
    '#FF3333',
    '#FF3366',
    '#FF3399',
    '#FF33CC',
    '#FF33FF',
    '#FF6600',
    '#FF6633',
    '#FF9900',
    '#FF9933',
    '#FFCC00',
    '#FFCC33',
  ];
  /**
   * Currently only WebKit-based Web Inspectors, Firefox >= v31,
   * and the Firebug extension (any Firefox version) are known
   * to support "%c" CSS customizations.
   *
   * TODO: add a `localStorage` variable to explicitly enable/disable colors
   */ // eslint-disable-next-line complexity
  function useColors() {
    // NB: In an Electron preload script, document will be defined but not fully
    // initialized. Since we know we're in Chrome, we'll just detect this case
    // explicitly
    if (
      typeof window !== 'undefined' &&
      window.process &&
      (window.process.type === 'renderer' || window.process.__nwjs)
    )
      return true;
    // Internet Explorer and Edge do not support colors.
    if (
      typeof navigator !== 'undefined' &&
      navigator.userAgent &&
      navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)
    )
      return false;
    // Is webkit? http://stackoverflow.com/a/16459606/376773
    // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    return (
      (typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.style &&
        document.documentElement.style.WebkitAppearance) || // Is firebug? http://stackoverflow.com/a/398120/376773
      (typeof window !== 'undefined' &&
        window.console &&
        (window.console.firebug ||
          (window.console.exception && window.console.table))) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) &&
        parseInt(RegExp.$1, 10) >= 31) || // Double check webkit in userAgent just in case we are in a worker
      (typeof navigator !== 'undefined' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/))
    );
  }
  /**
   * Colorize log arguments if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    args[0] =
      (this.useColors ? '%c' : '') +
      this.namespace +
      (this.useColors ? ' %c' : ' ') +
      args[0] +
      (this.useColors ? '%c ' : ' ') +
      '+' +
      module.exports.humanize(this.diff);
    if (!this.useColors) return;
    const c = 'color: ' + this.color;
    args.splice(1, 0, c, 'color: inherit');
    // The final "%c" is somewhat tricky, because there could be other
    // arguments passed either before or after the %c, so we need to
    // figure out the correct index to insert the CSS into
    let index = 0;
    let lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, match => {
      if (match === '%%') return;
      index++;
      if (match === '%c')
        // We only are interested in the *last* %c
        // (the user may have provided their own)
        lastC = index;
    });
    args.splice(lastC, 0, c);
  }
  /**
   * Invokes `console.debug()` when available.
   * No-op when `console.debug` is not a "function".
   * If `console.debug` is not available, falls back
   * to `console.log`.
   *
   * @api public
   */ exports.log = console.debug || console.log || (() => {});
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    try {
      if (namespaces) exports.storage.setItem('debug', namespaces);
      else exports.storage.removeItem('debug');
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    let r;
    try {
      r = exports.storage.getItem('debug');
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
    // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    if (!r && typeof process !== 'undefined' && 'env' in process)
      r = process.env.DEBUG;
    return r;
  }
  /**
   * Localstorage attempts to return the localstorage.
   *
   * This is necessary because safari throws
   * when a user disables cookies/localstorage
   * and you attempt to access it.
   *
   * @return {LocalStorage}
   * @api private
   */ function localstorage() {
    try {
      // TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
      // The Browser also has localStorage in the global context.
      return localStorage;
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
  }

  module.exports = parcelRequire('1B1WT')(exports);
  const {formatters} = module.exports;
  /**
   * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
   */ formatters.j = function (v) {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return '[UnexpectedJSONParseError]: ' + error.message;
    }
  };
});
parcelRegister('1B1WT', function (module, exports) {
  /**
   * This is the common logic for both the Node.js and web browser
   * implementations of `debug()`.
   */
  function $129ac22a0575507e$var$setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = parcelRequire('dPzuK');
    createDebug.destroy = destroy;
    Object.keys(env).forEach(key => {
      createDebug[key] = env[key];
    });
    /**
     * The currently active debug mode names, and names to skip.
     */ createDebug.names = [];
    createDebug.skips = [];
    /**
     * Map of special "%n" handling functions, for the debug "format" argument.
     *
     * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
     */ createDebug.formatters = {};
    /**
     * Selects a color for a debug namespace
     * @param {String} namespace The namespace string for the debug instance to be colored
     * @return {Number|String} An ANSI color code for the given namespace
     * @api private
     */ function selectColor(namespace) {
      let hash = 0;
      for (let i = 0; i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    /**
     * Create a debugger with the given `namespace`.
     *
     * @param {String} namespace
     * @return {Function}
     * @api public
     */ function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug(...args) {
        // Disabled?
        if (!debug.enabled) return;
        const self = debug;
        // Set `diff` timestamp
        const curr = Number(new Date());
        const ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== 'string')
          // Anything else let's inspect with %O
          args.unshift('%O');
        // Apply any `formatters` transformations
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          // If we encounter an escaped % then don't increase the array index
          if (match === '%%') return '%';
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === 'function') {
            const val = args[index];
            match = formatter.call(self, val);
            // Now we need to remove `args[index]` since it's inlined in the `format`
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        // Apply env-specific formatting (colors, etc.)
        createDebug.formatArgs.call(self, args);
        const logFn = self.log || createDebug.log;
        logFn.apply(self, args);
      }
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.
      Object.defineProperty(debug, 'enabled', {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) return enableOverride;
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: v => {
          enableOverride = v;
        },
      });
      // Env-specific initialization logic for debug instances
      if (typeof createDebug.init === 'function') createDebug.init(debug);
      return debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(
        this.namespace +
          (typeof delimiter === 'undefined' ? ':' : delimiter) +
          namespace,
      );
      newDebug.log = this.log;
      return newDebug;
    }
    /**
     * Enables a debug mode by namespaces. This can include modes
     * separated by a colon and wildcards.
     *
     * @param {String} namespaces
     * @api public
     */ function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      let i;
      const split = (typeof namespaces === 'string' ? namespaces : '').split(
        /[\s,]+/,
      );
      const len = split.length;
      for (i = 0; i < len; i++) {
        if (!split[i]) continue;
        namespaces = split[i].replace(/\*/g, '.*?');
        if (namespaces[0] === '-')
          createDebug.skips.push(new RegExp('^' + namespaces.slice(1) + '$'));
        else createDebug.names.push(new RegExp('^' + namespaces + '$'));
      }
    }
    /**
     * Disable debug output.
     *
     * @return {String} namespaces
     * @api public
     */ function disable() {
      const namespaces = [
        ...createDebug.names.map(toNamespace),
        ...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace),
      ].join(',');
      createDebug.enable('');
      return namespaces;
    }
    /**
     * Returns true if the given mode name is enabled, false otherwise.
     *
     * @param {String} name
     * @return {Boolean}
     * @api public
     */ function enabled(name) {
      if (name[name.length - 1] === '*') return true;
      let i;
      let len;
      for (i = 0, len = createDebug.skips.length; i < len; i++) {
        if (createDebug.skips[i].test(name)) return false;
      }
      for (i = 0, len = createDebug.names.length; i < len; i++) {
        if (createDebug.names[i].test(name)) return true;
      }
      return false;
    }
    /**
     * Convert regexp to namespace
     *
     * @param {RegExp} regxep
     * @return {String} namespace
     * @api private
     */ function toNamespace(regexp) {
      return regexp
        .toString()
        .substring(2, regexp.toString().length - 2)
        .replace(/\.\*\?$/, '*');
    }
    /**
     * Coerce `val`.
     *
     * @param {Mixed} val
     * @return {Mixed}
     * @api private
     */ function coerce(val) {
      if (val instanceof Error) return val.stack || val.message;
      return val;
    }
    /**
     * XXX DO NOT USE. This is a temporary stub function.
     * XXX It WILL be removed in the next major release.
     */ function destroy() {
      console.warn(
        'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.',
      );
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  module.exports = $129ac22a0575507e$var$setup;
});
parcelRegister('dPzuK', function (module, exports) {
  /**
   * Helpers.
   */ var $a11b925b74a008af$var$s = 1000;
  var $a11b925b74a008af$var$m = $a11b925b74a008af$var$s * 60;
  var $a11b925b74a008af$var$h = $a11b925b74a008af$var$m * 60;
  var $a11b925b74a008af$var$d = $a11b925b74a008af$var$h * 24;
  var $a11b925b74a008af$var$w = $a11b925b74a008af$var$d * 7;
  var $a11b925b74a008af$var$y = $a11b925b74a008af$var$d * 365.25;
  /**
   * Parse or format the given `val`.
   *
   * Options:
   *
   *  - `long` verbose formatting [false]
   *
   * @param {String|Number} val
   * @param {Object} [options]
   * @throws {Error} throw an error if val is not a non-empty string or a number
   * @return {String|Number}
   * @api public
   */ module.exports = function (val, options) {
    options = options || {};
    var type = typeof val;
    if (type === 'string' && val.length > 0)
      return $a11b925b74a008af$var$parse(val);
    else if (type === 'number' && isFinite(val))
      return options.long
        ? $a11b925b74a008af$var$fmtLong(val)
        : $a11b925b74a008af$var$fmtShort(val);
    throw new Error(
      'val is not a non-empty string or a valid number. val=' +
        JSON.stringify(val),
    );
  };
  /**
   * Parse the given `str` and return milliseconds.
   *
   * @param {String} str
   * @return {Number}
   * @api private
   */ function $a11b925b74a008af$var$parse(str) {
    str = String(str);
    if (str.length > 100) return;
    var match =
      /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str,
      );
    if (!match) return;
    var n = parseFloat(match[1]);
    var type = (match[2] || 'ms').toLowerCase();
    switch (type) {
      case 'years':
      case 'year':
      case 'yrs':
      case 'yr':
      case 'y':
        return n * $a11b925b74a008af$var$y;
      case 'weeks':
      case 'week':
      case 'w':
        return n * $a11b925b74a008af$var$w;
      case 'days':
      case 'day':
      case 'd':
        return n * $a11b925b74a008af$var$d;
      case 'hours':
      case 'hour':
      case 'hrs':
      case 'hr':
      case 'h':
        return n * $a11b925b74a008af$var$h;
      case 'minutes':
      case 'minute':
      case 'mins':
      case 'min':
      case 'm':
        return n * $a11b925b74a008af$var$m;
      case 'seconds':
      case 'second':
      case 'secs':
      case 'sec':
      case 's':
        return n * $a11b925b74a008af$var$s;
      case 'milliseconds':
      case 'millisecond':
      case 'msecs':
      case 'msec':
      case 'ms':
        return n;
      default:
        return undefined;
    }
  }
  /**
   * Short format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $a11b925b74a008af$var$fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= $a11b925b74a008af$var$d)
      return Math.round(ms / $a11b925b74a008af$var$d) + 'd';
    if (msAbs >= $a11b925b74a008af$var$h)
      return Math.round(ms / $a11b925b74a008af$var$h) + 'h';
    if (msAbs >= $a11b925b74a008af$var$m)
      return Math.round(ms / $a11b925b74a008af$var$m) + 'm';
    if (msAbs >= $a11b925b74a008af$var$s)
      return Math.round(ms / $a11b925b74a008af$var$s) + 's';
    return ms + 'ms';
  }
  /**
   * Long format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */ function $a11b925b74a008af$var$fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= $a11b925b74a008af$var$d)
      return $a11b925b74a008af$var$plural(
        ms,
        msAbs,
        $a11b925b74a008af$var$d,
        'day',
      );
    if (msAbs >= $a11b925b74a008af$var$h)
      return $a11b925b74a008af$var$plural(
        ms,
        msAbs,
        $a11b925b74a008af$var$h,
        'hour',
      );
    if (msAbs >= $a11b925b74a008af$var$m)
      return $a11b925b74a008af$var$plural(
        ms,
        msAbs,
        $a11b925b74a008af$var$m,
        'minute',
      );
    if (msAbs >= $a11b925b74a008af$var$s)
      return $a11b925b74a008af$var$plural(
        ms,
        msAbs,
        $a11b925b74a008af$var$s,
        'second',
      );
    return ms + ' ms';
  }
  /**
   * Pluralization helper.
   */ function $a11b925b74a008af$var$plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
  }
});

parcelRegister('6pqZR', function (module, exports) {
  /**
   * Module dependencies.
   */

  /**
   * This is the Node.js implementation of `debug()`.
   */ exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.destroy = $dmXIQ$util.deprecate(() => {},
  'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
  /**
   * Colors.
   */ exports.colors = [6, 2, 3, 4, 5, 1];

  try {
    // Optional dependency (as in, doesn't need to be installed, NOT like optionalDependencies in package.json)
    // eslint-disable-next-line import/no-extraneous-dependencies
    const supportsColor = parcelRequire('bIh3l');
    if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2)
      exports.colors = [
        20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63,
        68, 69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113, 128,
        129, 134, 135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168,
        169, 170, 171, 172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200,
        201, 202, 203, 204, 205, 206, 207, 208, 209, 214, 215, 220, 221,
      ];
  } catch (error) {
    // Swallow - we only care if `supports-color` is available; it doesn't have to be.
  }
  /**
   * Build up the default `inspectOpts` object from the environment variables.
   *
   *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
   */ exports.inspectOpts = Object.keys(process.env)
    .filter(key => {
      return /^debug_/i.test(key);
    })
    .reduce((obj, key) => {
      // Camel-case
      const prop = key
        .substring(6)
        .toLowerCase()
        .replace(/_([a-z])/g, (_, k) => {
          return k.toUpperCase();
        });
      // Coerce string value into JS value
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) val = true;
      else if (/^(no|off|false|disabled)$/i.test(val)) val = false;
      else if (val === 'null') val = null;
      else val = Number(val);
      obj[prop] = val;
      return obj;
    }, {});
  /**
   * Is stdout a TTY? Colored output is enabled when `true`.
   */ function useColors() {
    return 'colors' in exports.inspectOpts
      ? Boolean(exports.inspectOpts.colors)
      : $dmXIQ$tty.isatty(process.stderr.fd);
  }
  /**
   * Adds ANSI color escape codes if enabled.
   *
   * @api public
   */ function formatArgs(args) {
    const {namespace: name, useColors} = this;
    if (useColors) {
      const c = this.color;
      const colorCode = '\x1b[3' + (c < 8 ? c : '8;5;' + c);
      const prefix = `  ${colorCode};1m${name} \u001B[0m`;
      args[0] = prefix + args[0].split('\n').join('\n' + prefix);
      args.push(
        colorCode + 'm+' + module.exports.humanize(this.diff) + '\x1b[0m',
      );
    } else args[0] = getDate() + name + ' ' + args[0];
  }
  function getDate() {
    if (exports.inspectOpts.hideDate) return '';
    return new Date().toISOString() + ' ';
  }
  /**
   * Invokes `util.format()` with the specified arguments and writes to stderr.
   */ function log(...args) {
    return process.stderr.write($dmXIQ$util.format(...args) + '\n');
  }
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */ function save(namespaces) {
    if (namespaces) process.env.DEBUG = namespaces;
    // If you set a process.env field to null or undefined, it gets cast to the
    // string 'null' or 'undefined'. Just delete instead.
    else delete process.env.DEBUG;
  }
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */ function load() {
    return process.env.DEBUG;
  }
  /**
   * Init logic for `debug` instances.
   *
   * Create a new `inspectOpts` object in case `useColors` is set
   * differently for a particular `debug` instance.
   */ function init(debug) {
    debug.inspectOpts = {};
    const keys = Object.keys(exports.inspectOpts);
    for (let i = 0; i < keys.length; i++)
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
  }

  module.exports = parcelRequire('1B1WT')(exports);
  const {formatters} = module.exports;
  /**
   * Map %o to `util.inspect()`, all on a single line.
   */ formatters.o = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util
      .inspect(v, this.inspectOpts)
      .split('\n')
      .map(str => str.trim())
      .join(' ');
  };
  /**
   * Map %O to `util.inspect()`, allowing multiple lines if needed.
   */ formatters.O = function (v) {
    this.inspectOpts.colors = this.useColors;
    return $dmXIQ$util.inspect(v, this.inspectOpts);
  };
});
parcelRegister('bIh3l', function (module, exports) {
  'use strict';

  var $etxsF = parcelRequire('etxsF');
  const $887108240f6c503c$var$env = process.env;
  let $887108240f6c503c$var$forceColor;
  if ($etxsF('no-color') || $etxsF('no-colors') || $etxsF('color=false'))
    $887108240f6c503c$var$forceColor = false;
  else if (
    $etxsF('color') ||
    $etxsF('colors') ||
    $etxsF('color=true') ||
    $etxsF('color=always')
  )
    $887108240f6c503c$var$forceColor = true;
  if ('FORCE_COLOR' in $887108240f6c503c$var$env)
    $887108240f6c503c$var$forceColor =
      $887108240f6c503c$var$env.FORCE_COLOR.length === 0 ||
      parseInt($887108240f6c503c$var$env.FORCE_COLOR, 10) !== 0;
  function $887108240f6c503c$var$translateLevel(level) {
    if (level === 0) return false;
    return {
      level: level,
      hasBasic: true,
      has256: level >= 2,
      has16m: level >= 3,
    };
  }
  function $887108240f6c503c$var$supportsColor(stream) {
    if ($887108240f6c503c$var$forceColor === false) return 0;
    if (
      $etxsF('color=16m') ||
      $etxsF('color=full') ||
      $etxsF('color=truecolor')
    )
      return 3;
    if ($etxsF('color=256')) return 2;
    if (stream && !stream.isTTY && $887108240f6c503c$var$forceColor !== true)
      return 0;
    const min = $887108240f6c503c$var$forceColor ? 1 : 0;
    if (process.platform === 'win32') {
      // Node.js 7.5.0 is the first version of Node.js to include a patch to
      // libuv that enables 256 color output on Windows. Anything earlier and it
      // won't work. However, here we target Node.js 8 at minimum as it is an LTS
      // release, and Node.js 7 is not. Windows 10 build 10586 is the first Windows
      // release that supports 256 colors. Windows 10 build 14931 is the first release
      // that supports 16m/TrueColor.
      const osRelease = $dmXIQ$os.release().split('.');
      if (
        Number(process.versions.node.split('.')[0]) >= 8 &&
        Number(osRelease[0]) >= 10 &&
        Number(osRelease[2]) >= 10586
      )
        return Number(osRelease[2]) >= 14931 ? 3 : 2;
      return 1;
    }
    if ('CI' in $887108240f6c503c$var$env) {
      if (
        ['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI'].some(
          sign => sign in $887108240f6c503c$var$env,
        ) ||
        $887108240f6c503c$var$env.CI_NAME === 'codeship'
      )
        return 1;
      return min;
    }
    if ('TEAMCITY_VERSION' in $887108240f6c503c$var$env)
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(
        $887108240f6c503c$var$env.TEAMCITY_VERSION,
      )
        ? 1
        : 0;
    if ($887108240f6c503c$var$env.COLORTERM === 'truecolor') return 3;
    if ('TERM_PROGRAM' in $887108240f6c503c$var$env) {
      const version = parseInt(
        ($887108240f6c503c$var$env.TERM_PROGRAM_VERSION || '').split('.')[0],
        10,
      );
      switch ($887108240f6c503c$var$env.TERM_PROGRAM) {
        case 'iTerm.app':
          return version >= 3 ? 3 : 2;
        case 'Apple_Terminal':
          return 2;
      }
    }
    if (/-256(color)?$/i.test($887108240f6c503c$var$env.TERM)) return 2;
    if (
      /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(
        $887108240f6c503c$var$env.TERM,
      )
    )
      return 1;
    if ('COLORTERM' in $887108240f6c503c$var$env) return 1;
    if ($887108240f6c503c$var$env.TERM === 'dumb') return min;
    return min;
  }
  function $887108240f6c503c$var$getSupportLevel(stream) {
    const level = $887108240f6c503c$var$supportsColor(stream);
    return $887108240f6c503c$var$translateLevel(level);
  }
  module.exports = {
    supportsColor: $887108240f6c503c$var$getSupportLevel,
    stdout: $887108240f6c503c$var$getSupportLevel(process.stdout),
    stderr: $887108240f6c503c$var$getSupportLevel(process.stderr),
  };
});
parcelRegister('etxsF', function (module, exports) {
  'use strict';
  module.exports = (flag, argv) => {
    argv = argv || process.argv;
    const prefix = flag.startsWith('-') ? '' : flag.length === 1 ? '-' : '--';
    const pos = argv.indexOf(prefix + flag);
    const terminatorPos = argv.indexOf('--');
    return pos !== -1 && (terminatorPos === -1 ? true : pos < terminatorPos);
  };
});

parcelRegister('2S1NY', function (module, exports) {
  var $lP3ge = parcelRequire('lP3ge');
  /*!
   * Array of passes.
   *
   * A `pass` is just a function that is executed on `req, socket, options`
   * so that you can easily add new checks while still keeping the base
   * flexible.
   */ /*
   * Websockets Passes
   *
   */ module.exports = {
    /**
     * WebSocket requests must have the `GET` method and
     * the `upgrade:websocket` header
     *
     * @param {ClientRequest} Req Request object
     * @param {Socket} Websocket
     *
     * @api private
     */ checkMethodAndHeader: function checkMethodAndHeader(req, socket) {
      if (req.method !== 'GET' || !req.headers.upgrade) {
        socket.destroy();
        return true;
      }
      if (req.headers.upgrade.toLowerCase() !== 'websocket') {
        socket.destroy();
        return true;
      }
    },
    /**
     * Sets `x-forwarded-*` headers if specified in config.
     *
     * @param {ClientRequest} Req Request object
     * @param {Socket} Websocket
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ XHeaders: function XHeaders(req, socket, options) {
      if (!options.xfwd) return;
      var values = {
        for: req.connection.remoteAddress || req.socket.remoteAddress,
        port: $lP3ge.getPort(req),
        proto: $lP3ge.hasEncryptedConnection(req) ? 'wss' : 'ws',
      };
      ['for', 'port', 'proto'].forEach(function (header) {
        req.headers['x-forwarded-' + header] =
          (req.headers['x-forwarded-' + header] || '') +
          (req.headers['x-forwarded-' + header] ? ',' : '') +
          values[header];
      });
    },
    /**
     * Does the actual proxying. Make the request and upgrade it
     * send the Switching Protocols request and pipe the sockets.
     *
     * @param {ClientRequest} Req Request object
     * @param {Socket} Websocket
     * @param {Object} Options Config object passed to the proxy
     *
     * @api private
     */ stream: function stream(req, socket, options, head, server, clb) {
      var createHttpHeader = function (line, headers) {
        return (
          Object.keys(headers)
            .reduce(
              function (head, key) {
                var value = headers[key];
                if (!Array.isArray(value)) {
                  head.push(key + ': ' + value);
                  return head;
                }
                for (var i = 0; i < value.length; i++)
                  head.push(key + ': ' + value[i]);
                return head;
              },
              [line],
            )
            .join('\r\n') + '\r\n\r\n'
        );
      };
      $lP3ge.setupSocket(socket);
      if (head && head.length) socket.unshift(head);
      var proxyReq = (
        $lP3ge.isSSL.test(options.target.protocol) ? $dmXIQ$https : $dmXIQ$http
      ).request($lP3ge.setupOutgoing(options.ssl || {}, options, req));
      // Enable developers to modify the proxyReq before headers are sent
      if (server)
        server.emit('proxyReqWs', proxyReq, req, socket, options, head);
      // Error Handler
      proxyReq.on('error', onOutgoingError);
      proxyReq.on('response', function (res) {
        // if upgrade event isn't going to happen, close the socket
        if (!res.upgrade) {
          socket.write(
            createHttpHeader(
              'HTTP/' +
                res.httpVersion +
                ' ' +
                res.statusCode +
                ' ' +
                res.statusMessage,
              res.headers,
            ),
          );
          res.pipe(socket);
        }
      });
      proxyReq.on('upgrade', function (proxyRes, proxySocket, proxyHead) {
        proxySocket.on('error', onOutgoingError);
        // Allow us to listen when the websocket has completed
        proxySocket.on('end', function () {
          server.emit('close', proxyRes, proxySocket, proxyHead);
        });
        // The pipe below will end proxySocket if socket closes cleanly, but not
        // if it errors (eg, vanishes from the net and starts returning
        // EHOSTUNREACH). We need to do that explicitly.
        socket.on('error', function () {
          proxySocket.end();
        });
        $lP3ge.setupSocket(proxySocket);
        if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);
        //
        // Remark: Handle writing the headers to the socket when switching protocols
        // Also handles when a header is an array
        //
        socket.write(
          createHttpHeader(
            'HTTP/1.1 101 Switching Protocols',
            proxyRes.headers,
          ),
        );
        proxySocket.pipe(socket).pipe(proxySocket);
        server.emit('open', proxySocket);
        server.emit('proxySocket', proxySocket); //DEPRECATED.
      });
      return proxyReq.end(); // XXX: CHECK IF THIS IS THIS CORRECT
      function onOutgoingError(err) {
        if (clb) clb(err, req, socket);
        else server.emit('error', err, req, socket);
        socket.end();
      }
    },
  };
});

parcelRegister('gO8ny', function (module, exports) {
  'use strict';

  var $lHpfL = parcelRequire('lHpfL');

  var $gKp7s = parcelRequire('gKp7s');

  var $fyIT7 = parcelRequire('fyIT7');

  var $iMXZJ = parcelRequire('iMXZJ');
  const $c3c7d0c000eb5772$var$isObject = val =>
    val && typeof val === 'object' && !Array.isArray(val);
  /**
   * Creates a matcher function from one or more glob patterns. The
   * returned function takes a string to match as its first argument,
   * and returns true if the string is a match. The returned matcher
   * function also takes a boolean as the second argument that, when true,
   * returns an object with additional information.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch(glob[, options]);
   *
   * const isMatch = picomatch('*.!(*a)');
   * console.log(isMatch('a.a')); //=> false
   * console.log(isMatch('a.b')); //=> true
   * ```
   * @name picomatch
   * @param {String|Array} `globs` One or more glob patterns.
   * @param {Object=} `options`
   * @return {Function=} Returns a matcher function.
   * @api public
   */ const $c3c7d0c000eb5772$var$picomatch = (
    glob,
    options,
    returnState = false,
  ) => {
    if (Array.isArray(glob)) {
      const fns = glob.map(input =>
        $c3c7d0c000eb5772$var$picomatch(input, options, returnState),
      );
      const arrayMatcher = str => {
        for (const isMatch of fns) {
          const state = isMatch(str);
          if (state) return state;
        }
        return false;
      };
      return arrayMatcher;
    }
    const isState =
      $c3c7d0c000eb5772$var$isObject(glob) && glob.tokens && glob.input;
    if (glob === '' || (typeof glob !== 'string' && !isState))
      throw new TypeError('Expected pattern to be a non-empty string');
    const opts = options || {};
    const posix = $fyIT7.isWindows(options);
    const regex = isState
      ? $c3c7d0c000eb5772$var$picomatch.compileRe(glob, options)
      : $c3c7d0c000eb5772$var$picomatch.makeRe(glob, options, false, true);
    const state = regex.state;
    delete regex.state;
    let isIgnored = () => false;
    if (opts.ignore) {
      const ignoreOpts = {
        ...options,
        ignore: null,
        onMatch: null,
        onResult: null,
      };
      isIgnored = $c3c7d0c000eb5772$var$picomatch(
        opts.ignore,
        ignoreOpts,
        returnState,
      );
    }
    const matcher = (input, returnObject = false) => {
      const {
        isMatch: isMatch,
        match: match,
        output: output,
      } = $c3c7d0c000eb5772$var$picomatch.test(input, regex, options, {
        glob: glob,
        posix: posix,
      });
      const result = {
        glob: glob,
        state: state,
        regex: regex,
        posix: posix,
        input: input,
        output: output,
        match: match,
        isMatch: isMatch,
      };
      if (typeof opts.onResult === 'function') opts.onResult(result);
      if (isMatch === false) {
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (isIgnored(input)) {
        if (typeof opts.onIgnore === 'function') opts.onIgnore(result);
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (typeof opts.onMatch === 'function') opts.onMatch(result);
      return returnObject ? result : true;
    };
    if (returnState) matcher.state = state;
    return matcher;
  };
  /**
   * Test `input` with the given `regex`. This is used by the main
   * `picomatch()` function to test the input string.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch.test(input, regex[, options]);
   *
   * console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
   * // { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
   * ```
   * @param {String} `input` String to test.
   * @param {RegExp} `regex`
   * @return {Object} Returns an object with matching info.
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.test = (
    input,
    regex,
    options,
    {glob: glob, posix: posix} = {},
  ) => {
    if (typeof input !== 'string')
      throw new TypeError('Expected input to be a string');
    if (input === '')
      return {
        isMatch: false,
        output: '',
      };
    const opts = options || {};
    const format = opts.format || (posix ? $fyIT7.toPosixSlashes : null);
    let match = input === glob;
    let output = match && format ? format(input) : input;
    if (match === false) {
      output = format ? format(input) : input;
      match = output === glob;
    }
    if (match === false || opts.capture === true) {
      if (opts.matchBase === true || opts.basename === true)
        match = $c3c7d0c000eb5772$var$picomatch.matchBase(
          input,
          regex,
          options,
          posix,
        );
      else match = regex.exec(output);
    }
    return {
      isMatch: Boolean(match),
      match: match,
      output: output,
    };
  };
  /**
   * Match the basename of a filepath.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch.matchBase(input, glob[, options]);
   * console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
   * ```
   * @param {String} `input` String to test.
   * @param {RegExp|String} `glob` Glob pattern or regex created by [.makeRe](#makeRe).
   * @return {Boolean}
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.matchBase = (
    input,
    glob,
    options,
    posix = $fyIT7.isWindows(options),
  ) => {
    const regex =
      glob instanceof RegExp
        ? glob
        : $c3c7d0c000eb5772$var$picomatch.makeRe(glob, options);
    return regex.test($dmXIQ$path.basename(input));
  };
  /**
   * Returns true if **any** of the given glob `patterns` match the specified `string`.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch.isMatch(string, patterns[, options]);
   *
   * console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
   * console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
   * ```
   * @param {String|Array} str The string to test.
   * @param {String|Array} patterns One or more glob patterns to use for matching.
   * @param {Object} [options] See available [options](#options).
   * @return {Boolean} Returns true if any patterns match `str`
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.isMatch = (str, patterns, options) =>
    $c3c7d0c000eb5772$var$picomatch(patterns, options)(str);
  /**
   * Parse a glob pattern to create the source string for a regular
   * expression.
   *
   * ```js
   * const picomatch = require('picomatch');
   * const result = picomatch.parse(pattern[, options]);
   * ```
   * @param {String} `pattern`
   * @param {Object} `options`
   * @return {Object} Returns an object with useful properties and output to be used as a regex source string.
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.parse = (pattern, options) => {
    if (Array.isArray(pattern))
      return pattern.map(p =>
        $c3c7d0c000eb5772$var$picomatch.parse(p, options),
      );
    return $gKp7s(pattern, {
      ...options,
      fastpaths: false,
    });
  };
  /**
   * Scan a glob pattern to separate the pattern into segments.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch.scan(input[, options]);
   *
   * const result = picomatch.scan('!./foo/*.js');
   * console.log(result);
   * { prefix: '!./',
   *   input: '!./foo/*.js',
   *   start: 3,
   *   base: 'foo',
   *   glob: '*.js',
   *   isBrace: false,
   *   isBracket: false,
   *   isGlob: true,
   *   isExtglob: false,
   *   isGlobstar: false,
   *   negated: true }
   * ```
   * @param {String} `input` Glob pattern to scan.
   * @param {Object} `options`
   * @return {Object} Returns an object with
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.scan = (input, options) =>
    $lHpfL(input, options);
  /**
   * Compile a regular expression from the `state` object returned by the
   * [parse()](#parse) method.
   *
   * @param {Object} `state`
   * @param {Object} `options`
   * @param {Boolean} `returnOutput` Intended for implementors, this argument allows you to return the raw output from the parser.
   * @param {Boolean} `returnState` Adds the state to a `state` property on the returned regex. Useful for implementors and debugging.
   * @return {RegExp}
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.compileRe = (
    state,
    options,
    returnOutput = false,
    returnState = false,
  ) => {
    if (returnOutput === true) return state.output;
    const opts = options || {};
    const prepend = opts.contains ? '' : '^';
    const append = opts.contains ? '' : '$';
    let source = `${prepend}(?:${state.output})${append}`;
    if (state && state.negated === true) source = `^(?!${source}).*$`;
    const regex = $c3c7d0c000eb5772$var$picomatch.toRegex(source, options);
    if (returnState === true) regex.state = state;
    return regex;
  };
  /**
   * Create a regular expression from a parsed glob pattern.
   *
   * ```js
   * const picomatch = require('picomatch');
   * const state = picomatch.parse('*.js');
   * // picomatch.compileRe(state[, options]);
   *
   * console.log(picomatch.compileRe(state));
   * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
   * ```
   * @param {String} `state` The object returned from the `.parse` method.
   * @param {Object} `options`
   * @param {Boolean} `returnOutput` Implementors may use this argument to return the compiled output, instead of a regular expression. This is not exposed on the options to prevent end-users from mutating the result.
   * @param {Boolean} `returnState` Implementors may use this argument to return the state from the parsed glob with the returned regular expression.
   * @return {RegExp} Returns a regex created from the given pattern.
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.makeRe = (
    input,
    options = {},
    returnOutput = false,
    returnState = false,
  ) => {
    if (!input || typeof input !== 'string')
      throw new TypeError('Expected a non-empty string');
    let parsed = {
      negated: false,
      fastpaths: true,
    };
    if (options.fastpaths !== false && (input[0] === '.' || input[0] === '*'))
      parsed.output = $gKp7s.fastpaths(input, options);
    if (!parsed.output) parsed = $gKp7s(input, options);
    return $c3c7d0c000eb5772$var$picomatch.compileRe(
      parsed,
      options,
      returnOutput,
      returnState,
    );
  };
  /**
   * Create a regular expression from the given regex source string.
   *
   * ```js
   * const picomatch = require('picomatch');
   * // picomatch.toRegex(source[, options]);
   *
   * const { output } = picomatch.parse('*.js');
   * console.log(picomatch.toRegex(output));
   * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
   * ```
   * @param {String} `source` Regular expression source string.
   * @param {Object} `options`
   * @return {RegExp}
   * @api public
   */ $c3c7d0c000eb5772$var$picomatch.toRegex = (source, options) => {
    try {
      const opts = options || {};
      return new RegExp(source, opts.flags || (opts.nocase ? 'i' : ''));
    } catch (err) {
      if (options && options.debug === true) throw err;
      return /$^/;
    }
  };
  /**
   * Picomatch constants.
   * @return {Object}
   */ $c3c7d0c000eb5772$var$picomatch.constants = $iMXZJ;
  /**
   * Expose "picomatch"
   */ module.exports = $c3c7d0c000eb5772$var$picomatch;
});
parcelRegister('lHpfL', function (module, exports) {
  'use strict';

  var $fyIT7 = parcelRequire('fyIT7');

  var $iMXZJ = parcelRequire('iMXZJ');
  var $fcc133e6fe4c565a$require$CHAR_ASTERISK = $iMXZJ.CHAR_ASTERISK;
  var $fcc133e6fe4c565a$require$CHAR_AT = $iMXZJ.CHAR_AT;
  var $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH =
    $iMXZJ.CHAR_BACKWARD_SLASH;
  var $fcc133e6fe4c565a$require$CHAR_COMMA = $iMXZJ.CHAR_COMMA;
  var $fcc133e6fe4c565a$require$CHAR_DOT = $iMXZJ.CHAR_DOT;
  var $fcc133e6fe4c565a$require$CHAR_EXCLAMATION_MARK =
    $iMXZJ.CHAR_EXCLAMATION_MARK;
  var $fcc133e6fe4c565a$require$CHAR_FORWARD_SLASH = $iMXZJ.CHAR_FORWARD_SLASH;
  var $fcc133e6fe4c565a$require$CHAR_LEFT_CURLY_BRACE =
    $iMXZJ.CHAR_LEFT_CURLY_BRACE;
  var $fcc133e6fe4c565a$require$CHAR_LEFT_PARENTHESES =
    $iMXZJ.CHAR_LEFT_PARENTHESES;
  var $fcc133e6fe4c565a$require$CHAR_LEFT_SQUARE_BRACKET =
    $iMXZJ.CHAR_LEFT_SQUARE_BRACKET;
  var $fcc133e6fe4c565a$require$CHAR_PLUS = $iMXZJ.CHAR_PLUS;
  var $fcc133e6fe4c565a$require$CHAR_QUESTION_MARK = $iMXZJ.CHAR_QUESTION_MARK;
  var $fcc133e6fe4c565a$require$CHAR_RIGHT_CURLY_BRACE =
    $iMXZJ.CHAR_RIGHT_CURLY_BRACE;
  var $fcc133e6fe4c565a$require$CHAR_RIGHT_PARENTHESES =
    $iMXZJ.CHAR_RIGHT_PARENTHESES;
  var $fcc133e6fe4c565a$require$CHAR_RIGHT_SQUARE_BRACKET =
    $iMXZJ.CHAR_RIGHT_SQUARE_BRACKET;
  const $fcc133e6fe4c565a$var$isPathSeparator = code => {
    return (
      code === $fcc133e6fe4c565a$require$CHAR_FORWARD_SLASH ||
      code === $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH
    );
  };
  const $fcc133e6fe4c565a$var$depth = token => {
    if (token.isPrefix !== true) token.depth = token.isGlobstar ? Infinity : 1;
  };
  /**
   * Quickly scans a glob pattern and returns an object with a handful of
   * useful properties, like `isGlob`, `path` (the leading non-glob, if it exists),
   * `glob` (the actual pattern), `negated` (true if the path starts with `!` but not
   * with `!(`) and `negatedExtglob` (true if the path starts with `!(`).
   *
   * ```js
   * const pm = require('picomatch');
   * console.log(pm.scan('foo/bar/*.js'));
   * { isGlob: true, input: 'foo/bar/*.js', base: 'foo/bar', glob: '*.js' }
   * ```
   * @param {String} `str`
   * @param {Object} `options`
   * @return {Object} Returns an object with tokens and regex source string.
   * @api public
   */ const $fcc133e6fe4c565a$var$scan = (input, options) => {
    const opts = options || {};
    const length = input.length - 1;
    const scanToEnd = opts.parts === true || opts.scanToEnd === true;
    const slashes = [];
    const tokens = [];
    const parts = [];
    let str = input;
    let index = -1;
    let start = 0;
    let lastIndex = 0;
    let isBrace = false;
    let isBracket = false;
    let isGlob = false;
    let isExtglob = false;
    let isGlobstar = false;
    let braceEscaped = false;
    let backslashes = false;
    let negated = false;
    let negatedExtglob = false;
    let finished = false;
    let braces = 0;
    let prev;
    let code;
    let token = {
      value: '',
      depth: 0,
      isGlob: false,
    };
    const eos = () => index >= length;
    const peek = () => str.charCodeAt(index + 1);
    const advance = () => {
      prev = code;
      return str.charCodeAt(++index);
    };
    while (index < length) {
      code = advance();
      let next;
      if (code === $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH) {
        backslashes = token.backslashes = true;
        code = advance();
        if (code === $fcc133e6fe4c565a$require$CHAR_LEFT_CURLY_BRACE)
          braceEscaped = true;
        continue;
      }
      if (
        braceEscaped === true ||
        code === $fcc133e6fe4c565a$require$CHAR_LEFT_CURLY_BRACE
      ) {
        braces++;
        while (eos() !== true && (code = advance())) {
          if (code === $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (code === $fcc133e6fe4c565a$require$CHAR_LEFT_CURLY_BRACE) {
            braces++;
            continue;
          }
          if (
            braceEscaped !== true &&
            code === $fcc133e6fe4c565a$require$CHAR_DOT &&
            (code = advance()) === $fcc133e6fe4c565a$require$CHAR_DOT
          ) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) continue;
            break;
          }
          if (
            braceEscaped !== true &&
            code === $fcc133e6fe4c565a$require$CHAR_COMMA
          ) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) continue;
            break;
          }
          if (code === $fcc133e6fe4c565a$require$CHAR_RIGHT_CURLY_BRACE) {
            braces--;
            if (braces === 0) {
              braceEscaped = false;
              isBrace = token.isBrace = true;
              finished = true;
              break;
            }
          }
        }
        if (scanToEnd === true) continue;
        break;
      }
      if (code === $fcc133e6fe4c565a$require$CHAR_FORWARD_SLASH) {
        slashes.push(index);
        tokens.push(token);
        token = {
          value: '',
          depth: 0,
          isGlob: false,
        };
        if (finished === true) continue;
        if (
          prev === $fcc133e6fe4c565a$require$CHAR_DOT &&
          index === start + 1
        ) {
          start += 2;
          continue;
        }
        lastIndex = index + 1;
        continue;
      }
      if (opts.noext !== true) {
        const isExtglobChar =
          code === $fcc133e6fe4c565a$require$CHAR_PLUS ||
          code === $fcc133e6fe4c565a$require$CHAR_AT ||
          code === $fcc133e6fe4c565a$require$CHAR_ASTERISK ||
          code === $fcc133e6fe4c565a$require$CHAR_QUESTION_MARK ||
          code === $fcc133e6fe4c565a$require$CHAR_EXCLAMATION_MARK;
        if (
          isExtglobChar === true &&
          peek() === $fcc133e6fe4c565a$require$CHAR_LEFT_PARENTHESES
        ) {
          isGlob = token.isGlob = true;
          isExtglob = token.isExtglob = true;
          finished = true;
          if (
            code === $fcc133e6fe4c565a$require$CHAR_EXCLAMATION_MARK &&
            index === start
          )
            negatedExtglob = true;
          if (scanToEnd === true) {
            while (eos() !== true && (code = advance())) {
              if (code === $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH) {
                backslashes = token.backslashes = true;
                code = advance();
                continue;
              }
              if (code === $fcc133e6fe4c565a$require$CHAR_RIGHT_PARENTHESES) {
                isGlob = token.isGlob = true;
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
      }
      if (code === $fcc133e6fe4c565a$require$CHAR_ASTERISK) {
        if (prev === $fcc133e6fe4c565a$require$CHAR_ASTERISK)
          isGlobstar = token.isGlobstar = true;
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) continue;
        break;
      }
      if (code === $fcc133e6fe4c565a$require$CHAR_QUESTION_MARK) {
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) continue;
        break;
      }
      if (code === $fcc133e6fe4c565a$require$CHAR_LEFT_SQUARE_BRACKET) {
        while (eos() !== true && (next = advance())) {
          if (next === $fcc133e6fe4c565a$require$CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (next === $fcc133e6fe4c565a$require$CHAR_RIGHT_SQUARE_BRACKET) {
            isBracket = token.isBracket = true;
            isGlob = token.isGlob = true;
            finished = true;
            break;
          }
        }
        if (scanToEnd === true) continue;
        break;
      }
      if (
        opts.nonegate !== true &&
        code === $fcc133e6fe4c565a$require$CHAR_EXCLAMATION_MARK &&
        index === start
      ) {
        negated = token.negated = true;
        start++;
        continue;
      }
      if (
        opts.noparen !== true &&
        code === $fcc133e6fe4c565a$require$CHAR_LEFT_PARENTHESES
      ) {
        isGlob = token.isGlob = true;
        if (scanToEnd === true) {
          while (eos() !== true && (code = advance())) {
            if (code === $fcc133e6fe4c565a$require$CHAR_LEFT_PARENTHESES) {
              backslashes = token.backslashes = true;
              code = advance();
              continue;
            }
            if (code === $fcc133e6fe4c565a$require$CHAR_RIGHT_PARENTHESES) {
              finished = true;
              break;
            }
          }
          continue;
        }
        break;
      }
      if (isGlob === true) {
        finished = true;
        if (scanToEnd === true) continue;
        break;
      }
    }
    if (opts.noext === true) {
      isExtglob = false;
      isGlob = false;
    }
    let base = str;
    let prefix = '';
    let glob = '';
    if (start > 0) {
      prefix = str.slice(0, start);
      str = str.slice(start);
      lastIndex -= start;
    }
    if (base && isGlob === true && lastIndex > 0) {
      base = str.slice(0, lastIndex);
      glob = str.slice(lastIndex);
    } else if (isGlob === true) {
      base = '';
      glob = str;
    } else base = str;
    if (base && base !== '' && base !== '/' && base !== str) {
      if (
        $fcc133e6fe4c565a$var$isPathSeparator(base.charCodeAt(base.length - 1))
      )
        base = base.slice(0, -1);
    }
    if (opts.unescape === true) {
      if (glob) glob = $fyIT7.removeBackslashes(glob);
      if (base && backslashes === true) base = $fyIT7.removeBackslashes(base);
    }
    const state = {
      prefix: prefix,
      input: input,
      start: start,
      base: base,
      glob: glob,
      isBrace: isBrace,
      isBracket: isBracket,
      isGlob: isGlob,
      isExtglob: isExtglob,
      isGlobstar: isGlobstar,
      negated: negated,
      negatedExtglob: negatedExtglob,
    };
    if (opts.tokens === true) {
      state.maxDepth = 0;
      if (!$fcc133e6fe4c565a$var$isPathSeparator(code)) tokens.push(token);
      state.tokens = tokens;
    }
    if (opts.parts === true || opts.tokens === true) {
      let prevIndex;
      for (let idx = 0; idx < slashes.length; idx++) {
        const n = prevIndex ? prevIndex + 1 : start;
        const i = slashes[idx];
        const value = input.slice(n, i);
        if (opts.tokens) {
          if (idx === 0 && start !== 0) {
            tokens[idx].isPrefix = true;
            tokens[idx].value = prefix;
          } else tokens[idx].value = value;
          $fcc133e6fe4c565a$var$depth(tokens[idx]);
          state.maxDepth += tokens[idx].depth;
        }
        if (idx !== 0 || value !== '') parts.push(value);
        prevIndex = i;
      }
      if (prevIndex && prevIndex + 1 < input.length) {
        const value = input.slice(prevIndex + 1);
        parts.push(value);
        if (opts.tokens) {
          tokens[tokens.length - 1].value = value;
          $fcc133e6fe4c565a$var$depth(tokens[tokens.length - 1]);
          state.maxDepth += tokens[tokens.length - 1].depth;
        }
      }
      state.slashes = slashes;
      state.parts = parts;
    }
    return state;
  };
  module.exports = $fcc133e6fe4c565a$var$scan;
});
parcelRegister('fyIT7', function (module, exports) {
  $parcel$export(
    module.exports,
    'isObject',
    () => $b53cd9d01354f1b9$export$a6cdc56e425d0d0a,
    v => ($b53cd9d01354f1b9$export$a6cdc56e425d0d0a = v),
  );
  $parcel$export(
    module.exports,
    'hasRegexChars',
    () => $b53cd9d01354f1b9$export$6540a013a39bb50d,
    v => ($b53cd9d01354f1b9$export$6540a013a39bb50d = v),
  );
  $parcel$export(
    module.exports,
    'escapeRegex',
    () => $b53cd9d01354f1b9$export$104ed90cc1a13451,
    v => ($b53cd9d01354f1b9$export$104ed90cc1a13451 = v),
  );
  $parcel$export(
    module.exports,
    'toPosixSlashes',
    () => $b53cd9d01354f1b9$export$e610e037975797ee,
    v => ($b53cd9d01354f1b9$export$e610e037975797ee = v),
  );
  $parcel$export(
    module.exports,
    'removeBackslashes',
    () => $b53cd9d01354f1b9$export$f403de0a7ba7a743,
    v => ($b53cd9d01354f1b9$export$f403de0a7ba7a743 = v),
  );
  $parcel$export(
    module.exports,
    'supportsLookbehinds',
    () => $b53cd9d01354f1b9$export$bcf709e5e3483cdb,
    v => ($b53cd9d01354f1b9$export$bcf709e5e3483cdb = v),
  );
  $parcel$export(
    module.exports,
    'isWindows',
    () => $b53cd9d01354f1b9$export$f993c945890e93ba,
    v => ($b53cd9d01354f1b9$export$f993c945890e93ba = v),
  );
  $parcel$export(
    module.exports,
    'escapeLast',
    () => $b53cd9d01354f1b9$export$13d0f4185f159c8,
    v => ($b53cd9d01354f1b9$export$13d0f4185f159c8 = v),
  );
  $parcel$export(
    module.exports,
    'removePrefix',
    () => $b53cd9d01354f1b9$export$f2888183a34644d4,
    v => ($b53cd9d01354f1b9$export$f2888183a34644d4 = v),
  );
  $parcel$export(
    module.exports,
    'wrapOutput',
    () => $b53cd9d01354f1b9$export$25bddda26836484b,
    v => ($b53cd9d01354f1b9$export$25bddda26836484b = v),
  );
  var $b53cd9d01354f1b9$export$a6cdc56e425d0d0a;
  var $b53cd9d01354f1b9$export$6540a013a39bb50d;
  var $b53cd9d01354f1b9$export$a92319f7ab133839;
  var $b53cd9d01354f1b9$export$104ed90cc1a13451;
  var $b53cd9d01354f1b9$export$e610e037975797ee;
  var $b53cd9d01354f1b9$export$f403de0a7ba7a743;
  var $b53cd9d01354f1b9$export$bcf709e5e3483cdb;
  var $b53cd9d01354f1b9$export$f993c945890e93ba;
  var $b53cd9d01354f1b9$export$13d0f4185f159c8;
  var $b53cd9d01354f1b9$export$f2888183a34644d4;
  var $b53cd9d01354f1b9$export$25bddda26836484b;
  ('use strict');

  const $b53cd9d01354f1b9$var$win32 = process.platform === 'win32';

  var $iMXZJ = parcelRequire('iMXZJ');
  var $b53cd9d01354f1b9$require$REGEX_BACKSLASH = $iMXZJ.REGEX_BACKSLASH;
  var $b53cd9d01354f1b9$require$REGEX_REMOVE_BACKSLASH =
    $iMXZJ.REGEX_REMOVE_BACKSLASH;
  var $b53cd9d01354f1b9$require$REGEX_SPECIAL_CHARS =
    $iMXZJ.REGEX_SPECIAL_CHARS;
  var $b53cd9d01354f1b9$require$REGEX_SPECIAL_CHARS_GLOBAL =
    $iMXZJ.REGEX_SPECIAL_CHARS_GLOBAL;
  $b53cd9d01354f1b9$export$a6cdc56e425d0d0a = val =>
    val !== null && typeof val === 'object' && !Array.isArray(val);
  $b53cd9d01354f1b9$export$6540a013a39bb50d = str =>
    $b53cd9d01354f1b9$require$REGEX_SPECIAL_CHARS.test(str);
  $b53cd9d01354f1b9$export$a92319f7ab133839 = str =>
    str.length === 1 && $b53cd9d01354f1b9$export$6540a013a39bb50d(str);
  $b53cd9d01354f1b9$export$104ed90cc1a13451 = str =>
    str.replace($b53cd9d01354f1b9$require$REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
  $b53cd9d01354f1b9$export$e610e037975797ee = str =>
    str.replace($b53cd9d01354f1b9$require$REGEX_BACKSLASH, '/');
  $b53cd9d01354f1b9$export$f403de0a7ba7a743 = str => {
    return str.replace(
      $b53cd9d01354f1b9$require$REGEX_REMOVE_BACKSLASH,
      match => {
        return match === '\\' ? '' : match;
      },
    );
  };
  $b53cd9d01354f1b9$export$bcf709e5e3483cdb = () => {
    const segs = process.version.slice(1).split('.').map(Number);
    if ((segs.length === 3 && segs[0] >= 9) || (segs[0] === 8 && segs[1] >= 10))
      return true;
    return false;
  };
  $b53cd9d01354f1b9$export$f993c945890e93ba = options => {
    if (options && typeof options.windows === 'boolean') return options.windows;
    return $b53cd9d01354f1b9$var$win32 === true || $dmXIQ$path.sep === '\\';
  };
  $b53cd9d01354f1b9$export$13d0f4185f159c8 = (input, char, lastIdx) => {
    const idx = input.lastIndexOf(char, lastIdx);
    if (idx === -1) return input;
    if (input[idx - 1] === '\\')
      return $b53cd9d01354f1b9$export$13d0f4185f159c8(input, char, idx - 1);
    return `${input.slice(0, idx)}\\${input.slice(idx)}`;
  };
  $b53cd9d01354f1b9$export$f2888183a34644d4 = (input, state = {}) => {
    let output = input;
    if (output.startsWith('./')) {
      output = output.slice(2);
      state.prefix = './';
    }
    return output;
  };
  $b53cd9d01354f1b9$export$25bddda26836484b = (
    input,
    state = {},
    options = {},
  ) => {
    const prepend = options.contains ? '' : '^';
    const append = options.contains ? '' : '$';
    let output = `${prepend}(?:${input})${append}`;
    if (state.negated === true) output = `(?:^(?!${output}).*$)`;
    return output;
  };
});
parcelRegister('iMXZJ', function (module, exports) {
  'use strict';

  const $dadb3f67ccdb6e3e$var$WIN_SLASH = '\\\\/';
  const $dadb3f67ccdb6e3e$var$WIN_NO_SLASH = `[^${$dadb3f67ccdb6e3e$var$WIN_SLASH}]`;
  /**
   * Posix glob regex
   */ const $dadb3f67ccdb6e3e$var$DOT_LITERAL = '\\.';
  const $dadb3f67ccdb6e3e$var$PLUS_LITERAL = '\\+';
  const $dadb3f67ccdb6e3e$var$QMARK_LITERAL = '\\?';
  const $dadb3f67ccdb6e3e$var$SLASH_LITERAL = '\\/';
  const $dadb3f67ccdb6e3e$var$ONE_CHAR = '(?=.)';
  const $dadb3f67ccdb6e3e$var$QMARK = '[^/]';
  const $dadb3f67ccdb6e3e$var$END_ANCHOR = `(?:${$dadb3f67ccdb6e3e$var$SLASH_LITERAL}|$)`;
  const $dadb3f67ccdb6e3e$var$START_ANCHOR = `(?:^|${$dadb3f67ccdb6e3e$var$SLASH_LITERAL})`;
  const $dadb3f67ccdb6e3e$var$DOTS_SLASH = `${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{1,2}${$dadb3f67ccdb6e3e$var$END_ANCHOR}`;
  const $dadb3f67ccdb6e3e$var$NO_DOT = `(?!${$dadb3f67ccdb6e3e$var$DOT_LITERAL})`;
  const $dadb3f67ccdb6e3e$var$NO_DOTS = `(?!${$dadb3f67ccdb6e3e$var$START_ANCHOR}${$dadb3f67ccdb6e3e$var$DOTS_SLASH})`;
  const $dadb3f67ccdb6e3e$var$NO_DOT_SLASH = `(?!${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{0,1}${$dadb3f67ccdb6e3e$var$END_ANCHOR})`;
  const $dadb3f67ccdb6e3e$var$NO_DOTS_SLASH = `(?!${$dadb3f67ccdb6e3e$var$DOTS_SLASH})`;
  const $dadb3f67ccdb6e3e$var$QMARK_NO_DOT = `[^.${$dadb3f67ccdb6e3e$var$SLASH_LITERAL}]`;
  const $dadb3f67ccdb6e3e$var$STAR = `${$dadb3f67ccdb6e3e$var$QMARK}*?`;
  const $dadb3f67ccdb6e3e$var$POSIX_CHARS = {
    DOT_LITERAL: $dadb3f67ccdb6e3e$var$DOT_LITERAL,
    PLUS_LITERAL: $dadb3f67ccdb6e3e$var$PLUS_LITERAL,
    QMARK_LITERAL: $dadb3f67ccdb6e3e$var$QMARK_LITERAL,
    SLASH_LITERAL: $dadb3f67ccdb6e3e$var$SLASH_LITERAL,
    ONE_CHAR: $dadb3f67ccdb6e3e$var$ONE_CHAR,
    QMARK: $dadb3f67ccdb6e3e$var$QMARK,
    END_ANCHOR: $dadb3f67ccdb6e3e$var$END_ANCHOR,
    DOTS_SLASH: $dadb3f67ccdb6e3e$var$DOTS_SLASH,
    NO_DOT: $dadb3f67ccdb6e3e$var$NO_DOT,
    NO_DOTS: $dadb3f67ccdb6e3e$var$NO_DOTS,
    NO_DOT_SLASH: $dadb3f67ccdb6e3e$var$NO_DOT_SLASH,
    NO_DOTS_SLASH: $dadb3f67ccdb6e3e$var$NO_DOTS_SLASH,
    QMARK_NO_DOT: $dadb3f67ccdb6e3e$var$QMARK_NO_DOT,
    STAR: $dadb3f67ccdb6e3e$var$STAR,
    START_ANCHOR: $dadb3f67ccdb6e3e$var$START_ANCHOR,
  };
  /**
   * Windows glob regex
   */ const $dadb3f67ccdb6e3e$var$WINDOWS_CHARS = {
    ...$dadb3f67ccdb6e3e$var$POSIX_CHARS,
    SLASH_LITERAL: `[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]`,
    QMARK: $dadb3f67ccdb6e3e$var$WIN_NO_SLASH,
    STAR: `${$dadb3f67ccdb6e3e$var$WIN_NO_SLASH}*?`,
    DOTS_SLASH: `${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{1,2}(?:[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]|$)`,
    NO_DOT: `(?!${$dadb3f67ccdb6e3e$var$DOT_LITERAL})`,
    NO_DOTS: `(?!(?:^|[${$dadb3f67ccdb6e3e$var$WIN_SLASH}])${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{1,2}(?:[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]|$))`,
    NO_DOT_SLASH: `(?!${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{0,1}(?:[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]|$))`,
    NO_DOTS_SLASH: `(?!${$dadb3f67ccdb6e3e$var$DOT_LITERAL}{1,2}(?:[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]|$))`,
    QMARK_NO_DOT: `[^.${$dadb3f67ccdb6e3e$var$WIN_SLASH}]`,
    START_ANCHOR: `(?:^|[${$dadb3f67ccdb6e3e$var$WIN_SLASH}])`,
    END_ANCHOR: `(?:[${$dadb3f67ccdb6e3e$var$WIN_SLASH}]|$)`,
  };
  /**
   * POSIX Bracket Regex
   */ const $dadb3f67ccdb6e3e$var$POSIX_REGEX_SOURCE = {
    alnum: 'a-zA-Z0-9',
    alpha: 'a-zA-Z',
    ascii: '\\x00-\\x7F',
    blank: ' \\t',
    cntrl: '\\x00-\\x1F\\x7F',
    digit: '0-9',
    graph: '\\x21-\\x7E',
    lower: 'a-z',
    print: '\\x20-\\x7E ',
    punct: '\\-!"#$%&\'()\\*+,./:;<=>?@[\\]^_`{|}~',
    space: ' \\t\\r\\n\\v\\f',
    upper: 'A-Z',
    word: 'A-Za-z0-9_',
    xdigit: 'A-Fa-f0-9',
  };
  module.exports = {
    MAX_LENGTH: 65536,
    POSIX_REGEX_SOURCE: $dadb3f67ccdb6e3e$var$POSIX_REGEX_SOURCE,
    // regular expressions
    REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
    REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
    REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
    REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
    REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
    REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
    // Replace globs with equivalent patterns to reduce parsing time.
    REPLACEMENTS: {
      '***': '*',
      '**/**': '**',
      '**/**/**': '**',
    },
    // Digits
    CHAR_0: 48,
    /* 0 */ CHAR_9: 57,
    /* 9 */ // Alphabet chars.
    CHAR_UPPERCASE_A: 65,
    /* A */ CHAR_LOWERCASE_A: 97,
    /* a */ CHAR_UPPERCASE_Z: 90,
    /* Z */ CHAR_LOWERCASE_Z: 122,
    /* z */ CHAR_LEFT_PARENTHESES: 40,
    /* ( */ CHAR_RIGHT_PARENTHESES: 41,
    /* ) */ CHAR_ASTERISK: 42,
    /* * */ // Non-alphabetic chars.
    CHAR_AMPERSAND: 38,
    /* & */ CHAR_AT: 64,
    /* @ */ CHAR_BACKWARD_SLASH: 92,
    /* \ */ CHAR_CARRIAGE_RETURN: 13,
    /* \r */ CHAR_CIRCUMFLEX_ACCENT: 94,
    /* ^ */ CHAR_COLON: 58,
    /* : */ CHAR_COMMA: 44,
    /* , */ CHAR_DOT: 46,
    /* . */ CHAR_DOUBLE_QUOTE: 34,
    /* " */ CHAR_EQUAL: 61,
    /* = */ CHAR_EXCLAMATION_MARK: 33,
    /* ! */ CHAR_FORM_FEED: 12,
    /* \f */ CHAR_FORWARD_SLASH: 47,
    /* / */ CHAR_GRAVE_ACCENT: 96,
    /* ` */ CHAR_HASH: 35,
    /* # */ CHAR_HYPHEN_MINUS: 45,
    /* - */ CHAR_LEFT_ANGLE_BRACKET: 60,
    /* < */ CHAR_LEFT_CURLY_BRACE: 123,
    /* { */ CHAR_LEFT_SQUARE_BRACKET: 91,
    /* [ */ CHAR_LINE_FEED: 10,
    /* \n */ CHAR_NO_BREAK_SPACE: 160,
    /* \u00A0 */ CHAR_PERCENT: 37,
    /* % */ CHAR_PLUS: 43,
    /* + */ CHAR_QUESTION_MARK: 63,
    /* ? */ CHAR_RIGHT_ANGLE_BRACKET: 62,
    /* > */ CHAR_RIGHT_CURLY_BRACE: 125,
    /* } */ CHAR_RIGHT_SQUARE_BRACKET: 93,
    /* ] */ CHAR_SEMICOLON: 59,
    /* ; */ CHAR_SINGLE_QUOTE: 39,
    /* ' */ CHAR_SPACE: 32,
    /*   */ CHAR_TAB: 9,
    /* \t */ CHAR_UNDERSCORE: 95,
    /* _ */ CHAR_VERTICAL_LINE: 124,
    /* | */ CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
    /* \uFEFF */ SEP: $dmXIQ$path.sep,
    /**
     * Create EXTGLOB_CHARS
     */ extglobChars(chars) {
      return {
        '!': {
          type: 'negate',
          open: '(?:(?!(?:',
          close: `))${chars.STAR})`,
        },
        '?': {
          type: 'qmark',
          open: '(?:',
          close: ')?',
        },
        '+': {
          type: 'plus',
          open: '(?:',
          close: ')+',
        },
        '*': {
          type: 'star',
          open: '(?:',
          close: ')*',
        },
        '@': {
          type: 'at',
          open: '(?:',
          close: ')',
        },
      };
    },
    /**
     * Create GLOB_CHARS
     */ globChars(win32) {
      return win32 === true
        ? $dadb3f67ccdb6e3e$var$WINDOWS_CHARS
        : $dadb3f67ccdb6e3e$var$POSIX_CHARS;
    },
  };
});

parcelRegister('gKp7s', function (module, exports) {
  'use strict';

  var $iMXZJ = parcelRequire('iMXZJ');

  var $fyIT7 = parcelRequire('fyIT7');
  /**
   * Constants
   */ const {
    MAX_LENGTH: $c3146d61e2b0930d$var$MAX_LENGTH,
    POSIX_REGEX_SOURCE: $c3146d61e2b0930d$var$POSIX_REGEX_SOURCE,
    REGEX_NON_SPECIAL_CHARS: $c3146d61e2b0930d$var$REGEX_NON_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_BACKREF:
      $c3146d61e2b0930d$var$REGEX_SPECIAL_CHARS_BACKREF,
    REPLACEMENTS: $c3146d61e2b0930d$var$REPLACEMENTS,
  } = $iMXZJ;
  /**
   * Helpers
   */ const $c3146d61e2b0930d$var$expandRange = (args, options) => {
    if (typeof options.expandRange === 'function')
      return options.expandRange(...args, options);
    args.sort();
    const value = `[${args.join('-')}]`;
    try {
      /* eslint-disable-next-line no-new */ new RegExp(value);
    } catch (ex) {
      return args.map(v => $fyIT7.escapeRegex(v)).join('..');
    }
    return value;
  };
  /**
   * Create the message for a syntax error
   */ const $c3146d61e2b0930d$var$syntaxError = (type, char) => {
    return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
  };
  /**
   * Parse the given input string.
   * @param {String} input
   * @param {Object} options
   * @return {Object}
   */ const $c3146d61e2b0930d$var$parse = (input, options) => {
    if (typeof input !== 'string') throw new TypeError('Expected a string');
    input = $c3146d61e2b0930d$var$REPLACEMENTS[input] || input;
    const opts = {
      ...options,
    };
    const max =
      typeof opts.maxLength === 'number'
        ? Math.min($c3146d61e2b0930d$var$MAX_LENGTH, opts.maxLength)
        : $c3146d61e2b0930d$var$MAX_LENGTH;
    let len = input.length;
    if (len > max)
      throw new SyntaxError(
        `Input length: ${len}, exceeds maximum allowed length: ${max}`,
      );
    const bos = {
      type: 'bos',
      value: '',
      output: opts.prepend || '',
    };
    const tokens = [bos];
    const capture = opts.capture ? '' : '?:';
    const win32 = $fyIT7.isWindows(options);
    // create constants based on platform, for windows or posix
    const PLATFORM_CHARS = $iMXZJ.globChars(win32);
    const EXTGLOB_CHARS = $iMXZJ.extglobChars(PLATFORM_CHARS);
    const {
      DOT_LITERAL: DOT_LITERAL,
      PLUS_LITERAL: PLUS_LITERAL,
      SLASH_LITERAL: SLASH_LITERAL,
      ONE_CHAR: ONE_CHAR,
      DOTS_SLASH: DOTS_SLASH,
      NO_DOT: NO_DOT,
      NO_DOT_SLASH: NO_DOT_SLASH,
      NO_DOTS_SLASH: NO_DOTS_SLASH,
      QMARK: QMARK,
      QMARK_NO_DOT: QMARK_NO_DOT,
      STAR: STAR,
      START_ANCHOR: START_ANCHOR,
    } = PLATFORM_CHARS;
    const globstar = opts => {
      return `(${capture}(?:(?!${START_ANCHOR}${
        opts.dot ? DOTS_SLASH : DOT_LITERAL
      }).)*?)`;
    };
    const nodot = opts.dot ? '' : NO_DOT;
    const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
    let star = opts.bash === true ? globstar(opts) : STAR;
    if (opts.capture) star = `(${star})`;
    // minimatch options support
    if (typeof opts.noext === 'boolean') opts.noextglob = opts.noext;
    const state = {
      input: input,
      index: -1,
      start: 0,
      dot: opts.dot === true,
      consumed: '',
      output: '',
      prefix: '',
      backtrack: false,
      negated: false,
      brackets: 0,
      braces: 0,
      parens: 0,
      quotes: 0,
      globstar: false,
      tokens: tokens,
    };
    input = $fyIT7.removePrefix(input, state);
    len = input.length;
    const extglobs = [];
    const braces = [];
    const stack = [];
    let prev = bos;
    let value;
    /**
     * Tokenizing helpers
     */ const eos = () => state.index === len - 1;
    const peek = (state.peek = (n = 1) => input[state.index + n]);
    const advance = (state.advance = () => input[++state.index] || '');
    const remaining = () => input.slice(state.index + 1);
    const consume = (value = '', num = 0) => {
      state.consumed += value;
      state.index += num;
    };
    const append = token => {
      state.output += token.output != null ? token.output : token.value;
      consume(token.value);
    };
    const negate = () => {
      let count = 1;
      while (peek() === '!' && (peek(2) !== '(' || peek(3) === '?')) {
        advance();
        state.start++;
        count++;
      }
      if (count % 2 === 0) return false;
      state.negated = true;
      state.start++;
      return true;
    };
    const increment = type => {
      state[type]++;
      stack.push(type);
    };
    const decrement = type => {
      state[type]--;
      stack.pop();
    };
    /**
     * Push tokens onto the tokens array. This helper speeds up
     * tokenizing by 1) helping us avoid backtracking as much as possible,
     * and 2) helping us avoid creating extra tokens when consecutive
     * characters are plain text. This improves performance and simplifies
     * lookbehinds.
     */ const push = tok => {
      if (prev.type === 'globstar') {
        const isBrace =
          state.braces > 0 && (tok.type === 'comma' || tok.type === 'brace');
        const isExtglob =
          tok.extglob === true ||
          (extglobs.length && (tok.type === 'pipe' || tok.type === 'paren'));
        if (
          tok.type !== 'slash' &&
          tok.type !== 'paren' &&
          !isBrace &&
          !isExtglob
        ) {
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = 'star';
          prev.value = '*';
          prev.output = star;
          state.output += prev.output;
        }
      }
      if (extglobs.length && tok.type !== 'paren')
        extglobs[extglobs.length - 1].inner += tok.value;
      if (tok.value || tok.output) append(tok);
      if (prev && prev.type === 'text' && tok.type === 'text') {
        prev.value += tok.value;
        prev.output = (prev.output || '') + tok.value;
        return;
      }
      tok.prev = prev;
      tokens.push(tok);
      prev = tok;
    };
    const extglobOpen = (type, value) => {
      const token = {
        ...EXTGLOB_CHARS[value],
        conditions: 1,
        inner: '',
      };
      token.prev = prev;
      token.parens = state.parens;
      token.output = state.output;
      const output = (opts.capture ? '(' : '') + token.open;
      increment('parens');
      push({
        type: type,
        value: value,
        output: state.output ? '' : ONE_CHAR,
      });
      push({
        type: 'paren',
        extglob: true,
        value: advance(),
        output: output,
      });
      extglobs.push(token);
    };
    const extglobClose = token => {
      let output = token.close + (opts.capture ? ')' : '');
      let rest;
      if (token.type === 'negate') {
        let extglobStar = star;
        if (token.inner && token.inner.length > 1 && token.inner.includes('/'))
          extglobStar = globstar(opts);
        if (extglobStar !== star || eos() || /^\)+$/.test(remaining()))
          output = token.close = `)$))${extglobStar}`;
        if (
          token.inner.includes('*') &&
          (rest = remaining()) &&
          /^\.[^\\/.]+$/.test(rest)
        ) {
          // Any non-magical string (`.ts`) or even nested expression (`.{ts,tsx}`) can follow after the closing parenthesis.
          // In this case, we need to parse the string and use it in the output of the original pattern.
          // Suitable patterns: `/!(*.d).ts`, `/!(*.d).{ts,tsx}`, `**/!(*-dbg).@(js)`.
          //
          // Disabling the `fastpaths` option due to a problem with parsing strings as `.ts` in the pattern like `**/!(*.d).ts`.
          const expression = $c3146d61e2b0930d$var$parse(rest, {
            ...options,
            fastpaths: false,
          }).output;
          output = token.close = `)${expression})${extglobStar})`;
        }
        if (token.prev.type === 'bos') state.negatedExtglob = true;
      }
      push({
        type: 'paren',
        extglob: true,
        value: value,
        output: output,
      });
      decrement('parens');
    };
    /**
     * Fast paths
     */ if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
      let backslashes = false;
      let output = input.replace(
        $c3146d61e2b0930d$var$REGEX_SPECIAL_CHARS_BACKREF,
        (m, esc, chars, first, rest, index) => {
          if (first === '\\') {
            backslashes = true;
            return m;
          }
          if (first === '?') {
            if (esc)
              return esc + first + (rest ? QMARK.repeat(rest.length) : '');
            if (index === 0)
              return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : '');
            return QMARK.repeat(chars.length);
          }
          if (first === '.') return DOT_LITERAL.repeat(chars.length);
          if (first === '*') {
            if (esc) return esc + first + (rest ? star : '');
            return star;
          }
          return esc ? m : `\\${m}`;
        },
      );
      if (backslashes === true) {
        if (opts.unescape === true) output = output.replace(/\\/g, '');
        else
          output = output.replace(/\\+/g, m => {
            return m.length % 2 === 0 ? '\\\\' : m ? '\\' : '';
          });
      }
      if (output === input && opts.contains === true) {
        state.output = input;
        return state;
      }
      state.output = $fyIT7.wrapOutput(output, state, options);
      return state;
    }
    /**
     * Tokenize input until we reach end-of-string
     */ while (!eos()) {
      value = advance();
      if (value === '\0') continue;
      /**
       * Escaped characters
       */ if (value === '\\') {
        const next = peek();
        if (next === '/' && opts.bash !== true) continue;
        if (next === '.' || next === ';') continue;
        if (!next) {
          value += '\\';
          push({
            type: 'text',
            value: value,
          });
          continue;
        }
        // collapse slashes to reduce potential for exploits
        const match = /^\\+/.exec(remaining());
        let slashes = 0;
        if (match && match[0].length > 2) {
          slashes = match[0].length;
          state.index += slashes;
          if (slashes % 2 !== 0) value += '\\';
        }
        if (opts.unescape === true) value = advance();
        else value += advance();
        if (state.brackets === 0) {
          push({
            type: 'text',
            value: value,
          });
          continue;
        }
      }
      /**
       * If we're inside a regex character class, continue
       * until we reach the closing bracket.
       */ if (
        state.brackets > 0 &&
        (value !== ']' || prev.value === '[' || prev.value === '[^')
      ) {
        if (opts.posix !== false && value === ':') {
          const inner = prev.value.slice(1);
          if (inner.includes('[')) {
            prev.posix = true;
            if (inner.includes(':')) {
              const idx = prev.value.lastIndexOf('[');
              const pre = prev.value.slice(0, idx);
              const rest = prev.value.slice(idx + 2);
              const posix = $c3146d61e2b0930d$var$POSIX_REGEX_SOURCE[rest];
              if (posix) {
                prev.value = pre + posix;
                state.backtrack = true;
                advance();
                if (!bos.output && tokens.indexOf(prev) === 1)
                  bos.output = ONE_CHAR;
                continue;
              }
            }
          }
        }
        if (
          (value === '[' && peek() !== ':') ||
          (value === '-' && peek() === ']')
        )
          value = `\\${value}`;
        if (value === ']' && (prev.value === '[' || prev.value === '[^'))
          value = `\\${value}`;
        if (opts.posix === true && value === '!' && prev.value === '[')
          value = '^';
        prev.value += value;
        append({
          value: value,
        });
        continue;
      }
      /**
       * If we're inside a quoted string, continue
       * until we reach the closing double quote.
       */ if (state.quotes === 1 && value !== '"') {
        value = $fyIT7.escapeRegex(value);
        prev.value += value;
        append({
          value: value,
        });
        continue;
      }
      /**
       * Double quotes
       */ if (value === '"') {
        state.quotes = state.quotes === 1 ? 0 : 1;
        if (opts.keepQuotes === true)
          push({
            type: 'text',
            value: value,
          });
        continue;
      }
      /**
       * Parentheses
       */ if (value === '(') {
        increment('parens');
        push({
          type: 'paren',
          value: value,
        });
        continue;
      }
      if (value === ')') {
        if (state.parens === 0 && opts.strictBrackets === true)
          throw new SyntaxError(
            $c3146d61e2b0930d$var$syntaxError('opening', '('),
          );
        const extglob = extglobs[extglobs.length - 1];
        if (extglob && state.parens === extglob.parens + 1) {
          extglobClose(extglobs.pop());
          continue;
        }
        push({
          type: 'paren',
          value: value,
          output: state.parens ? ')' : '\\)',
        });
        decrement('parens');
        continue;
      }
      /**
       * Square brackets
       */ if (value === '[') {
        if (opts.nobracket === true || !remaining().includes(']')) {
          if (opts.nobracket !== true && opts.strictBrackets === true)
            throw new SyntaxError(
              $c3146d61e2b0930d$var$syntaxError('closing', ']'),
            );
          value = `\\${value}`;
        } else increment('brackets');
        push({
          type: 'bracket',
          value: value,
        });
        continue;
      }
      if (value === ']') {
        if (
          opts.nobracket === true ||
          (prev && prev.type === 'bracket' && prev.value.length === 1)
        ) {
          push({
            type: 'text',
            value: value,
            output: `\\${value}`,
          });
          continue;
        }
        if (state.brackets === 0) {
          if (opts.strictBrackets === true)
            throw new SyntaxError(
              $c3146d61e2b0930d$var$syntaxError('opening', '['),
            );
          push({
            type: 'text',
            value: value,
            output: `\\${value}`,
          });
          continue;
        }
        decrement('brackets');
        const prevValue = prev.value.slice(1);
        if (
          prev.posix !== true &&
          prevValue[0] === '^' &&
          !prevValue.includes('/')
        )
          value = `/${value}`;
        prev.value += value;
        append({
          value: value,
        });
        // when literal brackets are explicitly disabled
        // assume we should match with a regex character class
        if (opts.literalBrackets === false || $fyIT7.hasRegexChars(prevValue))
          continue;
        const escaped = $fyIT7.escapeRegex(prev.value);
        state.output = state.output.slice(0, -prev.value.length);
        // when literal brackets are explicitly enabled
        // assume we should escape the brackets to match literal characters
        if (opts.literalBrackets === true) {
          state.output += escaped;
          prev.value = escaped;
          continue;
        }
        // when the user specifies nothing, try to match both
        prev.value = `(${capture}${escaped}|${prev.value})`;
        state.output += prev.value;
        continue;
      }
      /**
       * Braces
       */ if (value === '{' && opts.nobrace !== true) {
        increment('braces');
        const open = {
          type: 'brace',
          value: value,
          output: '(',
          outputIndex: state.output.length,
          tokensIndex: state.tokens.length,
        };
        braces.push(open);
        push(open);
        continue;
      }
      if (value === '}') {
        const brace = braces[braces.length - 1];
        if (opts.nobrace === true || !brace) {
          push({
            type: 'text',
            value: value,
            output: value,
          });
          continue;
        }
        let output = ')';
        if (brace.dots === true) {
          const arr = tokens.slice();
          const range = [];
          for (let i = arr.length - 1; i >= 0; i--) {
            tokens.pop();
            if (arr[i].type === 'brace') break;
            if (arr[i].type !== 'dots') range.unshift(arr[i].value);
          }
          output = $c3146d61e2b0930d$var$expandRange(range, opts);
          state.backtrack = true;
        }
        if (brace.comma !== true && brace.dots !== true) {
          const out = state.output.slice(0, brace.outputIndex);
          const toks = state.tokens.slice(brace.tokensIndex);
          brace.value = brace.output = '\\{';
          value = output = '\\}';
          state.output = out;
          for (const t of toks) state.output += t.output || t.value;
        }
        push({
          type: 'brace',
          value: value,
          output: output,
        });
        decrement('braces');
        braces.pop();
        continue;
      }
      /**
       * Pipes
       */ if (value === '|') {
        if (extglobs.length > 0) extglobs[extglobs.length - 1].conditions++;
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      /**
       * Commas
       */ if (value === ',') {
        let output = value;
        const brace = braces[braces.length - 1];
        if (brace && stack[stack.length - 1] === 'braces') {
          brace.comma = true;
          output = '|';
        }
        push({
          type: 'comma',
          value: value,
          output: output,
        });
        continue;
      }
      /**
       * Slashes
       */ if (value === '/') {
        // if the beginning of the glob is "./", advance the start
        // to the current index, and don't add the "./" characters
        // to the state. This greatly simplifies lookbehinds when
        // checking for BOS characters like "!" and "." (not "./")
        if (prev.type === 'dot' && state.index === state.start + 1) {
          state.start = state.index + 1;
          state.consumed = '';
          state.output = '';
          tokens.pop();
          prev = bos; // reset "prev" to the first token
          continue;
        }
        push({
          type: 'slash',
          value: value,
          output: SLASH_LITERAL,
        });
        continue;
      }
      /**
       * Dots
       */ if (value === '.') {
        if (state.braces > 0 && prev.type === 'dot') {
          if (prev.value === '.') prev.output = DOT_LITERAL;
          const brace = braces[braces.length - 1];
          prev.type = 'dots';
          prev.output += value;
          prev.value += value;
          brace.dots = true;
          continue;
        }
        if (
          state.braces + state.parens === 0 &&
          prev.type !== 'bos' &&
          prev.type !== 'slash'
        ) {
          push({
            type: 'text',
            value: value,
            output: DOT_LITERAL,
          });
          continue;
        }
        push({
          type: 'dot',
          value: value,
          output: DOT_LITERAL,
        });
        continue;
      }
      /**
       * Question marks
       */ if (value === '?') {
        const isGroup = prev && prev.value === '(';
        if (
          !isGroup &&
          opts.noextglob !== true &&
          peek() === '(' &&
          peek(2) !== '?'
        ) {
          extglobOpen('qmark', value);
          continue;
        }
        if (prev && prev.type === 'paren') {
          const next = peek();
          let output = value;
          if (next === '<' && !$fyIT7.supportsLookbehinds())
            throw new Error(
              'Node.js v10 or higher is required for regex lookbehinds',
            );
          if (
            (prev.value === '(' && !/[!=<:]/.test(next)) ||
            (next === '<' && !/<([!=]|\w+>)/.test(remaining()))
          )
            output = `\\${value}`;
          push({
            type: 'text',
            value: value,
            output: output,
          });
          continue;
        }
        if (
          opts.dot !== true &&
          (prev.type === 'slash' || prev.type === 'bos')
        ) {
          push({
            type: 'qmark',
            value: value,
            output: QMARK_NO_DOT,
          });
          continue;
        }
        push({
          type: 'qmark',
          value: value,
          output: QMARK,
        });
        continue;
      }
      /**
       * Exclamation
       */ if (value === '!') {
        if (opts.noextglob !== true && peek() === '(') {
          if (peek(2) !== '?' || !/[!=<:]/.test(peek(3))) {
            extglobOpen('negate', value);
            continue;
          }
        }
        if (opts.nonegate !== true && state.index === 0) {
          negate();
          continue;
        }
      }
      /**
       * Plus
       */ if (value === '+') {
        if (opts.noextglob !== true && peek() === '(' && peek(2) !== '?') {
          extglobOpen('plus', value);
          continue;
        }
        if ((prev && prev.value === '(') || opts.regex === false) {
          push({
            type: 'plus',
            value: value,
            output: PLUS_LITERAL,
          });
          continue;
        }
        if (
          (prev &&
            (prev.type === 'bracket' ||
              prev.type === 'paren' ||
              prev.type === 'brace')) ||
          state.parens > 0
        ) {
          push({
            type: 'plus',
            value: value,
          });
          continue;
        }
        push({
          type: 'plus',
          value: PLUS_LITERAL,
        });
        continue;
      }
      /**
       * Plain text
       */ if (value === '@') {
        if (opts.noextglob !== true && peek() === '(' && peek(2) !== '?') {
          push({
            type: 'at',
            extglob: true,
            value: value,
            output: '',
          });
          continue;
        }
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      /**
       * Plain text
       */ if (value !== '*') {
        if (value === '$' || value === '^') value = `\\${value}`;
        const match = $c3146d61e2b0930d$var$REGEX_NON_SPECIAL_CHARS.exec(
          remaining(),
        );
        if (match) {
          value += match[0];
          state.index += match[0].length;
        }
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      /**
       * Stars
       */ if (prev && (prev.type === 'globstar' || prev.star === true)) {
        prev.type = 'star';
        prev.star = true;
        prev.value += value;
        prev.output = star;
        state.backtrack = true;
        state.globstar = true;
        consume(value);
        continue;
      }
      let rest = remaining();
      if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
        extglobOpen('star', value);
        continue;
      }
      if (prev.type === 'star') {
        if (opts.noglobstar === true) {
          consume(value);
          continue;
        }
        const prior = prev.prev;
        const before = prior.prev;
        const isStart = prior.type === 'slash' || prior.type === 'bos';
        const afterStar =
          before && (before.type === 'star' || before.type === 'globstar');
        if (opts.bash === true && (!isStart || (rest[0] && rest[0] !== '/'))) {
          push({
            type: 'star',
            value: value,
            output: '',
          });
          continue;
        }
        const isBrace =
          state.braces > 0 &&
          (prior.type === 'comma' || prior.type === 'brace');
        const isExtglob =
          extglobs.length && (prior.type === 'pipe' || prior.type === 'paren');
        if (!isStart && prior.type !== 'paren' && !isBrace && !isExtglob) {
          push({
            type: 'star',
            value: value,
            output: '',
          });
          continue;
        }
        // strip consecutive `/**/`
        while (rest.slice(0, 3) === '/**') {
          const after = input[state.index + 4];
          if (after && after !== '/') break;
          rest = rest.slice(3);
          consume('/**', 3);
        }
        if (prior.type === 'bos' && eos()) {
          prev.type = 'globstar';
          prev.value += value;
          prev.output = globstar(opts);
          state.output = prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        if (
          prior.type === 'slash' &&
          prior.prev.type !== 'bos' &&
          !afterStar &&
          eos()
        ) {
          state.output = state.output.slice(
            0,
            -(prior.output + prev.output).length,
          );
          prior.output = `(?:${prior.output}`;
          prev.type = 'globstar';
          prev.output = globstar(opts) + (opts.strictSlashes ? ')' : '|$)');
          prev.value += value;
          state.globstar = true;
          state.output += prior.output + prev.output;
          consume(value);
          continue;
        }
        if (
          prior.type === 'slash' &&
          prior.prev.type !== 'bos' &&
          rest[0] === '/'
        ) {
          const end = rest[1] !== void 0 ? '|$' : '';
          state.output = state.output.slice(
            0,
            -(prior.output + prev.output).length,
          );
          prior.output = `(?:${prior.output}`;
          prev.type = 'globstar';
          prev.output = `${globstar(
            opts,
          )}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
          prev.value += value;
          state.output += prior.output + prev.output;
          state.globstar = true;
          consume(value + advance());
          push({
            type: 'slash',
            value: '/',
            output: '',
          });
          continue;
        }
        if (prior.type === 'bos' && rest[0] === '/') {
          prev.type = 'globstar';
          prev.value += value;
          prev.output = `(?:^|${SLASH_LITERAL}|${globstar(
            opts,
          )}${SLASH_LITERAL})`;
          state.output = prev.output;
          state.globstar = true;
          consume(value + advance());
          push({
            type: 'slash',
            value: '/',
            output: '',
          });
          continue;
        }
        // remove single star from output
        state.output = state.output.slice(0, -prev.output.length);
        // reset previous token to globstar
        prev.type = 'globstar';
        prev.output = globstar(opts);
        prev.value += value;
        // reset output with globstar
        state.output += prev.output;
        state.globstar = true;
        consume(value);
        continue;
      }
      const token = {
        type: 'star',
        value: value,
        output: star,
      };
      if (opts.bash === true) {
        token.output = '.*?';
        if (prev.type === 'bos' || prev.type === 'slash')
          token.output = nodot + token.output;
        push(token);
        continue;
      }
      if (
        prev &&
        (prev.type === 'bracket' || prev.type === 'paren') &&
        opts.regex === true
      ) {
        token.output = value;
        push(token);
        continue;
      }
      if (
        state.index === state.start ||
        prev.type === 'slash' ||
        prev.type === 'dot'
      ) {
        if (prev.type === 'dot') {
          state.output += NO_DOT_SLASH;
          prev.output += NO_DOT_SLASH;
        } else if (opts.dot === true) {
          state.output += NO_DOTS_SLASH;
          prev.output += NO_DOTS_SLASH;
        } else {
          state.output += nodot;
          prev.output += nodot;
        }
        if (peek() !== '*') {
          state.output += ONE_CHAR;
          prev.output += ONE_CHAR;
        }
      }
      push(token);
    }
    while (state.brackets > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(
          $c3146d61e2b0930d$var$syntaxError('closing', ']'),
        );
      state.output = $fyIT7.escapeLast(state.output, '[');
      decrement('brackets');
    }
    while (state.parens > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(
          $c3146d61e2b0930d$var$syntaxError('closing', ')'),
        );
      state.output = $fyIT7.escapeLast(state.output, '(');
      decrement('parens');
    }
    while (state.braces > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(
          $c3146d61e2b0930d$var$syntaxError('closing', '}'),
        );
      state.output = $fyIT7.escapeLast(state.output, '{');
      decrement('braces');
    }
    if (
      opts.strictSlashes !== true &&
      (prev.type === 'star' || prev.type === 'bracket')
    )
      push({
        type: 'maybe_slash',
        value: '',
        output: `${SLASH_LITERAL}?`,
      });
    // rebuild the output if we had to backtrack at any point
    if (state.backtrack === true) {
      state.output = '';
      for (const token of state.tokens) {
        state.output += token.output != null ? token.output : token.value;
        if (token.suffix) state.output += token.suffix;
      }
    }
    return state;
  };
  /**
   * Fast paths for creating regular expressions for common glob patterns.
   * This can significantly speed up processing and has very little downside
   * impact when none of the fast paths match.
   */ $c3146d61e2b0930d$var$parse.fastpaths = (input, options) => {
    const opts = {
      ...options,
    };
    const max =
      typeof opts.maxLength === 'number'
        ? Math.min($c3146d61e2b0930d$var$MAX_LENGTH, opts.maxLength)
        : $c3146d61e2b0930d$var$MAX_LENGTH;
    const len = input.length;
    if (len > max)
      throw new SyntaxError(
        `Input length: ${len}, exceeds maximum allowed length: ${max}`,
      );
    input = $c3146d61e2b0930d$var$REPLACEMENTS[input] || input;
    const win32 = $fyIT7.isWindows(options);
    // create constants based on platform, for windows or posix
    const {
      DOT_LITERAL: DOT_LITERAL,
      SLASH_LITERAL: SLASH_LITERAL,
      ONE_CHAR: ONE_CHAR,
      DOTS_SLASH: DOTS_SLASH,
      NO_DOT: NO_DOT,
      NO_DOTS: NO_DOTS,
      NO_DOTS_SLASH: NO_DOTS_SLASH,
      STAR: STAR,
      START_ANCHOR: START_ANCHOR,
    } = $iMXZJ.globChars(win32);
    const nodot = opts.dot ? NO_DOTS : NO_DOT;
    const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
    const capture = opts.capture ? '' : '?:';
    const state = {
      negated: false,
      prefix: '',
    };
    let star = opts.bash === true ? '.*?' : STAR;
    if (opts.capture) star = `(${star})`;
    const globstar = opts => {
      if (opts.noglobstar === true) return star;
      return `(${capture}(?:(?!${START_ANCHOR}${
        opts.dot ? DOTS_SLASH : DOT_LITERAL
      }).)*?)`;
    };
    const create = str => {
      switch (str) {
        case '*':
          return `${nodot}${ONE_CHAR}${star}`;
        case '.*':
          return `${DOT_LITERAL}${ONE_CHAR}${star}`;
        case '*.*':
          return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case '*/*':
          return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
        case '**':
          return nodot + globstar(opts);
        case '**/*':
          return `(?:${nodot}${globstar(
            opts,
          )}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
        case '**/*.*':
          return `(?:${nodot}${globstar(
            opts,
          )}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case '**/.*':
          return `(?:${nodot}${globstar(
            opts,
          )}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
        default: {
          const match = /^(.*?)\.(\w+)$/.exec(str);
          if (!match) return;
          const source = create(match[1]);
          if (!source) return;
          return source + DOT_LITERAL + match[2];
        }
      }
    };
    const output = $fyIT7.removePrefix(input, state);
    let source = create(output);
    if (source && opts.strictSlashes !== true) source += `${SLASH_LITERAL}?`;
    return source;
  };
  module.exports = $c3146d61e2b0930d$var$parse;
});

parcelRegister('i1UlB', function (module, exports) {
  'use strict';
  var $d204076d004be01c$var$__createBinding =
    (module.exports && module.exports.__createBinding) ||
    (Object.create
      ? function (o, m, k, k2) {
          if (k2 === undefined) k2 = k;
          Object.defineProperty(o, k2, {
            enumerable: true,
            get: function () {
              return m[k];
            },
          });
        }
      : function (o, m, k, k2) {
          if (k2 === undefined) k2 = k;
          o[k2] = m[k];
        });
  var $d204076d004be01c$var$__exportStar =
    (module.exports && module.exports.__exportStar) ||
    function (m, exports1) {
      for (var p in m)
        if (
          p !== 'default' &&
          !Object.prototype.hasOwnProperty.call(exports1, p)
        )
          $d204076d004be01c$var$__createBinding(exports1, m, p);
    };
  Object.defineProperty(module.exports, '__esModule', {
    value: true,
  });

  $d204076d004be01c$var$__exportStar(parcelRequire('gRLxl'), module.exports);
});
parcelRegister('gRLxl', function (module, exports) {
  'use strict';
  Object.defineProperty(module.exports, '__esModule', {
    value: true,
  });
  module.exports.fixRequestBody = module.exports.responseInterceptor = void 0;

  var $5fc6g = parcelRequire('5fc6g');
  Object.defineProperty(module.exports, 'responseInterceptor', {
    enumerable: true,
    get: function () {
      return $5fc6g.responseInterceptor;
    },
  });

  var $5Ajgg = parcelRequire('5Ajgg');
  Object.defineProperty(module.exports, 'fixRequestBody', {
    enumerable: true,
    get: function () {
      return $5Ajgg.fixRequestBody;
    },
  });
});
parcelRegister('5fc6g', function (module, exports) {
  'use strict';
  Object.defineProperty(module.exports, '__esModule', {
    value: true,
  });
  module.exports.responseInterceptor = void 0;

  /**
   * Intercept responses from upstream.
   * Automatically decompress (deflate, gzip, brotli).
   * Give developer the opportunity to modify intercepted Buffer and http.ServerResponse
   *
   * NOTE: must set options.selfHandleResponse=true (prevent automatic call of res.end())
   */ function $3d17bd47af3f866c$var$responseInterceptor(interceptor) {
    return async function proxyRes(proxyRes, req, res) {
      const originalProxyRes = proxyRes;
      let buffer = Buffer.from('', 'utf8');
      // decompress proxy response
      const _proxyRes = $3d17bd47af3f866c$var$decompress(
        proxyRes,
        proxyRes.headers['content-encoding'],
      );
      // concat data stream
      _proxyRes.on('data', chunk => (buffer = Buffer.concat([buffer, chunk])));
      _proxyRes.on('end', async () => {
        // copy original headers
        $3d17bd47af3f866c$var$copyHeaders(proxyRes, res);
        // call interceptor with intercepted response (buffer)
        const interceptedBuffer = Buffer.from(
          await interceptor(buffer, originalProxyRes, req, res),
        );
        // set correct content-length (with double byte character support)
        res.setHeader(
          'content-length',
          Buffer.byteLength(interceptedBuffer, 'utf8'),
        );
        res.write(interceptedBuffer);
        res.end();
      });
      _proxyRes.on('error', error => {
        res.end(`Error fetching proxied request: ${error.message}`);
      });
    };
  }
  module.exports.responseInterceptor =
    $3d17bd47af3f866c$var$responseInterceptor;
  /**
   * Streaming decompression of proxy response
   * source: https://github.com/apache/superset/blob/9773aba522e957ed9423045ca153219638a85d2f/superset-frontend/webpack.proxy-config.js#L116
   */ function $3d17bd47af3f866c$var$decompress(proxyRes, contentEncoding) {
    let _proxyRes = proxyRes;
    let decompress;
    switch (contentEncoding) {
      case 'gzip':
        decompress = $dmXIQ$zlib.createGunzip();
        break;
      case 'br':
        decompress = $dmXIQ$zlib.createBrotliDecompress();
        break;
      case 'deflate':
        decompress = $dmXIQ$zlib.createInflate();
        break;
      default:
        break;
    }
    if (decompress) {
      _proxyRes.pipe(decompress);
      _proxyRes = decompress;
    }
    return _proxyRes;
  }
  /**
   * Copy original headers
   * https://github.com/apache/superset/blob/9773aba522e957ed9423045ca153219638a85d2f/superset-frontend/webpack.proxy-config.js#L78
   */ function $3d17bd47af3f866c$var$copyHeaders(originalResponse, response) {
    response.statusCode = originalResponse.statusCode;
    response.statusMessage = originalResponse.statusMessage;
    if (response.setHeader) {
      let keys = Object.keys(originalResponse.headers);
      // ignore chunked, brotli, gzip, deflate headers
      keys = keys.filter(
        key => !['content-encoding', 'transfer-encoding'].includes(key),
      );
      keys.forEach(key => {
        let value = originalResponse.headers[key];
        if (key === 'set-cookie') {
          // remove cookie domain
          value = Array.isArray(value) ? value : [value];
          value = value.map(x => x.replace(/Domain=[^;]+?/i, ''));
        }
        response.setHeader(key, value);
      });
    } else response.headers = originalResponse.headers;
  }
});

parcelRegister('5Ajgg', function (module, exports) {
  'use strict';
  Object.defineProperty(module.exports, '__esModule', {
    value: true,
  });
  module.exports.fixRequestBody = void 0;

  /**
   * Fix proxied body if bodyParser is involved.
   */ function $410f41728be2c15a$var$fixRequestBody(proxyReq, req) {
    const requestBody = req.body;
    if (!requestBody || !Object.keys(requestBody).length) return;
    const contentType = proxyReq.getHeader('Content-Type');
    const writeBody = bodyData => {
      // deepcode ignore ContentLengthInCode: bodyParser fix
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    };
    if (contentType && contentType.includes('application/json'))
      writeBody(JSON.stringify(requestBody));
    if (contentType === 'application/x-www-form-urlencoded')
      writeBody($dmXIQ$querystring.stringify(requestBody));
  }
  module.exports.fixRequestBody = $410f41728be2c15a$var$fixRequestBody;
});

parcelRegister('gpqFG', function (module, exports) {
  module.exports = JSON.parse(
    '{"application/1d-interleaved-parityfec":{"source":"iana"},"application/3gpdash-qoe-report+xml":{"source":"iana"},"application/3gpp-ims+xml":{"source":"iana"},"application/a2l":{"source":"iana"},"application/activemessage":{"source":"iana"},"application/alto-costmap+json":{"source":"iana","compressible":true},"application/alto-costmapfilter+json":{"source":"iana","compressible":true},"application/alto-directory+json":{"source":"iana","compressible":true},"application/alto-endpointcost+json":{"source":"iana","compressible":true},"application/alto-endpointcostparams+json":{"source":"iana","compressible":true},"application/alto-endpointprop+json":{"source":"iana","compressible":true},"application/alto-endpointpropparams+json":{"source":"iana","compressible":true},"application/alto-error+json":{"source":"iana","compressible":true},"application/alto-networkmap+json":{"source":"iana","compressible":true},"application/alto-networkmapfilter+json":{"source":"iana","compressible":true},"application/aml":{"source":"iana"},"application/andrew-inset":{"source":"iana","extensions":["ez"]},"application/applefile":{"source":"iana"},"application/applixware":{"source":"apache","extensions":["aw"]},"application/atf":{"source":"iana"},"application/atfx":{"source":"iana"},"application/atom+xml":{"source":"iana","compressible":true,"extensions":["atom"]},"application/atomcat+xml":{"source":"iana","extensions":["atomcat"]},"application/atomdeleted+xml":{"source":"iana"},"application/atomicmail":{"source":"iana"},"application/atomsvc+xml":{"source":"iana","extensions":["atomsvc"]},"application/atxml":{"source":"iana"},"application/auth-policy+xml":{"source":"iana"},"application/bacnet-xdd+zip":{"source":"iana"},"application/batch-smtp":{"source":"iana"},"application/bdoc":{"compressible":false,"extensions":["bdoc"]},"application/beep+xml":{"source":"iana"},"application/calendar+json":{"source":"iana","compressible":true},"application/calendar+xml":{"source":"iana"},"application/call-completion":{"source":"iana"},"application/cals-1840":{"source":"iana"},"application/cbor":{"source":"iana"},"application/cccex":{"source":"iana"},"application/ccmp+xml":{"source":"iana"},"application/ccxml+xml":{"source":"iana","extensions":["ccxml"]},"application/cdfx+xml":{"source":"iana"},"application/cdmi-capability":{"source":"iana","extensions":["cdmia"]},"application/cdmi-container":{"source":"iana","extensions":["cdmic"]},"application/cdmi-domain":{"source":"iana","extensions":["cdmid"]},"application/cdmi-object":{"source":"iana","extensions":["cdmio"]},"application/cdmi-queue":{"source":"iana","extensions":["cdmiq"]},"application/cdni":{"source":"iana"},"application/cea":{"source":"iana"},"application/cea-2018+xml":{"source":"iana"},"application/cellml+xml":{"source":"iana"},"application/cfw":{"source":"iana"},"application/clue_info+xml":{"source":"iana"},"application/cms":{"source":"iana"},"application/cnrp+xml":{"source":"iana"},"application/coap-group+json":{"source":"iana","compressible":true},"application/coap-payload":{"source":"iana"},"application/commonground":{"source":"iana"},"application/conference-info+xml":{"source":"iana"},"application/cose":{"source":"iana"},"application/cose-key":{"source":"iana"},"application/cose-key-set":{"source":"iana"},"application/cpl+xml":{"source":"iana"},"application/csrattrs":{"source":"iana"},"application/csta+xml":{"source":"iana"},"application/cstadata+xml":{"source":"iana"},"application/csvm+json":{"source":"iana","compressible":true},"application/cu-seeme":{"source":"apache","extensions":["cu"]},"application/cybercash":{"source":"iana"},"application/dart":{"compressible":true},"application/dash+xml":{"source":"iana","extensions":["mpd"]},"application/dashdelta":{"source":"iana"},"application/davmount+xml":{"source":"iana","extensions":["davmount"]},"application/dca-rft":{"source":"iana"},"application/dcd":{"source":"iana"},"application/dec-dx":{"source":"iana"},"application/dialog-info+xml":{"source":"iana"},"application/dicom":{"source":"iana"},"application/dicom+json":{"source":"iana","compressible":true},"application/dicom+xml":{"source":"iana"},"application/dii":{"source":"iana"},"application/dit":{"source":"iana"},"application/dns":{"source":"iana"},"application/docbook+xml":{"source":"apache","extensions":["dbk"]},"application/dskpp+xml":{"source":"iana"},"application/dssc+der":{"source":"iana","extensions":["dssc"]},"application/dssc+xml":{"source":"iana","extensions":["xdssc"]},"application/dvcs":{"source":"iana"},"application/ecmascript":{"source":"iana","compressible":true,"extensions":["ecma"]},"application/edi-consent":{"source":"iana"},"application/edi-x12":{"source":"iana","compressible":false},"application/edifact":{"source":"iana","compressible":false},"application/efi":{"source":"iana"},"application/emergencycalldata.comment+xml":{"source":"iana"},"application/emergencycalldata.control+xml":{"source":"iana"},"application/emergencycalldata.deviceinfo+xml":{"source":"iana"},"application/emergencycalldata.ecall.msd":{"source":"iana"},"application/emergencycalldata.providerinfo+xml":{"source":"iana"},"application/emergencycalldata.serviceinfo+xml":{"source":"iana"},"application/emergencycalldata.subscriberinfo+xml":{"source":"iana"},"application/emergencycalldata.veds+xml":{"source":"iana"},"application/emma+xml":{"source":"iana","extensions":["emma"]},"application/emotionml+xml":{"source":"iana"},"application/encaprtp":{"source":"iana"},"application/epp+xml":{"source":"iana"},"application/epub+zip":{"source":"iana","extensions":["epub"]},"application/eshop":{"source":"iana"},"application/exi":{"source":"iana","extensions":["exi"]},"application/fastinfoset":{"source":"iana"},"application/fastsoap":{"source":"iana"},"application/fdt+xml":{"source":"iana"},"application/fhir+xml":{"source":"iana"},"application/fido.trusted-apps+json":{"compressible":true},"application/fits":{"source":"iana"},"application/font-sfnt":{"source":"iana"},"application/font-tdpfr":{"source":"iana","extensions":["pfr"]},"application/font-woff":{"source":"iana","compressible":false,"extensions":["woff"]},"application/framework-attributes+xml":{"source":"iana"},"application/geo+json":{"source":"iana","compressible":true,"extensions":["geojson"]},"application/geo+json-seq":{"source":"iana"},"application/geoxacml+xml":{"source":"iana"},"application/gml+xml":{"source":"iana","extensions":["gml"]},"application/gpx+xml":{"source":"apache","extensions":["gpx"]},"application/gxf":{"source":"apache","extensions":["gxf"]},"application/gzip":{"source":"iana","compressible":false,"extensions":["gz"]},"application/h224":{"source":"iana"},"application/held+xml":{"source":"iana"},"application/hjson":{"extensions":["hjson"]},"application/http":{"source":"iana"},"application/hyperstudio":{"source":"iana","extensions":["stk"]},"application/ibe-key-request+xml":{"source":"iana"},"application/ibe-pkg-reply+xml":{"source":"iana"},"application/ibe-pp-data":{"source":"iana"},"application/iges":{"source":"iana"},"application/im-iscomposing+xml":{"source":"iana"},"application/index":{"source":"iana"},"application/index.cmd":{"source":"iana"},"application/index.obj":{"source":"iana"},"application/index.response":{"source":"iana"},"application/index.vnd":{"source":"iana"},"application/inkml+xml":{"source":"iana","extensions":["ink","inkml"]},"application/iotp":{"source":"iana"},"application/ipfix":{"source":"iana","extensions":["ipfix"]},"application/ipp":{"source":"iana"},"application/isup":{"source":"iana"},"application/its+xml":{"source":"iana"},"application/java-archive":{"source":"apache","compressible":false,"extensions":["jar","war","ear"]},"application/java-serialized-object":{"source":"apache","compressible":false,"extensions":["ser"]},"application/java-vm":{"source":"apache","compressible":false,"extensions":["class"]},"application/javascript":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["js","mjs"]},"application/jf2feed+json":{"source":"iana","compressible":true},"application/jose":{"source":"iana"},"application/jose+json":{"source":"iana","compressible":true},"application/jrd+json":{"source":"iana","compressible":true},"application/json":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["json","map"]},"application/json-patch+json":{"source":"iana","compressible":true},"application/json-seq":{"source":"iana"},"application/json5":{"extensions":["json5"]},"application/jsonml+json":{"source":"apache","compressible":true,"extensions":["jsonml"]},"application/jwk+json":{"source":"iana","compressible":true},"application/jwk-set+json":{"source":"iana","compressible":true},"application/jwt":{"source":"iana"},"application/kpml-request+xml":{"source":"iana"},"application/kpml-response+xml":{"source":"iana"},"application/ld+json":{"source":"iana","compressible":true,"extensions":["jsonld"]},"application/lgr+xml":{"source":"iana"},"application/link-format":{"source":"iana"},"application/load-control+xml":{"source":"iana"},"application/lost+xml":{"source":"iana","extensions":["lostxml"]},"application/lostsync+xml":{"source":"iana"},"application/lxf":{"source":"iana"},"application/mac-binhex40":{"source":"iana","extensions":["hqx"]},"application/mac-compactpro":{"source":"apache","extensions":["cpt"]},"application/macwriteii":{"source":"iana"},"application/mads+xml":{"source":"iana","extensions":["mads"]},"application/manifest+json":{"charset":"UTF-8","compressible":true,"extensions":["webmanifest"]},"application/marc":{"source":"iana","extensions":["mrc"]},"application/marcxml+xml":{"source":"iana","extensions":["mrcx"]},"application/mathematica":{"source":"iana","extensions":["ma","nb","mb"]},"application/mathml+xml":{"source":"iana","extensions":["mathml"]},"application/mathml-content+xml":{"source":"iana"},"application/mathml-presentation+xml":{"source":"iana"},"application/mbms-associated-procedure-description+xml":{"source":"iana"},"application/mbms-deregister+xml":{"source":"iana"},"application/mbms-envelope+xml":{"source":"iana"},"application/mbms-msk+xml":{"source":"iana"},"application/mbms-msk-response+xml":{"source":"iana"},"application/mbms-protection-description+xml":{"source":"iana"},"application/mbms-reception-report+xml":{"source":"iana"},"application/mbms-register+xml":{"source":"iana"},"application/mbms-register-response+xml":{"source":"iana"},"application/mbms-schedule+xml":{"source":"iana"},"application/mbms-user-service-description+xml":{"source":"iana"},"application/mbox":{"source":"iana","extensions":["mbox"]},"application/media-policy-dataset+xml":{"source":"iana"},"application/media_control+xml":{"source":"iana"},"application/mediaservercontrol+xml":{"source":"iana","extensions":["mscml"]},"application/merge-patch+json":{"source":"iana","compressible":true},"application/metalink+xml":{"source":"apache","extensions":["metalink"]},"application/metalink4+xml":{"source":"iana","extensions":["meta4"]},"application/mets+xml":{"source":"iana","extensions":["mets"]},"application/mf4":{"source":"iana"},"application/mikey":{"source":"iana"},"application/mmt-usd+xml":{"source":"iana"},"application/mods+xml":{"source":"iana","extensions":["mods"]},"application/moss-keys":{"source":"iana"},"application/moss-signature":{"source":"iana"},"application/mosskey-data":{"source":"iana"},"application/mosskey-request":{"source":"iana"},"application/mp21":{"source":"iana","extensions":["m21","mp21"]},"application/mp4":{"source":"iana","extensions":["mp4s","m4p"]},"application/mpeg4-generic":{"source":"iana"},"application/mpeg4-iod":{"source":"iana"},"application/mpeg4-iod-xmt":{"source":"iana"},"application/mrb-consumer+xml":{"source":"iana"},"application/mrb-publish+xml":{"source":"iana"},"application/msc-ivr+xml":{"source":"iana"},"application/msc-mixer+xml":{"source":"iana"},"application/msword":{"source":"iana","compressible":false,"extensions":["doc","dot"]},"application/mud+json":{"source":"iana","compressible":true},"application/mxf":{"source":"iana","extensions":["mxf"]},"application/n-quads":{"source":"iana"},"application/n-triples":{"source":"iana"},"application/nasdata":{"source":"iana"},"application/news-checkgroups":{"source":"iana"},"application/news-groupinfo":{"source":"iana"},"application/news-transmission":{"source":"iana"},"application/nlsml+xml":{"source":"iana"},"application/node":{"source":"iana"},"application/nss":{"source":"iana"},"application/ocsp-request":{"source":"iana"},"application/ocsp-response":{"source":"iana"},"application/octet-stream":{"source":"iana","compressible":false,"extensions":["bin","dms","lrf","mar","so","dist","distz","pkg","bpk","dump","elc","deploy","exe","dll","deb","dmg","iso","img","msi","msp","msm","buffer"]},"application/oda":{"source":"iana","extensions":["oda"]},"application/odx":{"source":"iana"},"application/oebps-package+xml":{"source":"iana","extensions":["opf"]},"application/ogg":{"source":"iana","compressible":false,"extensions":["ogx"]},"application/omdoc+xml":{"source":"apache","extensions":["omdoc"]},"application/onenote":{"source":"apache","extensions":["onetoc","onetoc2","onetmp","onepkg"]},"application/oxps":{"source":"iana","extensions":["oxps"]},"application/p2p-overlay+xml":{"source":"iana"},"application/parityfec":{"source":"iana"},"application/passport":{"source":"iana"},"application/patch-ops-error+xml":{"source":"iana","extensions":["xer"]},"application/pdf":{"source":"iana","compressible":false,"extensions":["pdf"]},"application/pdx":{"source":"iana"},"application/pgp-encrypted":{"source":"iana","compressible":false,"extensions":["pgp"]},"application/pgp-keys":{"source":"iana"},"application/pgp-signature":{"source":"iana","extensions":["asc","sig"]},"application/pics-rules":{"source":"apache","extensions":["prf"]},"application/pidf+xml":{"source":"iana"},"application/pidf-diff+xml":{"source":"iana"},"application/pkcs10":{"source":"iana","extensions":["p10"]},"application/pkcs12":{"source":"iana"},"application/pkcs7-mime":{"source":"iana","extensions":["p7m","p7c"]},"application/pkcs7-signature":{"source":"iana","extensions":["p7s"]},"application/pkcs8":{"source":"iana","extensions":["p8"]},"application/pkcs8-encrypted":{"source":"iana"},"application/pkix-attr-cert":{"source":"iana","extensions":["ac"]},"application/pkix-cert":{"source":"iana","extensions":["cer"]},"application/pkix-crl":{"source":"iana","extensions":["crl"]},"application/pkix-pkipath":{"source":"iana","extensions":["pkipath"]},"application/pkixcmp":{"source":"iana","extensions":["pki"]},"application/pls+xml":{"source":"iana","extensions":["pls"]},"application/poc-settings+xml":{"source":"iana"},"application/postscript":{"source":"iana","compressible":true,"extensions":["ai","eps","ps"]},"application/ppsp-tracker+json":{"source":"iana","compressible":true},"application/problem+json":{"source":"iana","compressible":true},"application/problem+xml":{"source":"iana"},"application/provenance+xml":{"source":"iana"},"application/prs.alvestrand.titrax-sheet":{"source":"iana"},"application/prs.cww":{"source":"iana","extensions":["cww"]},"application/prs.hpub+zip":{"source":"iana"},"application/prs.nprend":{"source":"iana"},"application/prs.plucker":{"source":"iana"},"application/prs.rdf-xml-crypt":{"source":"iana"},"application/prs.xsf+xml":{"source":"iana"},"application/pskc+xml":{"source":"iana","extensions":["pskcxml"]},"application/qsig":{"source":"iana"},"application/raml+yaml":{"compressible":true,"extensions":["raml"]},"application/raptorfec":{"source":"iana"},"application/rdap+json":{"source":"iana","compressible":true},"application/rdf+xml":{"source":"iana","compressible":true,"extensions":["rdf"]},"application/reginfo+xml":{"source":"iana","extensions":["rif"]},"application/relax-ng-compact-syntax":{"source":"iana","extensions":["rnc"]},"application/remote-printing":{"source":"iana"},"application/reputon+json":{"source":"iana","compressible":true},"application/resource-lists+xml":{"source":"iana","extensions":["rl"]},"application/resource-lists-diff+xml":{"source":"iana","extensions":["rld"]},"application/rfc+xml":{"source":"iana"},"application/riscos":{"source":"iana"},"application/rlmi+xml":{"source":"iana"},"application/rls-services+xml":{"source":"iana","extensions":["rs"]},"application/route-apd+xml":{"source":"iana"},"application/route-s-tsid+xml":{"source":"iana"},"application/route-usd+xml":{"source":"iana"},"application/rpki-ghostbusters":{"source":"iana","extensions":["gbr"]},"application/rpki-manifest":{"source":"iana","extensions":["mft"]},"application/rpki-publication":{"source":"iana"},"application/rpki-roa":{"source":"iana","extensions":["roa"]},"application/rpki-updown":{"source":"iana"},"application/rsd+xml":{"source":"apache","extensions":["rsd"]},"application/rss+xml":{"source":"apache","compressible":true,"extensions":["rss"]},"application/rtf":{"source":"iana","compressible":true,"extensions":["rtf"]},"application/rtploopback":{"source":"iana"},"application/rtx":{"source":"iana"},"application/samlassertion+xml":{"source":"iana"},"application/samlmetadata+xml":{"source":"iana"},"application/sbml+xml":{"source":"iana","extensions":["sbml"]},"application/scaip+xml":{"source":"iana"},"application/scim+json":{"source":"iana","compressible":true},"application/scvp-cv-request":{"source":"iana","extensions":["scq"]},"application/scvp-cv-response":{"source":"iana","extensions":["scs"]},"application/scvp-vp-request":{"source":"iana","extensions":["spq"]},"application/scvp-vp-response":{"source":"iana","extensions":["spp"]},"application/sdp":{"source":"iana","extensions":["sdp"]},"application/sep+xml":{"source":"iana"},"application/sep-exi":{"source":"iana"},"application/session-info":{"source":"iana"},"application/set-payment":{"source":"iana"},"application/set-payment-initiation":{"source":"iana","extensions":["setpay"]},"application/set-registration":{"source":"iana"},"application/set-registration-initiation":{"source":"iana","extensions":["setreg"]},"application/sgml":{"source":"iana"},"application/sgml-open-catalog":{"source":"iana"},"application/shf+xml":{"source":"iana","extensions":["shf"]},"application/sieve":{"source":"iana"},"application/simple-filter+xml":{"source":"iana"},"application/simple-message-summary":{"source":"iana"},"application/simplesymbolcontainer":{"source":"iana"},"application/slate":{"source":"iana"},"application/smil":{"source":"iana"},"application/smil+xml":{"source":"iana","extensions":["smi","smil"]},"application/smpte336m":{"source":"iana"},"application/soap+fastinfoset":{"source":"iana"},"application/soap+xml":{"source":"iana","compressible":true},"application/sparql-query":{"source":"iana","extensions":["rq"]},"application/sparql-results+xml":{"source":"iana","extensions":["srx"]},"application/spirits-event+xml":{"source":"iana"},"application/sql":{"source":"iana"},"application/srgs":{"source":"iana","extensions":["gram"]},"application/srgs+xml":{"source":"iana","extensions":["grxml"]},"application/sru+xml":{"source":"iana","extensions":["sru"]},"application/ssdl+xml":{"source":"apache","extensions":["ssdl"]},"application/ssml+xml":{"source":"iana","extensions":["ssml"]},"application/tamp-apex-update":{"source":"iana"},"application/tamp-apex-update-confirm":{"source":"iana"},"application/tamp-community-update":{"source":"iana"},"application/tamp-community-update-confirm":{"source":"iana"},"application/tamp-error":{"source":"iana"},"application/tamp-sequence-adjust":{"source":"iana"},"application/tamp-sequence-adjust-confirm":{"source":"iana"},"application/tamp-status-query":{"source":"iana"},"application/tamp-status-response":{"source":"iana"},"application/tamp-update":{"source":"iana"},"application/tamp-update-confirm":{"source":"iana"},"application/tar":{"compressible":true},"application/tei+xml":{"source":"iana","extensions":["tei","teicorpus"]},"application/thraud+xml":{"source":"iana","extensions":["tfi"]},"application/timestamp-query":{"source":"iana"},"application/timestamp-reply":{"source":"iana"},"application/timestamped-data":{"source":"iana","extensions":["tsd"]},"application/tnauthlist":{"source":"iana"},"application/trig":{"source":"iana"},"application/ttml+xml":{"source":"iana"},"application/tve-trigger":{"source":"iana"},"application/ulpfec":{"source":"iana"},"application/urc-grpsheet+xml":{"source":"iana"},"application/urc-ressheet+xml":{"source":"iana"},"application/urc-targetdesc+xml":{"source":"iana"},"application/urc-uisocketdesc+xml":{"source":"iana"},"application/vcard+json":{"source":"iana","compressible":true},"application/vcard+xml":{"source":"iana"},"application/vemmi":{"source":"iana"},"application/vividence.scriptfile":{"source":"apache"},"application/vnd.1000minds.decision-model+xml":{"source":"iana"},"application/vnd.3gpp-prose+xml":{"source":"iana"},"application/vnd.3gpp-prose-pc3ch+xml":{"source":"iana"},"application/vnd.3gpp-v2x-local-service-information":{"source":"iana"},"application/vnd.3gpp.access-transfer-events+xml":{"source":"iana"},"application/vnd.3gpp.bsf+xml":{"source":"iana"},"application/vnd.3gpp.gmop+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-affiliation-command+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-floor-request+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-location-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-mbms-usage-info+xml":{"source":"iana"},"application/vnd.3gpp.mcptt-signed+xml":{"source":"iana"},"application/vnd.3gpp.mid-call+xml":{"source":"iana"},"application/vnd.3gpp.pic-bw-large":{"source":"iana","extensions":["plb"]},"application/vnd.3gpp.pic-bw-small":{"source":"iana","extensions":["psb"]},"application/vnd.3gpp.pic-bw-var":{"source":"iana","extensions":["pvb"]},"application/vnd.3gpp.sms":{"source":"iana"},"application/vnd.3gpp.sms+xml":{"source":"iana"},"application/vnd.3gpp.srvcc-ext+xml":{"source":"iana"},"application/vnd.3gpp.srvcc-info+xml":{"source":"iana"},"application/vnd.3gpp.state-and-event-info+xml":{"source":"iana"},"application/vnd.3gpp.ussd+xml":{"source":"iana"},"application/vnd.3gpp2.bcmcsinfo+xml":{"source":"iana"},"application/vnd.3gpp2.sms":{"source":"iana"},"application/vnd.3gpp2.tcap":{"source":"iana","extensions":["tcap"]},"application/vnd.3lightssoftware.imagescal":{"source":"iana"},"application/vnd.3m.post-it-notes":{"source":"iana","extensions":["pwn"]},"application/vnd.accpac.simply.aso":{"source":"iana","extensions":["aso"]},"application/vnd.accpac.simply.imp":{"source":"iana","extensions":["imp"]},"application/vnd.acucobol":{"source":"iana","extensions":["acu"]},"application/vnd.acucorp":{"source":"iana","extensions":["atc","acutc"]},"application/vnd.adobe.air-application-installer-package+zip":{"source":"apache","extensions":["air"]},"application/vnd.adobe.flash.movie":{"source":"iana"},"application/vnd.adobe.formscentral.fcdt":{"source":"iana","extensions":["fcdt"]},"application/vnd.adobe.fxp":{"source":"iana","extensions":["fxp","fxpl"]},"application/vnd.adobe.partial-upload":{"source":"iana"},"application/vnd.adobe.xdp+xml":{"source":"iana","extensions":["xdp"]},"application/vnd.adobe.xfdf":{"source":"iana","extensions":["xfdf"]},"application/vnd.aether.imp":{"source":"iana"},"application/vnd.ah-barcode":{"source":"iana"},"application/vnd.ahead.space":{"source":"iana","extensions":["ahead"]},"application/vnd.airzip.filesecure.azf":{"source":"iana","extensions":["azf"]},"application/vnd.airzip.filesecure.azs":{"source":"iana","extensions":["azs"]},"application/vnd.amadeus+json":{"source":"iana","compressible":true},"application/vnd.amazon.ebook":{"source":"apache","extensions":["azw"]},"application/vnd.amazon.mobi8-ebook":{"source":"iana"},"application/vnd.americandynamics.acc":{"source":"iana","extensions":["acc"]},"application/vnd.amiga.ami":{"source":"iana","extensions":["ami"]},"application/vnd.amundsen.maze+xml":{"source":"iana"},"application/vnd.android.package-archive":{"source":"apache","compressible":false,"extensions":["apk"]},"application/vnd.anki":{"source":"iana"},"application/vnd.anser-web-certificate-issue-initiation":{"source":"iana","extensions":["cii"]},"application/vnd.anser-web-funds-transfer-initiation":{"source":"apache","extensions":["fti"]},"application/vnd.antix.game-component":{"source":"iana","extensions":["atx"]},"application/vnd.apache.thrift.binary":{"source":"iana"},"application/vnd.apache.thrift.compact":{"source":"iana"},"application/vnd.apache.thrift.json":{"source":"iana"},"application/vnd.api+json":{"source":"iana","compressible":true},"application/vnd.apothekende.reservation+json":{"source":"iana","compressible":true},"application/vnd.apple.installer+xml":{"source":"iana","extensions":["mpkg"]},"application/vnd.apple.mpegurl":{"source":"iana","extensions":["m3u8"]},"application/vnd.apple.pkpass":{"compressible":false,"extensions":["pkpass"]},"application/vnd.arastra.swi":{"source":"iana"},"application/vnd.aristanetworks.swi":{"source":"iana","extensions":["swi"]},"application/vnd.artsquare":{"source":"iana"},"application/vnd.astraea-software.iota":{"source":"iana","extensions":["iota"]},"application/vnd.audiograph":{"source":"iana","extensions":["aep"]},"application/vnd.autopackage":{"source":"iana"},"application/vnd.avalon+json":{"source":"iana","compressible":true},"application/vnd.avistar+xml":{"source":"iana"},"application/vnd.balsamiq.bmml+xml":{"source":"iana"},"application/vnd.balsamiq.bmpr":{"source":"iana"},"application/vnd.bbf.usp.msg":{"source":"iana"},"application/vnd.bbf.usp.msg+json":{"source":"iana","compressible":true},"application/vnd.bekitzur-stech+json":{"source":"iana","compressible":true},"application/vnd.bint.med-content":{"source":"iana"},"application/vnd.biopax.rdf+xml":{"source":"iana"},"application/vnd.blink-idb-value-wrapper":{"source":"iana"},"application/vnd.blueice.multipass":{"source":"iana","extensions":["mpm"]},"application/vnd.bluetooth.ep.oob":{"source":"iana"},"application/vnd.bluetooth.le.oob":{"source":"iana"},"application/vnd.bmi":{"source":"iana","extensions":["bmi"]},"application/vnd.businessobjects":{"source":"iana","extensions":["rep"]},"application/vnd.cab-jscript":{"source":"iana"},"application/vnd.canon-cpdl":{"source":"iana"},"application/vnd.canon-lips":{"source":"iana"},"application/vnd.capasystems-pg+json":{"source":"iana","compressible":true},"application/vnd.cendio.thinlinc.clientconf":{"source":"iana"},"application/vnd.century-systems.tcp_stream":{"source":"iana"},"application/vnd.chemdraw+xml":{"source":"iana","extensions":["cdxml"]},"application/vnd.chess-pgn":{"source":"iana"},"application/vnd.chipnuts.karaoke-mmd":{"source":"iana","extensions":["mmd"]},"application/vnd.cinderella":{"source":"iana","extensions":["cdy"]},"application/vnd.cirpack.isdn-ext":{"source":"iana"},"application/vnd.citationstyles.style+xml":{"source":"iana"},"application/vnd.claymore":{"source":"iana","extensions":["cla"]},"application/vnd.cloanto.rp9":{"source":"iana","extensions":["rp9"]},"application/vnd.clonk.c4group":{"source":"iana","extensions":["c4g","c4d","c4f","c4p","c4u"]},"application/vnd.cluetrust.cartomobile-config":{"source":"iana","extensions":["c11amc"]},"application/vnd.cluetrust.cartomobile-config-pkg":{"source":"iana","extensions":["c11amz"]},"application/vnd.coffeescript":{"source":"iana"},"application/vnd.collabio.xodocuments.document":{"source":"iana"},"application/vnd.collabio.xodocuments.document-template":{"source":"iana"},"application/vnd.collabio.xodocuments.presentation":{"source":"iana"},"application/vnd.collabio.xodocuments.presentation-template":{"source":"iana"},"application/vnd.collabio.xodocuments.spreadsheet":{"source":"iana"},"application/vnd.collabio.xodocuments.spreadsheet-template":{"source":"iana"},"application/vnd.collection+json":{"source":"iana","compressible":true},"application/vnd.collection.doc+json":{"source":"iana","compressible":true},"application/vnd.collection.next+json":{"source":"iana","compressible":true},"application/vnd.comicbook+zip":{"source":"iana"},"application/vnd.comicbook-rar":{"source":"iana"},"application/vnd.commerce-battelle":{"source":"iana"},"application/vnd.commonspace":{"source":"iana","extensions":["csp"]},"application/vnd.contact.cmsg":{"source":"iana","extensions":["cdbcmsg"]},"application/vnd.coreos.ignition+json":{"source":"iana","compressible":true},"application/vnd.cosmocaller":{"source":"iana","extensions":["cmc"]},"application/vnd.crick.clicker":{"source":"iana","extensions":["clkx"]},"application/vnd.crick.clicker.keyboard":{"source":"iana","extensions":["clkk"]},"application/vnd.crick.clicker.palette":{"source":"iana","extensions":["clkp"]},"application/vnd.crick.clicker.template":{"source":"iana","extensions":["clkt"]},"application/vnd.crick.clicker.wordbank":{"source":"iana","extensions":["clkw"]},"application/vnd.criticaltools.wbs+xml":{"source":"iana","extensions":["wbs"]},"application/vnd.ctc-posml":{"source":"iana","extensions":["pml"]},"application/vnd.ctct.ws+xml":{"source":"iana"},"application/vnd.cups-pdf":{"source":"iana"},"application/vnd.cups-postscript":{"source":"iana"},"application/vnd.cups-ppd":{"source":"iana","extensions":["ppd"]},"application/vnd.cups-raster":{"source":"iana"},"application/vnd.cups-raw":{"source":"iana"},"application/vnd.curl":{"source":"iana"},"application/vnd.curl.car":{"source":"apache","extensions":["car"]},"application/vnd.curl.pcurl":{"source":"apache","extensions":["pcurl"]},"application/vnd.cyan.dean.root+xml":{"source":"iana"},"application/vnd.cybank":{"source":"iana"},"application/vnd.d2l.coursepackage1p0+zip":{"source":"iana"},"application/vnd.dart":{"source":"iana","compressible":true,"extensions":["dart"]},"application/vnd.data-vision.rdz":{"source":"iana","extensions":["rdz"]},"application/vnd.datapackage+json":{"source":"iana","compressible":true},"application/vnd.dataresource+json":{"source":"iana","compressible":true},"application/vnd.debian.binary-package":{"source":"iana"},"application/vnd.dece.data":{"source":"iana","extensions":["uvf","uvvf","uvd","uvvd"]},"application/vnd.dece.ttml+xml":{"source":"iana","extensions":["uvt","uvvt"]},"application/vnd.dece.unspecified":{"source":"iana","extensions":["uvx","uvvx"]},"application/vnd.dece.zip":{"source":"iana","extensions":["uvz","uvvz"]},"application/vnd.denovo.fcselayout-link":{"source":"iana","extensions":["fe_launch"]},"application/vnd.desmume-movie":{"source":"iana"},"application/vnd.desmume.movie":{"source":"apache"},"application/vnd.dir-bi.plate-dl-nosuffix":{"source":"iana"},"application/vnd.dm.delegation+xml":{"source":"iana"},"application/vnd.dna":{"source":"iana","extensions":["dna"]},"application/vnd.document+json":{"source":"iana","compressible":true},"application/vnd.dolby.mlp":{"source":"apache","extensions":["mlp"]},"application/vnd.dolby.mobile.1":{"source":"iana"},"application/vnd.dolby.mobile.2":{"source":"iana"},"application/vnd.doremir.scorecloud-binary-document":{"source":"iana"},"application/vnd.dpgraph":{"source":"iana","extensions":["dpg"]},"application/vnd.dreamfactory":{"source":"iana","extensions":["dfac"]},"application/vnd.drive+json":{"source":"iana","compressible":true},"application/vnd.ds-keypoint":{"source":"apache","extensions":["kpxx"]},"application/vnd.dtg.local":{"source":"iana"},"application/vnd.dtg.local.flash":{"source":"iana"},"application/vnd.dtg.local.html":{"source":"iana"},"application/vnd.dvb.ait":{"source":"iana","extensions":["ait"]},"application/vnd.dvb.dvbj":{"source":"iana"},"application/vnd.dvb.esgcontainer":{"source":"iana"},"application/vnd.dvb.ipdcdftnotifaccess":{"source":"iana"},"application/vnd.dvb.ipdcesgaccess":{"source":"iana"},"application/vnd.dvb.ipdcesgaccess2":{"source":"iana"},"application/vnd.dvb.ipdcesgpdd":{"source":"iana"},"application/vnd.dvb.ipdcroaming":{"source":"iana"},"application/vnd.dvb.iptv.alfec-base":{"source":"iana"},"application/vnd.dvb.iptv.alfec-enhancement":{"source":"iana"},"application/vnd.dvb.notif-aggregate-root+xml":{"source":"iana"},"application/vnd.dvb.notif-container+xml":{"source":"iana"},"application/vnd.dvb.notif-generic+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-msglist+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-registration-request+xml":{"source":"iana"},"application/vnd.dvb.notif-ia-registration-response+xml":{"source":"iana"},"application/vnd.dvb.notif-init+xml":{"source":"iana"},"application/vnd.dvb.pfr":{"source":"iana"},"application/vnd.dvb.service":{"source":"iana","extensions":["svc"]},"application/vnd.dxr":{"source":"iana"},"application/vnd.dynageo":{"source":"iana","extensions":["geo"]},"application/vnd.dzr":{"source":"iana"},"application/vnd.easykaraoke.cdgdownload":{"source":"iana"},"application/vnd.ecdis-update":{"source":"iana"},"application/vnd.ecip.rlp":{"source":"iana"},"application/vnd.ecowin.chart":{"source":"iana","extensions":["mag"]},"application/vnd.ecowin.filerequest":{"source":"iana"},"application/vnd.ecowin.fileupdate":{"source":"iana"},"application/vnd.ecowin.series":{"source":"iana"},"application/vnd.ecowin.seriesrequest":{"source":"iana"},"application/vnd.ecowin.seriesupdate":{"source":"iana"},"application/vnd.efi.img":{"source":"iana"},"application/vnd.efi.iso":{"source":"iana"},"application/vnd.emclient.accessrequest+xml":{"source":"iana"},"application/vnd.enliven":{"source":"iana","extensions":["nml"]},"application/vnd.enphase.envoy":{"source":"iana"},"application/vnd.eprints.data+xml":{"source":"iana"},"application/vnd.epson.esf":{"source":"iana","extensions":["esf"]},"application/vnd.epson.msf":{"source":"iana","extensions":["msf"]},"application/vnd.epson.quickanime":{"source":"iana","extensions":["qam"]},"application/vnd.epson.salt":{"source":"iana","extensions":["slt"]},"application/vnd.epson.ssf":{"source":"iana","extensions":["ssf"]},"application/vnd.ericsson.quickcall":{"source":"iana"},"application/vnd.espass-espass+zip":{"source":"iana"},"application/vnd.eszigno3+xml":{"source":"iana","extensions":["es3","et3"]},"application/vnd.etsi.aoc+xml":{"source":"iana"},"application/vnd.etsi.asic-e+zip":{"source":"iana"},"application/vnd.etsi.asic-s+zip":{"source":"iana"},"application/vnd.etsi.cug+xml":{"source":"iana"},"application/vnd.etsi.iptvcommand+xml":{"source":"iana"},"application/vnd.etsi.iptvdiscovery+xml":{"source":"iana"},"application/vnd.etsi.iptvprofile+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-bc+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-cod+xml":{"source":"iana"},"application/vnd.etsi.iptvsad-npvr+xml":{"source":"iana"},"application/vnd.etsi.iptvservice+xml":{"source":"iana"},"application/vnd.etsi.iptvsync+xml":{"source":"iana"},"application/vnd.etsi.iptvueprofile+xml":{"source":"iana"},"application/vnd.etsi.mcid+xml":{"source":"iana"},"application/vnd.etsi.mheg5":{"source":"iana"},"application/vnd.etsi.overload-control-policy-dataset+xml":{"source":"iana"},"application/vnd.etsi.pstn+xml":{"source":"iana"},"application/vnd.etsi.sci+xml":{"source":"iana"},"application/vnd.etsi.simservs+xml":{"source":"iana"},"application/vnd.etsi.timestamp-token":{"source":"iana"},"application/vnd.etsi.tsl+xml":{"source":"iana"},"application/vnd.etsi.tsl.der":{"source":"iana"},"application/vnd.eudora.data":{"source":"iana"},"application/vnd.evolv.ecig.profile":{"source":"iana"},"application/vnd.evolv.ecig.settings":{"source":"iana"},"application/vnd.evolv.ecig.theme":{"source":"iana"},"application/vnd.ezpix-album":{"source":"iana","extensions":["ez2"]},"application/vnd.ezpix-package":{"source":"iana","extensions":["ez3"]},"application/vnd.f-secure.mobile":{"source":"iana"},"application/vnd.fastcopy-disk-image":{"source":"iana"},"application/vnd.fdf":{"source":"iana","extensions":["fdf"]},"application/vnd.fdsn.mseed":{"source":"iana","extensions":["mseed"]},"application/vnd.fdsn.seed":{"source":"iana","extensions":["seed","dataless"]},"application/vnd.ffsns":{"source":"iana"},"application/vnd.filmit.zfc":{"source":"iana"},"application/vnd.fints":{"source":"iana"},"application/vnd.firemonkeys.cloudcell":{"source":"iana"},"application/vnd.flographit":{"source":"iana","extensions":["gph"]},"application/vnd.fluxtime.clip":{"source":"iana","extensions":["ftc"]},"application/vnd.font-fontforge-sfd":{"source":"iana"},"application/vnd.framemaker":{"source":"iana","extensions":["fm","frame","maker","book"]},"application/vnd.frogans.fnc":{"source":"iana","extensions":["fnc"]},"application/vnd.frogans.ltf":{"source":"iana","extensions":["ltf"]},"application/vnd.fsc.weblaunch":{"source":"iana","extensions":["fsc"]},"application/vnd.fujitsu.oasys":{"source":"iana","extensions":["oas"]},"application/vnd.fujitsu.oasys2":{"source":"iana","extensions":["oa2"]},"application/vnd.fujitsu.oasys3":{"source":"iana","extensions":["oa3"]},"application/vnd.fujitsu.oasysgp":{"source":"iana","extensions":["fg5"]},"application/vnd.fujitsu.oasysprs":{"source":"iana","extensions":["bh2"]},"application/vnd.fujixerox.art-ex":{"source":"iana"},"application/vnd.fujixerox.art4":{"source":"iana"},"application/vnd.fujixerox.ddd":{"source":"iana","extensions":["ddd"]},"application/vnd.fujixerox.docuworks":{"source":"iana","extensions":["xdw"]},"application/vnd.fujixerox.docuworks.binder":{"source":"iana","extensions":["xbd"]},"application/vnd.fujixerox.docuworks.container":{"source":"iana"},"application/vnd.fujixerox.hbpl":{"source":"iana"},"application/vnd.fut-misnet":{"source":"iana"},"application/vnd.fuzzysheet":{"source":"iana","extensions":["fzs"]},"application/vnd.genomatix.tuxedo":{"source":"iana","extensions":["txd"]},"application/vnd.geo+json":{"source":"iana","compressible":true},"application/vnd.geocube+xml":{"source":"iana"},"application/vnd.geogebra.file":{"source":"iana","extensions":["ggb"]},"application/vnd.geogebra.tool":{"source":"iana","extensions":["ggt"]},"application/vnd.geometry-explorer":{"source":"iana","extensions":["gex","gre"]},"application/vnd.geonext":{"source":"iana","extensions":["gxt"]},"application/vnd.geoplan":{"source":"iana","extensions":["g2w"]},"application/vnd.geospace":{"source":"iana","extensions":["g3w"]},"application/vnd.gerber":{"source":"iana"},"application/vnd.globalplatform.card-content-mgt":{"source":"iana"},"application/vnd.globalplatform.card-content-mgt-response":{"source":"iana"},"application/vnd.gmx":{"source":"iana","extensions":["gmx"]},"application/vnd.google-apps.document":{"compressible":false,"extensions":["gdoc"]},"application/vnd.google-apps.presentation":{"compressible":false,"extensions":["gslides"]},"application/vnd.google-apps.spreadsheet":{"compressible":false,"extensions":["gsheet"]},"application/vnd.google-earth.kml+xml":{"source":"iana","compressible":true,"extensions":["kml"]},"application/vnd.google-earth.kmz":{"source":"iana","compressible":false,"extensions":["kmz"]},"application/vnd.gov.sk.e-form+xml":{"source":"iana"},"application/vnd.gov.sk.e-form+zip":{"source":"iana"},"application/vnd.gov.sk.xmldatacontainer+xml":{"source":"iana"},"application/vnd.grafeq":{"source":"iana","extensions":["gqf","gqs"]},"application/vnd.gridmp":{"source":"iana"},"application/vnd.groove-account":{"source":"iana","extensions":["gac"]},"application/vnd.groove-help":{"source":"iana","extensions":["ghf"]},"application/vnd.groove-identity-message":{"source":"iana","extensions":["gim"]},"application/vnd.groove-injector":{"source":"iana","extensions":["grv"]},"application/vnd.groove-tool-message":{"source":"iana","extensions":["gtm"]},"application/vnd.groove-tool-template":{"source":"iana","extensions":["tpl"]},"application/vnd.groove-vcard":{"source":"iana","extensions":["vcg"]},"application/vnd.hal+json":{"source":"iana","compressible":true},"application/vnd.hal+xml":{"source":"iana","extensions":["hal"]},"application/vnd.handheld-entertainment+xml":{"source":"iana","extensions":["zmm"]},"application/vnd.hbci":{"source":"iana","extensions":["hbci"]},"application/vnd.hc+json":{"source":"iana","compressible":true},"application/vnd.hcl-bireports":{"source":"iana"},"application/vnd.hdt":{"source":"iana"},"application/vnd.heroku+json":{"source":"iana","compressible":true},"application/vnd.hhe.lesson-player":{"source":"iana","extensions":["les"]},"application/vnd.hp-hpgl":{"source":"iana","extensions":["hpgl"]},"application/vnd.hp-hpid":{"source":"iana","extensions":["hpid"]},"application/vnd.hp-hps":{"source":"iana","extensions":["hps"]},"application/vnd.hp-jlyt":{"source":"iana","extensions":["jlt"]},"application/vnd.hp-pcl":{"source":"iana","extensions":["pcl"]},"application/vnd.hp-pclxl":{"source":"iana","extensions":["pclxl"]},"application/vnd.httphone":{"source":"iana"},"application/vnd.hydrostatix.sof-data":{"source":"iana","extensions":["sfd-hdstx"]},"application/vnd.hyper-item+json":{"source":"iana","compressible":true},"application/vnd.hyperdrive+json":{"source":"iana","compressible":true},"application/vnd.hzn-3d-crossword":{"source":"iana"},"application/vnd.ibm.afplinedata":{"source":"iana"},"application/vnd.ibm.electronic-media":{"source":"iana"},"application/vnd.ibm.minipay":{"source":"iana","extensions":["mpy"]},"application/vnd.ibm.modcap":{"source":"iana","extensions":["afp","listafp","list3820"]},"application/vnd.ibm.rights-management":{"source":"iana","extensions":["irm"]},"application/vnd.ibm.secure-container":{"source":"iana","extensions":["sc"]},"application/vnd.iccprofile":{"source":"iana","extensions":["icc","icm"]},"application/vnd.ieee.1905":{"source":"iana"},"application/vnd.igloader":{"source":"iana","extensions":["igl"]},"application/vnd.imagemeter.folder+zip":{"source":"iana"},"application/vnd.imagemeter.image+zip":{"source":"iana"},"application/vnd.immervision-ivp":{"source":"iana","extensions":["ivp"]},"application/vnd.immervision-ivu":{"source":"iana","extensions":["ivu"]},"application/vnd.ims.imsccv1p1":{"source":"iana"},"application/vnd.ims.imsccv1p2":{"source":"iana"},"application/vnd.ims.imsccv1p3":{"source":"iana"},"application/vnd.ims.lis.v2.result+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolconsumerprofile+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolproxy+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolproxy.id+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolsettings+json":{"source":"iana","compressible":true},"application/vnd.ims.lti.v2.toolsettings.simple+json":{"source":"iana","compressible":true},"application/vnd.informedcontrol.rms+xml":{"source":"iana"},"application/vnd.informix-visionary":{"source":"iana"},"application/vnd.infotech.project":{"source":"iana"},"application/vnd.infotech.project+xml":{"source":"iana"},"application/vnd.innopath.wamp.notification":{"source":"iana"},"application/vnd.insors.igm":{"source":"iana","extensions":["igm"]},"application/vnd.intercon.formnet":{"source":"iana","extensions":["xpw","xpx"]},"application/vnd.intergeo":{"source":"iana","extensions":["i2g"]},"application/vnd.intertrust.digibox":{"source":"iana"},"application/vnd.intertrust.nncp":{"source":"iana"},"application/vnd.intu.qbo":{"source":"iana","extensions":["qbo"]},"application/vnd.intu.qfx":{"source":"iana","extensions":["qfx"]},"application/vnd.iptc.g2.catalogitem+xml":{"source":"iana"},"application/vnd.iptc.g2.conceptitem+xml":{"source":"iana"},"application/vnd.iptc.g2.knowledgeitem+xml":{"source":"iana"},"application/vnd.iptc.g2.newsitem+xml":{"source":"iana"},"application/vnd.iptc.g2.newsmessage+xml":{"source":"iana"},"application/vnd.iptc.g2.packageitem+xml":{"source":"iana"},"application/vnd.iptc.g2.planningitem+xml":{"source":"iana"},"application/vnd.ipunplugged.rcprofile":{"source":"iana","extensions":["rcprofile"]},"application/vnd.irepository.package+xml":{"source":"iana","extensions":["irp"]},"application/vnd.is-xpr":{"source":"iana","extensions":["xpr"]},"application/vnd.isac.fcs":{"source":"iana","extensions":["fcs"]},"application/vnd.jam":{"source":"iana","extensions":["jam"]},"application/vnd.japannet-directory-service":{"source":"iana"},"application/vnd.japannet-jpnstore-wakeup":{"source":"iana"},"application/vnd.japannet-payment-wakeup":{"source":"iana"},"application/vnd.japannet-registration":{"source":"iana"},"application/vnd.japannet-registration-wakeup":{"source":"iana"},"application/vnd.japannet-setstore-wakeup":{"source":"iana"},"application/vnd.japannet-verification":{"source":"iana"},"application/vnd.japannet-verification-wakeup":{"source":"iana"},"application/vnd.jcp.javame.midlet-rms":{"source":"iana","extensions":["rms"]},"application/vnd.jisp":{"source":"iana","extensions":["jisp"]},"application/vnd.joost.joda-archive":{"source":"iana","extensions":["joda"]},"application/vnd.jsk.isdn-ngn":{"source":"iana"},"application/vnd.kahootz":{"source":"iana","extensions":["ktz","ktr"]},"application/vnd.kde.karbon":{"source":"iana","extensions":["karbon"]},"application/vnd.kde.kchart":{"source":"iana","extensions":["chrt"]},"application/vnd.kde.kformula":{"source":"iana","extensions":["kfo"]},"application/vnd.kde.kivio":{"source":"iana","extensions":["flw"]},"application/vnd.kde.kontour":{"source":"iana","extensions":["kon"]},"application/vnd.kde.kpresenter":{"source":"iana","extensions":["kpr","kpt"]},"application/vnd.kde.kspread":{"source":"iana","extensions":["ksp"]},"application/vnd.kde.kword":{"source":"iana","extensions":["kwd","kwt"]},"application/vnd.kenameaapp":{"source":"iana","extensions":["htke"]},"application/vnd.kidspiration":{"source":"iana","extensions":["kia"]},"application/vnd.kinar":{"source":"iana","extensions":["kne","knp"]},"application/vnd.koan":{"source":"iana","extensions":["skp","skd","skt","skm"]},"application/vnd.kodak-descriptor":{"source":"iana","extensions":["sse"]},"application/vnd.las.las+json":{"source":"iana","compressible":true},"application/vnd.las.las+xml":{"source":"iana","extensions":["lasxml"]},"application/vnd.liberty-request+xml":{"source":"iana"},"application/vnd.llamagraphics.life-balance.desktop":{"source":"iana","extensions":["lbd"]},"application/vnd.llamagraphics.life-balance.exchange+xml":{"source":"iana","extensions":["lbe"]},"application/vnd.lotus-1-2-3":{"source":"iana","extensions":["123"]},"application/vnd.lotus-approach":{"source":"iana","extensions":["apr"]},"application/vnd.lotus-freelance":{"source":"iana","extensions":["pre"]},"application/vnd.lotus-notes":{"source":"iana","extensions":["nsf"]},"application/vnd.lotus-organizer":{"source":"iana","extensions":["org"]},"application/vnd.lotus-screencam":{"source":"iana","extensions":["scm"]},"application/vnd.lotus-wordpro":{"source":"iana","extensions":["lwp"]},"application/vnd.macports.portpkg":{"source":"iana","extensions":["portpkg"]},"application/vnd.mapbox-vector-tile":{"source":"iana"},"application/vnd.marlin.drm.actiontoken+xml":{"source":"iana"},"application/vnd.marlin.drm.conftoken+xml":{"source":"iana"},"application/vnd.marlin.drm.license+xml":{"source":"iana"},"application/vnd.marlin.drm.mdcf":{"source":"iana"},"application/vnd.mason+json":{"source":"iana","compressible":true},"application/vnd.maxmind.maxmind-db":{"source":"iana"},"application/vnd.mcd":{"source":"iana","extensions":["mcd"]},"application/vnd.medcalcdata":{"source":"iana","extensions":["mc1"]},"application/vnd.mediastation.cdkey":{"source":"iana","extensions":["cdkey"]},"application/vnd.meridian-slingshot":{"source":"iana"},"application/vnd.mfer":{"source":"iana","extensions":["mwf"]},"application/vnd.mfmp":{"source":"iana","extensions":["mfm"]},"application/vnd.micro+json":{"source":"iana","compressible":true},"application/vnd.micrografx.flo":{"source":"iana","extensions":["flo"]},"application/vnd.micrografx.igx":{"source":"iana","extensions":["igx"]},"application/vnd.microsoft.portable-executable":{"source":"iana"},"application/vnd.microsoft.windows.thumbnail-cache":{"source":"iana"},"application/vnd.miele+json":{"source":"iana","compressible":true},"application/vnd.mif":{"source":"iana","extensions":["mif"]},"application/vnd.minisoft-hp3000-save":{"source":"iana"},"application/vnd.mitsubishi.misty-guard.trustweb":{"source":"iana"},"application/vnd.mobius.daf":{"source":"iana","extensions":["daf"]},"application/vnd.mobius.dis":{"source":"iana","extensions":["dis"]},"application/vnd.mobius.mbk":{"source":"iana","extensions":["mbk"]},"application/vnd.mobius.mqy":{"source":"iana","extensions":["mqy"]},"application/vnd.mobius.msl":{"source":"iana","extensions":["msl"]},"application/vnd.mobius.plc":{"source":"iana","extensions":["plc"]},"application/vnd.mobius.txf":{"source":"iana","extensions":["txf"]},"application/vnd.mophun.application":{"source":"iana","extensions":["mpn"]},"application/vnd.mophun.certificate":{"source":"iana","extensions":["mpc"]},"application/vnd.motorola.flexsuite":{"source":"iana"},"application/vnd.motorola.flexsuite.adsi":{"source":"iana"},"application/vnd.motorola.flexsuite.fis":{"source":"iana"},"application/vnd.motorola.flexsuite.gotap":{"source":"iana"},"application/vnd.motorola.flexsuite.kmr":{"source":"iana"},"application/vnd.motorola.flexsuite.ttc":{"source":"iana"},"application/vnd.motorola.flexsuite.wem":{"source":"iana"},"application/vnd.motorola.iprm":{"source":"iana"},"application/vnd.mozilla.xul+xml":{"source":"iana","compressible":true,"extensions":["xul"]},"application/vnd.ms-3mfdocument":{"source":"iana"},"application/vnd.ms-artgalry":{"source":"iana","extensions":["cil"]},"application/vnd.ms-asf":{"source":"iana"},"application/vnd.ms-cab-compressed":{"source":"iana","extensions":["cab"]},"application/vnd.ms-color.iccprofile":{"source":"apache"},"application/vnd.ms-excel":{"source":"iana","compressible":false,"extensions":["xls","xlm","xla","xlc","xlt","xlw"]},"application/vnd.ms-excel.addin.macroenabled.12":{"source":"iana","extensions":["xlam"]},"application/vnd.ms-excel.sheet.binary.macroenabled.12":{"source":"iana","extensions":["xlsb"]},"application/vnd.ms-excel.sheet.macroenabled.12":{"source":"iana","extensions":["xlsm"]},"application/vnd.ms-excel.template.macroenabled.12":{"source":"iana","extensions":["xltm"]},"application/vnd.ms-fontobject":{"source":"iana","compressible":true,"extensions":["eot"]},"application/vnd.ms-htmlhelp":{"source":"iana","extensions":["chm"]},"application/vnd.ms-ims":{"source":"iana","extensions":["ims"]},"application/vnd.ms-lrm":{"source":"iana","extensions":["lrm"]},"application/vnd.ms-office.activex+xml":{"source":"iana"},"application/vnd.ms-officetheme":{"source":"iana","extensions":["thmx"]},"application/vnd.ms-opentype":{"source":"apache","compressible":true},"application/vnd.ms-outlook":{"compressible":false,"extensions":["msg"]},"application/vnd.ms-package.obfuscated-opentype":{"source":"apache"},"application/vnd.ms-pki.seccat":{"source":"apache","extensions":["cat"]},"application/vnd.ms-pki.stl":{"source":"apache","extensions":["stl"]},"application/vnd.ms-playready.initiator+xml":{"source":"iana"},"application/vnd.ms-powerpoint":{"source":"iana","compressible":false,"extensions":["ppt","pps","pot"]},"application/vnd.ms-powerpoint.addin.macroenabled.12":{"source":"iana","extensions":["ppam"]},"application/vnd.ms-powerpoint.presentation.macroenabled.12":{"source":"iana","extensions":["pptm"]},"application/vnd.ms-powerpoint.slide.macroenabled.12":{"source":"iana","extensions":["sldm"]},"application/vnd.ms-powerpoint.slideshow.macroenabled.12":{"source":"iana","extensions":["ppsm"]},"application/vnd.ms-powerpoint.template.macroenabled.12":{"source":"iana","extensions":["potm"]},"application/vnd.ms-printdevicecapabilities+xml":{"source":"iana"},"application/vnd.ms-printing.printticket+xml":{"source":"apache"},"application/vnd.ms-printschematicket+xml":{"source":"iana"},"application/vnd.ms-project":{"source":"iana","extensions":["mpp","mpt"]},"application/vnd.ms-tnef":{"source":"iana"},"application/vnd.ms-windows.devicepairing":{"source":"iana"},"application/vnd.ms-windows.nwprinting.oob":{"source":"iana"},"application/vnd.ms-windows.printerpairing":{"source":"iana"},"application/vnd.ms-windows.wsd.oob":{"source":"iana"},"application/vnd.ms-wmdrm.lic-chlg-req":{"source":"iana"},"application/vnd.ms-wmdrm.lic-resp":{"source":"iana"},"application/vnd.ms-wmdrm.meter-chlg-req":{"source":"iana"},"application/vnd.ms-wmdrm.meter-resp":{"source":"iana"},"application/vnd.ms-word.document.macroenabled.12":{"source":"iana","extensions":["docm"]},"application/vnd.ms-word.template.macroenabled.12":{"source":"iana","extensions":["dotm"]},"application/vnd.ms-works":{"source":"iana","extensions":["wps","wks","wcm","wdb"]},"application/vnd.ms-wpl":{"source":"iana","extensions":["wpl"]},"application/vnd.ms-xpsdocument":{"source":"iana","compressible":false,"extensions":["xps"]},"application/vnd.msa-disk-image":{"source":"iana"},"application/vnd.mseq":{"source":"iana","extensions":["mseq"]},"application/vnd.msign":{"source":"iana"},"application/vnd.multiad.creator":{"source":"iana"},"application/vnd.multiad.creator.cif":{"source":"iana"},"application/vnd.music-niff":{"source":"iana"},"application/vnd.musician":{"source":"iana","extensions":["mus"]},"application/vnd.muvee.style":{"source":"iana","extensions":["msty"]},"application/vnd.mynfc":{"source":"iana","extensions":["taglet"]},"application/vnd.ncd.control":{"source":"iana"},"application/vnd.ncd.reference":{"source":"iana"},"application/vnd.nearst.inv+json":{"source":"iana","compressible":true},"application/vnd.nervana":{"source":"iana"},"application/vnd.netfpx":{"source":"iana"},"application/vnd.neurolanguage.nlu":{"source":"iana","extensions":["nlu"]},"application/vnd.nintendo.nitro.rom":{"source":"iana"},"application/vnd.nintendo.snes.rom":{"source":"iana"},"application/vnd.nitf":{"source":"iana","extensions":["ntf","nitf"]},"application/vnd.noblenet-directory":{"source":"iana","extensions":["nnd"]},"application/vnd.noblenet-sealer":{"source":"iana","extensions":["nns"]},"application/vnd.noblenet-web":{"source":"iana","extensions":["nnw"]},"application/vnd.nokia.catalogs":{"source":"iana"},"application/vnd.nokia.conml+wbxml":{"source":"iana"},"application/vnd.nokia.conml+xml":{"source":"iana"},"application/vnd.nokia.iptv.config+xml":{"source":"iana"},"application/vnd.nokia.isds-radio-presets":{"source":"iana"},"application/vnd.nokia.landmark+wbxml":{"source":"iana"},"application/vnd.nokia.landmark+xml":{"source":"iana"},"application/vnd.nokia.landmarkcollection+xml":{"source":"iana"},"application/vnd.nokia.n-gage.ac+xml":{"source":"iana"},"application/vnd.nokia.n-gage.data":{"source":"iana","extensions":["ngdat"]},"application/vnd.nokia.n-gage.symbian.install":{"source":"iana","extensions":["n-gage"]},"application/vnd.nokia.ncd":{"source":"iana"},"application/vnd.nokia.pcd+wbxml":{"source":"iana"},"application/vnd.nokia.pcd+xml":{"source":"iana"},"application/vnd.nokia.radio-preset":{"source":"iana","extensions":["rpst"]},"application/vnd.nokia.radio-presets":{"source":"iana","extensions":["rpss"]},"application/vnd.novadigm.edm":{"source":"iana","extensions":["edm"]},"application/vnd.novadigm.edx":{"source":"iana","extensions":["edx"]},"application/vnd.novadigm.ext":{"source":"iana","extensions":["ext"]},"application/vnd.ntt-local.content-share":{"source":"iana"},"application/vnd.ntt-local.file-transfer":{"source":"iana"},"application/vnd.ntt-local.ogw_remote-access":{"source":"iana"},"application/vnd.ntt-local.sip-ta_remote":{"source":"iana"},"application/vnd.ntt-local.sip-ta_tcp_stream":{"source":"iana"},"application/vnd.oasis.opendocument.chart":{"source":"iana","extensions":["odc"]},"application/vnd.oasis.opendocument.chart-template":{"source":"iana","extensions":["otc"]},"application/vnd.oasis.opendocument.database":{"source":"iana","extensions":["odb"]},"application/vnd.oasis.opendocument.formula":{"source":"iana","extensions":["odf"]},"application/vnd.oasis.opendocument.formula-template":{"source":"iana","extensions":["odft"]},"application/vnd.oasis.opendocument.graphics":{"source":"iana","compressible":false,"extensions":["odg"]},"application/vnd.oasis.opendocument.graphics-template":{"source":"iana","extensions":["otg"]},"application/vnd.oasis.opendocument.image":{"source":"iana","extensions":["odi"]},"application/vnd.oasis.opendocument.image-template":{"source":"iana","extensions":["oti"]},"application/vnd.oasis.opendocument.presentation":{"source":"iana","compressible":false,"extensions":["odp"]},"application/vnd.oasis.opendocument.presentation-template":{"source":"iana","extensions":["otp"]},"application/vnd.oasis.opendocument.spreadsheet":{"source":"iana","compressible":false,"extensions":["ods"]},"application/vnd.oasis.opendocument.spreadsheet-template":{"source":"iana","extensions":["ots"]},"application/vnd.oasis.opendocument.text":{"source":"iana","compressible":false,"extensions":["odt"]},"application/vnd.oasis.opendocument.text-master":{"source":"iana","extensions":["odm"]},"application/vnd.oasis.opendocument.text-template":{"source":"iana","extensions":["ott"]},"application/vnd.oasis.opendocument.text-web":{"source":"iana","extensions":["oth"]},"application/vnd.obn":{"source":"iana"},"application/vnd.ocf+cbor":{"source":"iana"},"application/vnd.oftn.l10n+json":{"source":"iana","compressible":true},"application/vnd.oipf.contentaccessdownload+xml":{"source":"iana"},"application/vnd.oipf.contentaccessstreaming+xml":{"source":"iana"},"application/vnd.oipf.cspg-hexbinary":{"source":"iana"},"application/vnd.oipf.dae.svg+xml":{"source":"iana"},"application/vnd.oipf.dae.xhtml+xml":{"source":"iana"},"application/vnd.oipf.mippvcontrolmessage+xml":{"source":"iana"},"application/vnd.oipf.pae.gem":{"source":"iana"},"application/vnd.oipf.spdiscovery+xml":{"source":"iana"},"application/vnd.oipf.spdlist+xml":{"source":"iana"},"application/vnd.oipf.ueprofile+xml":{"source":"iana"},"application/vnd.oipf.userprofile+xml":{"source":"iana"},"application/vnd.olpc-sugar":{"source":"iana","extensions":["xo"]},"application/vnd.oma-scws-config":{"source":"iana"},"application/vnd.oma-scws-http-request":{"source":"iana"},"application/vnd.oma-scws-http-response":{"source":"iana"},"application/vnd.oma.bcast.associated-procedure-parameter+xml":{"source":"iana"},"application/vnd.oma.bcast.drm-trigger+xml":{"source":"iana"},"application/vnd.oma.bcast.imd+xml":{"source":"iana"},"application/vnd.oma.bcast.ltkm":{"source":"iana"},"application/vnd.oma.bcast.notification+xml":{"source":"iana"},"application/vnd.oma.bcast.provisioningtrigger":{"source":"iana"},"application/vnd.oma.bcast.sgboot":{"source":"iana"},"application/vnd.oma.bcast.sgdd+xml":{"source":"iana"},"application/vnd.oma.bcast.sgdu":{"source":"iana"},"application/vnd.oma.bcast.simple-symbol-container":{"source":"iana"},"application/vnd.oma.bcast.smartcard-trigger+xml":{"source":"iana"},"application/vnd.oma.bcast.sprov+xml":{"source":"iana"},"application/vnd.oma.bcast.stkm":{"source":"iana"},"application/vnd.oma.cab-address-book+xml":{"source":"iana"},"application/vnd.oma.cab-feature-handler+xml":{"source":"iana"},"application/vnd.oma.cab-pcc+xml":{"source":"iana"},"application/vnd.oma.cab-subs-invite+xml":{"source":"iana"},"application/vnd.oma.cab-user-prefs+xml":{"source":"iana"},"application/vnd.oma.dcd":{"source":"iana"},"application/vnd.oma.dcdc":{"source":"iana"},"application/vnd.oma.dd2+xml":{"source":"iana","extensions":["dd2"]},"application/vnd.oma.drm.risd+xml":{"source":"iana"},"application/vnd.oma.group-usage-list+xml":{"source":"iana"},"application/vnd.oma.lwm2m+json":{"source":"iana","compressible":true},"application/vnd.oma.lwm2m+tlv":{"source":"iana"},"application/vnd.oma.pal+xml":{"source":"iana"},"application/vnd.oma.poc.detailed-progress-report+xml":{"source":"iana"},"application/vnd.oma.poc.final-report+xml":{"source":"iana"},"application/vnd.oma.poc.groups+xml":{"source":"iana"},"application/vnd.oma.poc.invocation-descriptor+xml":{"source":"iana"},"application/vnd.oma.poc.optimized-progress-report+xml":{"source":"iana"},"application/vnd.oma.push":{"source":"iana"},"application/vnd.oma.scidm.messages+xml":{"source":"iana"},"application/vnd.oma.xcap-directory+xml":{"source":"iana"},"application/vnd.omads-email+xml":{"source":"iana"},"application/vnd.omads-file+xml":{"source":"iana"},"application/vnd.omads-folder+xml":{"source":"iana"},"application/vnd.omaloc-supl-init":{"source":"iana"},"application/vnd.onepager":{"source":"iana"},"application/vnd.onepagertamp":{"source":"iana"},"application/vnd.onepagertamx":{"source":"iana"},"application/vnd.onepagertat":{"source":"iana"},"application/vnd.onepagertatp":{"source":"iana"},"application/vnd.onepagertatx":{"source":"iana"},"application/vnd.openblox.game+xml":{"source":"iana"},"application/vnd.openblox.game-binary":{"source":"iana"},"application/vnd.openeye.oeb":{"source":"iana"},"application/vnd.openofficeorg.extension":{"source":"apache","extensions":["oxt"]},"application/vnd.openstreetmap.data+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.custom-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.customxmlproperties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawing+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.chart+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.extended-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.presentation":{"source":"iana","compressible":false,"extensions":["pptx"]},"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.presprops+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slide":{"source":"iana","extensions":["sldx"]},"application/vnd.openxmlformats-officedocument.presentationml.slide+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slideshow":{"source":"iana","extensions":["ppsx"]},"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.tags+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.template":{"source":"iana","extensions":["potx"]},"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":{"source":"iana","compressible":false,"extensions":["xlsx"]},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.template":{"source":"iana","extensions":["xltx"]},"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.theme+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.themeoverride+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.vmldrawing":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.document":{"source":"iana","compressible":false,"extensions":["docx"]},"application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.template":{"source":"iana","extensions":["dotx"]},"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml":{"source":"iana"},"application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml":{"source":"iana"},"application/vnd.openxmlformats-package.core-properties+xml":{"source":"iana"},"application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml":{"source":"iana"},"application/vnd.openxmlformats-package.relationships+xml":{"source":"iana"},"application/vnd.oracle.resource+json":{"source":"iana","compressible":true},"application/vnd.orange.indata":{"source":"iana"},"application/vnd.osa.netdeploy":{"source":"iana"},"application/vnd.osgeo.mapguide.package":{"source":"iana","extensions":["mgp"]},"application/vnd.osgi.bundle":{"source":"iana"},"application/vnd.osgi.dp":{"source":"iana","extensions":["dp"]},"application/vnd.osgi.subsystem":{"source":"iana","extensions":["esa"]},"application/vnd.otps.ct-kip+xml":{"source":"iana"},"application/vnd.oxli.countgraph":{"source":"iana"},"application/vnd.pagerduty+json":{"source":"iana","compressible":true},"application/vnd.palm":{"source":"iana","extensions":["pdb","pqa","oprc"]},"application/vnd.panoply":{"source":"iana"},"application/vnd.paos+xml":{"source":"iana"},"application/vnd.paos.xml":{"source":"apache"},"application/vnd.patentdive":{"source":"iana"},"application/vnd.pawaafile":{"source":"iana","extensions":["paw"]},"application/vnd.pcos":{"source":"iana"},"application/vnd.pg.format":{"source":"iana","extensions":["str"]},"application/vnd.pg.osasli":{"source":"iana","extensions":["ei6"]},"application/vnd.piaccess.application-licence":{"source":"iana"},"application/vnd.picsel":{"source":"iana","extensions":["efif"]},"application/vnd.pmi.widget":{"source":"iana","extensions":["wg"]},"application/vnd.poc.group-advertisement+xml":{"source":"iana"},"application/vnd.pocketlearn":{"source":"iana","extensions":["plf"]},"application/vnd.powerbuilder6":{"source":"iana","extensions":["pbd"]},"application/vnd.powerbuilder6-s":{"source":"iana"},"application/vnd.powerbuilder7":{"source":"iana"},"application/vnd.powerbuilder7-s":{"source":"iana"},"application/vnd.powerbuilder75":{"source":"iana"},"application/vnd.powerbuilder75-s":{"source":"iana"},"application/vnd.preminet":{"source":"iana"},"application/vnd.previewsystems.box":{"source":"iana","extensions":["box"]},"application/vnd.proteus.magazine":{"source":"iana","extensions":["mgz"]},"application/vnd.publishare-delta-tree":{"source":"iana","extensions":["qps"]},"application/vnd.pvi.ptid1":{"source":"iana","extensions":["ptid"]},"application/vnd.pwg-multiplexed":{"source":"iana"},"application/vnd.pwg-xhtml-print+xml":{"source":"iana"},"application/vnd.qualcomm.brew-app-res":{"source":"iana"},"application/vnd.quarantainenet":{"source":"iana"},"application/vnd.quark.quarkxpress":{"source":"iana","extensions":["qxd","qxt","qwd","qwt","qxl","qxb"]},"application/vnd.quobject-quoxdocument":{"source":"iana"},"application/vnd.radisys.moml+xml":{"source":"iana"},"application/vnd.radisys.msml+xml":{"source":"iana"},"application/vnd.radisys.msml-audit+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-conf+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-conn+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-dialog+xml":{"source":"iana"},"application/vnd.radisys.msml-audit-stream+xml":{"source":"iana"},"application/vnd.radisys.msml-conf+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-base+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-fax-detect+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-fax-sendrecv+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-group+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-speech+xml":{"source":"iana"},"application/vnd.radisys.msml-dialog-transform+xml":{"source":"iana"},"application/vnd.rainstor.data":{"source":"iana"},"application/vnd.rapid":{"source":"iana"},"application/vnd.rar":{"source":"iana"},"application/vnd.realvnc.bed":{"source":"iana","extensions":["bed"]},"application/vnd.recordare.musicxml":{"source":"iana","extensions":["mxl"]},"application/vnd.recordare.musicxml+xml":{"source":"iana","extensions":["musicxml"]},"application/vnd.renlearn.rlprint":{"source":"iana"},"application/vnd.restful+json":{"source":"iana","compressible":true},"application/vnd.rig.cryptonote":{"source":"iana","extensions":["cryptonote"]},"application/vnd.rim.cod":{"source":"apache","extensions":["cod"]},"application/vnd.rn-realmedia":{"source":"apache","extensions":["rm"]},"application/vnd.rn-realmedia-vbr":{"source":"apache","extensions":["rmvb"]},"application/vnd.route66.link66+xml":{"source":"iana","extensions":["link66"]},"application/vnd.rs-274x":{"source":"iana"},"application/vnd.ruckus.download":{"source":"iana"},"application/vnd.s3sms":{"source":"iana"},"application/vnd.sailingtracker.track":{"source":"iana","extensions":["st"]},"application/vnd.sbm.cid":{"source":"iana"},"application/vnd.sbm.mid2":{"source":"iana"},"application/vnd.scribus":{"source":"iana"},"application/vnd.sealed.3df":{"source":"iana"},"application/vnd.sealed.csf":{"source":"iana"},"application/vnd.sealed.doc":{"source":"iana"},"application/vnd.sealed.eml":{"source":"iana"},"application/vnd.sealed.mht":{"source":"iana"},"application/vnd.sealed.net":{"source":"iana"},"application/vnd.sealed.ppt":{"source":"iana"},"application/vnd.sealed.tiff":{"source":"iana"},"application/vnd.sealed.xls":{"source":"iana"},"application/vnd.sealedmedia.softseal.html":{"source":"iana"},"application/vnd.sealedmedia.softseal.pdf":{"source":"iana"},"application/vnd.seemail":{"source":"iana","extensions":["see"]},"application/vnd.sema":{"source":"iana","extensions":["sema"]},"application/vnd.semd":{"source":"iana","extensions":["semd"]},"application/vnd.semf":{"source":"iana","extensions":["semf"]},"application/vnd.shana.informed.formdata":{"source":"iana","extensions":["ifm"]},"application/vnd.shana.informed.formtemplate":{"source":"iana","extensions":["itp"]},"application/vnd.shana.informed.interchange":{"source":"iana","extensions":["iif"]},"application/vnd.shana.informed.package":{"source":"iana","extensions":["ipk"]},"application/vnd.sigrok.session":{"source":"iana"},"application/vnd.simtech-mindmapper":{"source":"iana","extensions":["twd","twds"]},"application/vnd.siren+json":{"source":"iana","compressible":true},"application/vnd.smaf":{"source":"iana","extensions":["mmf"]},"application/vnd.smart.notebook":{"source":"iana"},"application/vnd.smart.teacher":{"source":"iana","extensions":["teacher"]},"application/vnd.software602.filler.form+xml":{"source":"iana"},"application/vnd.software602.filler.form-xml-zip":{"source":"iana"},"application/vnd.solent.sdkm+xml":{"source":"iana","extensions":["sdkm","sdkd"]},"application/vnd.spotfire.dxp":{"source":"iana","extensions":["dxp"]},"application/vnd.spotfire.sfs":{"source":"iana","extensions":["sfs"]},"application/vnd.sqlite3":{"source":"iana"},"application/vnd.sss-cod":{"source":"iana"},"application/vnd.sss-dtf":{"source":"iana"},"application/vnd.sss-ntf":{"source":"iana"},"application/vnd.stardivision.calc":{"source":"apache","extensions":["sdc"]},"application/vnd.stardivision.draw":{"source":"apache","extensions":["sda"]},"application/vnd.stardivision.impress":{"source":"apache","extensions":["sdd"]},"application/vnd.stardivision.math":{"source":"apache","extensions":["smf"]},"application/vnd.stardivision.writer":{"source":"apache","extensions":["sdw","vor"]},"application/vnd.stardivision.writer-global":{"source":"apache","extensions":["sgl"]},"application/vnd.stepmania.package":{"source":"iana","extensions":["smzip"]},"application/vnd.stepmania.stepchart":{"source":"iana","extensions":["sm"]},"application/vnd.street-stream":{"source":"iana"},"application/vnd.sun.wadl+xml":{"source":"iana","compressible":true,"extensions":["wadl"]},"application/vnd.sun.xml.calc":{"source":"apache","extensions":["sxc"]},"application/vnd.sun.xml.calc.template":{"source":"apache","extensions":["stc"]},"application/vnd.sun.xml.draw":{"source":"apache","extensions":["sxd"]},"application/vnd.sun.xml.draw.template":{"source":"apache","extensions":["std"]},"application/vnd.sun.xml.impress":{"source":"apache","extensions":["sxi"]},"application/vnd.sun.xml.impress.template":{"source":"apache","extensions":["sti"]},"application/vnd.sun.xml.math":{"source":"apache","extensions":["sxm"]},"application/vnd.sun.xml.writer":{"source":"apache","extensions":["sxw"]},"application/vnd.sun.xml.writer.global":{"source":"apache","extensions":["sxg"]},"application/vnd.sun.xml.writer.template":{"source":"apache","extensions":["stw"]},"application/vnd.sus-calendar":{"source":"iana","extensions":["sus","susp"]},"application/vnd.svd":{"source":"iana","extensions":["svd"]},"application/vnd.swiftview-ics":{"source":"iana"},"application/vnd.symbian.install":{"source":"apache","extensions":["sis","sisx"]},"application/vnd.syncml+xml":{"source":"iana","extensions":["xsm"]},"application/vnd.syncml.dm+wbxml":{"source":"iana","extensions":["bdm"]},"application/vnd.syncml.dm+xml":{"source":"iana","extensions":["xdm"]},"application/vnd.syncml.dm.notification":{"source":"iana"},"application/vnd.syncml.dmddf+wbxml":{"source":"iana"},"application/vnd.syncml.dmddf+xml":{"source":"iana"},"application/vnd.syncml.dmtnds+wbxml":{"source":"iana"},"application/vnd.syncml.dmtnds+xml":{"source":"iana"},"application/vnd.syncml.ds.notification":{"source":"iana"},"application/vnd.tableschema+json":{"source":"iana","compressible":true},"application/vnd.tao.intent-module-archive":{"source":"iana","extensions":["tao"]},"application/vnd.tcpdump.pcap":{"source":"iana","extensions":["pcap","cap","dmp"]},"application/vnd.tmd.mediaflex.api+xml":{"source":"iana"},"application/vnd.tml":{"source":"iana"},"application/vnd.tmobile-livetv":{"source":"iana","extensions":["tmo"]},"application/vnd.tri.onesource":{"source":"iana"},"application/vnd.trid.tpt":{"source":"iana","extensions":["tpt"]},"application/vnd.triscape.mxs":{"source":"iana","extensions":["mxs"]},"application/vnd.trueapp":{"source":"iana","extensions":["tra"]},"application/vnd.truedoc":{"source":"iana"},"application/vnd.ubisoft.webplayer":{"source":"iana"},"application/vnd.ufdl":{"source":"iana","extensions":["ufd","ufdl"]},"application/vnd.uiq.theme":{"source":"iana","extensions":["utz"]},"application/vnd.umajin":{"source":"iana","extensions":["umj"]},"application/vnd.unity":{"source":"iana","extensions":["unityweb"]},"application/vnd.uoml+xml":{"source":"iana","extensions":["uoml"]},"application/vnd.uplanet.alert":{"source":"iana"},"application/vnd.uplanet.alert-wbxml":{"source":"iana"},"application/vnd.uplanet.bearer-choice":{"source":"iana"},"application/vnd.uplanet.bearer-choice-wbxml":{"source":"iana"},"application/vnd.uplanet.cacheop":{"source":"iana"},"application/vnd.uplanet.cacheop-wbxml":{"source":"iana"},"application/vnd.uplanet.channel":{"source":"iana"},"application/vnd.uplanet.channel-wbxml":{"source":"iana"},"application/vnd.uplanet.list":{"source":"iana"},"application/vnd.uplanet.list-wbxml":{"source":"iana"},"application/vnd.uplanet.listcmd":{"source":"iana"},"application/vnd.uplanet.listcmd-wbxml":{"source":"iana"},"application/vnd.uplanet.signal":{"source":"iana"},"application/vnd.uri-map":{"source":"iana"},"application/vnd.valve.source.material":{"source":"iana"},"application/vnd.vcx":{"source":"iana","extensions":["vcx"]},"application/vnd.vd-study":{"source":"iana"},"application/vnd.vectorworks":{"source":"iana"},"application/vnd.vel+json":{"source":"iana","compressible":true},"application/vnd.verimatrix.vcas":{"source":"iana"},"application/vnd.vidsoft.vidconference":{"source":"iana"},"application/vnd.visio":{"source":"iana","extensions":["vsd","vst","vss","vsw"]},"application/vnd.visionary":{"source":"iana","extensions":["vis"]},"application/vnd.vividence.scriptfile":{"source":"iana"},"application/vnd.vsf":{"source":"iana","extensions":["vsf"]},"application/vnd.wap.sic":{"source":"iana"},"application/vnd.wap.slc":{"source":"iana"},"application/vnd.wap.wbxml":{"source":"iana","extensions":["wbxml"]},"application/vnd.wap.wmlc":{"source":"iana","extensions":["wmlc"]},"application/vnd.wap.wmlscriptc":{"source":"iana","extensions":["wmlsc"]},"application/vnd.webturbo":{"source":"iana","extensions":["wtb"]},"application/vnd.wfa.p2p":{"source":"iana"},"application/vnd.wfa.wsc":{"source":"iana"},"application/vnd.windows.devicepairing":{"source":"iana"},"application/vnd.wmc":{"source":"iana"},"application/vnd.wmf.bootstrap":{"source":"iana"},"application/vnd.wolfram.mathematica":{"source":"iana"},"application/vnd.wolfram.mathematica.package":{"source":"iana"},"application/vnd.wolfram.player":{"source":"iana","extensions":["nbp"]},"application/vnd.wordperfect":{"source":"iana","extensions":["wpd"]},"application/vnd.wqd":{"source":"iana","extensions":["wqd"]},"application/vnd.wrq-hp3000-labelled":{"source":"iana"},"application/vnd.wt.stf":{"source":"iana","extensions":["stf"]},"application/vnd.wv.csp+wbxml":{"source":"iana"},"application/vnd.wv.csp+xml":{"source":"iana"},"application/vnd.wv.ssp+xml":{"source":"iana"},"application/vnd.xacml+json":{"source":"iana","compressible":true},"application/vnd.xara":{"source":"iana","extensions":["xar"]},"application/vnd.xfdl":{"source":"iana","extensions":["xfdl"]},"application/vnd.xfdl.webform":{"source":"iana"},"application/vnd.xmi+xml":{"source":"iana"},"application/vnd.xmpie.cpkg":{"source":"iana"},"application/vnd.xmpie.dpkg":{"source":"iana"},"application/vnd.xmpie.plan":{"source":"iana"},"application/vnd.xmpie.ppkg":{"source":"iana"},"application/vnd.xmpie.xlim":{"source":"iana"},"application/vnd.yamaha.hv-dic":{"source":"iana","extensions":["hvd"]},"application/vnd.yamaha.hv-script":{"source":"iana","extensions":["hvs"]},"application/vnd.yamaha.hv-voice":{"source":"iana","extensions":["hvp"]},"application/vnd.yamaha.openscoreformat":{"source":"iana","extensions":["osf"]},"application/vnd.yamaha.openscoreformat.osfpvg+xml":{"source":"iana","extensions":["osfpvg"]},"application/vnd.yamaha.remote-setup":{"source":"iana"},"application/vnd.yamaha.smaf-audio":{"source":"iana","extensions":["saf"]},"application/vnd.yamaha.smaf-phrase":{"source":"iana","extensions":["spf"]},"application/vnd.yamaha.through-ngn":{"source":"iana"},"application/vnd.yamaha.tunnel-udpencap":{"source":"iana"},"application/vnd.yaoweme":{"source":"iana"},"application/vnd.yellowriver-custom-menu":{"source":"iana","extensions":["cmp"]},"application/vnd.youtube.yt":{"source":"iana"},"application/vnd.zul":{"source":"iana","extensions":["zir","zirz"]},"application/vnd.zzazz.deck+xml":{"source":"iana","extensions":["zaz"]},"application/voicexml+xml":{"source":"iana","extensions":["vxml"]},"application/voucher-cms+json":{"source":"iana","compressible":true},"application/vq-rtcpxr":{"source":"iana"},"application/wasm":{"compressible":true,"extensions":["wasm"]},"application/watcherinfo+xml":{"source":"iana"},"application/webpush-options+json":{"source":"iana","compressible":true},"application/whoispp-query":{"source":"iana"},"application/whoispp-response":{"source":"iana"},"application/widget":{"source":"iana","extensions":["wgt"]},"application/winhlp":{"source":"apache","extensions":["hlp"]},"application/wita":{"source":"iana"},"application/wordperfect5.1":{"source":"iana"},"application/wsdl+xml":{"source":"iana","extensions":["wsdl"]},"application/wspolicy+xml":{"source":"iana","extensions":["wspolicy"]},"application/x-7z-compressed":{"source":"apache","compressible":false,"extensions":["7z"]},"application/x-abiword":{"source":"apache","extensions":["abw"]},"application/x-ace-compressed":{"source":"apache","extensions":["ace"]},"application/x-amf":{"source":"apache"},"application/x-apple-diskimage":{"source":"apache","extensions":["dmg"]},"application/x-arj":{"compressible":false,"extensions":["arj"]},"application/x-authorware-bin":{"source":"apache","extensions":["aab","x32","u32","vox"]},"application/x-authorware-map":{"source":"apache","extensions":["aam"]},"application/x-authorware-seg":{"source":"apache","extensions":["aas"]},"application/x-bcpio":{"source":"apache","extensions":["bcpio"]},"application/x-bdoc":{"compressible":false,"extensions":["bdoc"]},"application/x-bittorrent":{"source":"apache","extensions":["torrent"]},"application/x-blorb":{"source":"apache","extensions":["blb","blorb"]},"application/x-bzip":{"source":"apache","compressible":false,"extensions":["bz"]},"application/x-bzip2":{"source":"apache","compressible":false,"extensions":["bz2","boz"]},"application/x-cbr":{"source":"apache","extensions":["cbr","cba","cbt","cbz","cb7"]},"application/x-cdlink":{"source":"apache","extensions":["vcd"]},"application/x-cfs-compressed":{"source":"apache","extensions":["cfs"]},"application/x-chat":{"source":"apache","extensions":["chat"]},"application/x-chess-pgn":{"source":"apache","extensions":["pgn"]},"application/x-chrome-extension":{"extensions":["crx"]},"application/x-cocoa":{"source":"nginx","extensions":["cco"]},"application/x-compress":{"source":"apache"},"application/x-conference":{"source":"apache","extensions":["nsc"]},"application/x-cpio":{"source":"apache","extensions":["cpio"]},"application/x-csh":{"source":"apache","extensions":["csh"]},"application/x-deb":{"compressible":false},"application/x-debian-package":{"source":"apache","extensions":["deb","udeb"]},"application/x-dgc-compressed":{"source":"apache","extensions":["dgc"]},"application/x-director":{"source":"apache","extensions":["dir","dcr","dxr","cst","cct","cxt","w3d","fgd","swa"]},"application/x-doom":{"source":"apache","extensions":["wad"]},"application/x-dtbncx+xml":{"source":"apache","extensions":["ncx"]},"application/x-dtbook+xml":{"source":"apache","extensions":["dtb"]},"application/x-dtbresource+xml":{"source":"apache","extensions":["res"]},"application/x-dvi":{"source":"apache","compressible":false,"extensions":["dvi"]},"application/x-envoy":{"source":"apache","extensions":["evy"]},"application/x-eva":{"source":"apache","extensions":["eva"]},"application/x-font-bdf":{"source":"apache","extensions":["bdf"]},"application/x-font-dos":{"source":"apache"},"application/x-font-framemaker":{"source":"apache"},"application/x-font-ghostscript":{"source":"apache","extensions":["gsf"]},"application/x-font-libgrx":{"source":"apache"},"application/x-font-linux-psf":{"source":"apache","extensions":["psf"]},"application/x-font-pcf":{"source":"apache","extensions":["pcf"]},"application/x-font-snf":{"source":"apache","extensions":["snf"]},"application/x-font-speedo":{"source":"apache"},"application/x-font-sunos-news":{"source":"apache"},"application/x-font-type1":{"source":"apache","extensions":["pfa","pfb","pfm","afm"]},"application/x-font-vfont":{"source":"apache"},"application/x-freearc":{"source":"apache","extensions":["arc"]},"application/x-futuresplash":{"source":"apache","extensions":["spl"]},"application/x-gca-compressed":{"source":"apache","extensions":["gca"]},"application/x-glulx":{"source":"apache","extensions":["ulx"]},"application/x-gnumeric":{"source":"apache","extensions":["gnumeric"]},"application/x-gramps-xml":{"source":"apache","extensions":["gramps"]},"application/x-gtar":{"source":"apache","extensions":["gtar"]},"application/x-gzip":{"source":"apache"},"application/x-hdf":{"source":"apache","extensions":["hdf"]},"application/x-httpd-php":{"compressible":true,"extensions":["php"]},"application/x-install-instructions":{"source":"apache","extensions":["install"]},"application/x-iso9660-image":{"source":"apache","extensions":["iso"]},"application/x-java-archive-diff":{"source":"nginx","extensions":["jardiff"]},"application/x-java-jnlp-file":{"source":"apache","compressible":false,"extensions":["jnlp"]},"application/x-javascript":{"compressible":true},"application/x-latex":{"source":"apache","compressible":false,"extensions":["latex"]},"application/x-lua-bytecode":{"extensions":["luac"]},"application/x-lzh-compressed":{"source":"apache","extensions":["lzh","lha"]},"application/x-makeself":{"source":"nginx","extensions":["run"]},"application/x-mie":{"source":"apache","extensions":["mie"]},"application/x-mobipocket-ebook":{"source":"apache","extensions":["prc","mobi"]},"application/x-mpegurl":{"compressible":false},"application/x-ms-application":{"source":"apache","extensions":["application"]},"application/x-ms-shortcut":{"source":"apache","extensions":["lnk"]},"application/x-ms-wmd":{"source":"apache","extensions":["wmd"]},"application/x-ms-wmz":{"source":"apache","extensions":["wmz"]},"application/x-ms-xbap":{"source":"apache","extensions":["xbap"]},"application/x-msaccess":{"source":"apache","extensions":["mdb"]},"application/x-msbinder":{"source":"apache","extensions":["obd"]},"application/x-mscardfile":{"source":"apache","extensions":["crd"]},"application/x-msclip":{"source":"apache","extensions":["clp"]},"application/x-msdos-program":{"extensions":["exe"]},"application/x-msdownload":{"source":"apache","extensions":["exe","dll","com","bat","msi"]},"application/x-msmediaview":{"source":"apache","extensions":["mvb","m13","m14"]},"application/x-msmetafile":{"source":"apache","extensions":["wmf","wmz","emf","emz"]},"application/x-msmoney":{"source":"apache","extensions":["mny"]},"application/x-mspublisher":{"source":"apache","extensions":["pub"]},"application/x-msschedule":{"source":"apache","extensions":["scd"]},"application/x-msterminal":{"source":"apache","extensions":["trm"]},"application/x-mswrite":{"source":"apache","extensions":["wri"]},"application/x-netcdf":{"source":"apache","extensions":["nc","cdf"]},"application/x-ns-proxy-autoconfig":{"compressible":true,"extensions":["pac"]},"application/x-nzb":{"source":"apache","extensions":["nzb"]},"application/x-perl":{"source":"nginx","extensions":["pl","pm"]},"application/x-pilot":{"source":"nginx","extensions":["prc","pdb"]},"application/x-pkcs12":{"source":"apache","compressible":false,"extensions":["p12","pfx"]},"application/x-pkcs7-certificates":{"source":"apache","extensions":["p7b","spc"]},"application/x-pkcs7-certreqresp":{"source":"apache","extensions":["p7r"]},"application/x-rar-compressed":{"source":"apache","compressible":false,"extensions":["rar"]},"application/x-redhat-package-manager":{"source":"nginx","extensions":["rpm"]},"application/x-research-info-systems":{"source":"apache","extensions":["ris"]},"application/x-sea":{"source":"nginx","extensions":["sea"]},"application/x-sh":{"source":"apache","compressible":true,"extensions":["sh"]},"application/x-shar":{"source":"apache","extensions":["shar"]},"application/x-shockwave-flash":{"source":"apache","compressible":false,"extensions":["swf"]},"application/x-silverlight-app":{"source":"apache","extensions":["xap"]},"application/x-sql":{"source":"apache","extensions":["sql"]},"application/x-stuffit":{"source":"apache","compressible":false,"extensions":["sit"]},"application/x-stuffitx":{"source":"apache","extensions":["sitx"]},"application/x-subrip":{"source":"apache","extensions":["srt"]},"application/x-sv4cpio":{"source":"apache","extensions":["sv4cpio"]},"application/x-sv4crc":{"source":"apache","extensions":["sv4crc"]},"application/x-t3vm-image":{"source":"apache","extensions":["t3"]},"application/x-tads":{"source":"apache","extensions":["gam"]},"application/x-tar":{"source":"apache","compressible":true,"extensions":["tar"]},"application/x-tcl":{"source":"apache","extensions":["tcl","tk"]},"application/x-tex":{"source":"apache","extensions":["tex"]},"application/x-tex-tfm":{"source":"apache","extensions":["tfm"]},"application/x-texinfo":{"source":"apache","extensions":["texinfo","texi"]},"application/x-tgif":{"source":"apache","extensions":["obj"]},"application/x-ustar":{"source":"apache","extensions":["ustar"]},"application/x-virtualbox-hdd":{"compressible":true,"extensions":["hdd"]},"application/x-virtualbox-ova":{"compressible":true,"extensions":["ova"]},"application/x-virtualbox-ovf":{"compressible":true,"extensions":["ovf"]},"application/x-virtualbox-vbox":{"compressible":true,"extensions":["vbox"]},"application/x-virtualbox-vbox-extpack":{"compressible":false,"extensions":["vbox-extpack"]},"application/x-virtualbox-vdi":{"compressible":true,"extensions":["vdi"]},"application/x-virtualbox-vhd":{"compressible":true,"extensions":["vhd"]},"application/x-virtualbox-vmdk":{"compressible":true,"extensions":["vmdk"]},"application/x-wais-source":{"source":"apache","extensions":["src"]},"application/x-web-app-manifest+json":{"compressible":true,"extensions":["webapp"]},"application/x-www-form-urlencoded":{"source":"iana","compressible":true},"application/x-x509-ca-cert":{"source":"apache","extensions":["der","crt","pem"]},"application/x-xfig":{"source":"apache","extensions":["fig"]},"application/x-xliff+xml":{"source":"apache","extensions":["xlf"]},"application/x-xpinstall":{"source":"apache","compressible":false,"extensions":["xpi"]},"application/x-xz":{"source":"apache","extensions":["xz"]},"application/x-zmachine":{"source":"apache","extensions":["z1","z2","z3","z4","z5","z6","z7","z8"]},"application/x400-bp":{"source":"iana"},"application/xacml+xml":{"source":"iana"},"application/xaml+xml":{"source":"apache","extensions":["xaml"]},"application/xcap-att+xml":{"source":"iana"},"application/xcap-caps+xml":{"source":"iana"},"application/xcap-diff+xml":{"source":"iana","extensions":["xdf"]},"application/xcap-el+xml":{"source":"iana"},"application/xcap-error+xml":{"source":"iana"},"application/xcap-ns+xml":{"source":"iana"},"application/xcon-conference-info+xml":{"source":"iana"},"application/xcon-conference-info-diff+xml":{"source":"iana"},"application/xenc+xml":{"source":"iana","extensions":["xenc"]},"application/xhtml+xml":{"source":"iana","compressible":true,"extensions":["xhtml","xht"]},"application/xhtml-voice+xml":{"source":"apache"},"application/xml":{"source":"iana","compressible":true,"extensions":["xml","xsl","xsd","rng"]},"application/xml-dtd":{"source":"iana","compressible":true,"extensions":["dtd"]},"application/xml-external-parsed-entity":{"source":"iana"},"application/xml-patch+xml":{"source":"iana"},"application/xmpp+xml":{"source":"iana"},"application/xop+xml":{"source":"iana","compressible":true,"extensions":["xop"]},"application/xproc+xml":{"source":"apache","extensions":["xpl"]},"application/xslt+xml":{"source":"iana","extensions":["xslt"]},"application/xspf+xml":{"source":"apache","extensions":["xspf"]},"application/xv+xml":{"source":"iana","extensions":["mxml","xhvml","xvml","xvm"]},"application/yang":{"source":"iana","extensions":["yang"]},"application/yang-data+json":{"source":"iana","compressible":true},"application/yang-data+xml":{"source":"iana"},"application/yang-patch+json":{"source":"iana","compressible":true},"application/yang-patch+xml":{"source":"iana"},"application/yin+xml":{"source":"iana","extensions":["yin"]},"application/zip":{"source":"iana","compressible":false,"extensions":["zip"]},"application/zlib":{"source":"iana"},"audio/1d-interleaved-parityfec":{"source":"iana"},"audio/32kadpcm":{"source":"iana"},"audio/3gpp":{"source":"iana","compressible":false,"extensions":["3gpp"]},"audio/3gpp2":{"source":"iana"},"audio/ac3":{"source":"iana"},"audio/adpcm":{"source":"apache","extensions":["adp"]},"audio/amr":{"source":"iana"},"audio/amr-wb":{"source":"iana"},"audio/amr-wb+":{"source":"iana"},"audio/aptx":{"source":"iana"},"audio/asc":{"source":"iana"},"audio/atrac-advanced-lossless":{"source":"iana"},"audio/atrac-x":{"source":"iana"},"audio/atrac3":{"source":"iana"},"audio/basic":{"source":"iana","compressible":false,"extensions":["au","snd"]},"audio/bv16":{"source":"iana"},"audio/bv32":{"source":"iana"},"audio/clearmode":{"source":"iana"},"audio/cn":{"source":"iana"},"audio/dat12":{"source":"iana"},"audio/dls":{"source":"iana"},"audio/dsr-es201108":{"source":"iana"},"audio/dsr-es202050":{"source":"iana"},"audio/dsr-es202211":{"source":"iana"},"audio/dsr-es202212":{"source":"iana"},"audio/dv":{"source":"iana"},"audio/dvi4":{"source":"iana"},"audio/eac3":{"source":"iana"},"audio/encaprtp":{"source":"iana"},"audio/evrc":{"source":"iana"},"audio/evrc-qcp":{"source":"iana"},"audio/evrc0":{"source":"iana"},"audio/evrc1":{"source":"iana"},"audio/evrcb":{"source":"iana"},"audio/evrcb0":{"source":"iana"},"audio/evrcb1":{"source":"iana"},"audio/evrcnw":{"source":"iana"},"audio/evrcnw0":{"source":"iana"},"audio/evrcnw1":{"source":"iana"},"audio/evrcwb":{"source":"iana"},"audio/evrcwb0":{"source":"iana"},"audio/evrcwb1":{"source":"iana"},"audio/evs":{"source":"iana"},"audio/fwdred":{"source":"iana"},"audio/g711-0":{"source":"iana"},"audio/g719":{"source":"iana"},"audio/g722":{"source":"iana"},"audio/g7221":{"source":"iana"},"audio/g723":{"source":"iana"},"audio/g726-16":{"source":"iana"},"audio/g726-24":{"source":"iana"},"audio/g726-32":{"source":"iana"},"audio/g726-40":{"source":"iana"},"audio/g728":{"source":"iana"},"audio/g729":{"source":"iana"},"audio/g7291":{"source":"iana"},"audio/g729d":{"source":"iana"},"audio/g729e":{"source":"iana"},"audio/gsm":{"source":"iana"},"audio/gsm-efr":{"source":"iana"},"audio/gsm-hr-08":{"source":"iana"},"audio/ilbc":{"source":"iana"},"audio/ip-mr_v2.5":{"source":"iana"},"audio/isac":{"source":"apache"},"audio/l16":{"source":"iana"},"audio/l20":{"source":"iana"},"audio/l24":{"source":"iana","compressible":false},"audio/l8":{"source":"iana"},"audio/lpc":{"source":"iana"},"audio/melp":{"source":"iana"},"audio/melp1200":{"source":"iana"},"audio/melp2400":{"source":"iana"},"audio/melp600":{"source":"iana"},"audio/midi":{"source":"apache","extensions":["mid","midi","kar","rmi"]},"audio/mobile-xmf":{"source":"iana"},"audio/mp3":{"compressible":false,"extensions":["mp3"]},"audio/mp4":{"source":"iana","compressible":false,"extensions":["m4a","mp4a"]},"audio/mp4a-latm":{"source":"iana"},"audio/mpa":{"source":"iana"},"audio/mpa-robust":{"source":"iana"},"audio/mpeg":{"source":"iana","compressible":false,"extensions":["mpga","mp2","mp2a","mp3","m2a","m3a"]},"audio/mpeg4-generic":{"source":"iana"},"audio/musepack":{"source":"apache"},"audio/ogg":{"source":"iana","compressible":false,"extensions":["oga","ogg","spx"]},"audio/opus":{"source":"iana"},"audio/parityfec":{"source":"iana"},"audio/pcma":{"source":"iana"},"audio/pcma-wb":{"source":"iana"},"audio/pcmu":{"source":"iana"},"audio/pcmu-wb":{"source":"iana"},"audio/prs.sid":{"source":"iana"},"audio/qcelp":{"source":"iana"},"audio/raptorfec":{"source":"iana"},"audio/red":{"source":"iana"},"audio/rtp-enc-aescm128":{"source":"iana"},"audio/rtp-midi":{"source":"iana"},"audio/rtploopback":{"source":"iana"},"audio/rtx":{"source":"iana"},"audio/s3m":{"source":"apache","extensions":["s3m"]},"audio/silk":{"source":"apache","extensions":["sil"]},"audio/smv":{"source":"iana"},"audio/smv-qcp":{"source":"iana"},"audio/smv0":{"source":"iana"},"audio/sp-midi":{"source":"iana"},"audio/speex":{"source":"iana"},"audio/t140c":{"source":"iana"},"audio/t38":{"source":"iana"},"audio/telephone-event":{"source":"iana"},"audio/tone":{"source":"iana"},"audio/uemclip":{"source":"iana"},"audio/ulpfec":{"source":"iana"},"audio/vdvi":{"source":"iana"},"audio/vmr-wb":{"source":"iana"},"audio/vnd.3gpp.iufp":{"source":"iana"},"audio/vnd.4sb":{"source":"iana"},"audio/vnd.audiokoz":{"source":"iana"},"audio/vnd.celp":{"source":"iana"},"audio/vnd.cisco.nse":{"source":"iana"},"audio/vnd.cmles.radio-events":{"source":"iana"},"audio/vnd.cns.anp1":{"source":"iana"},"audio/vnd.cns.inf1":{"source":"iana"},"audio/vnd.dece.audio":{"source":"iana","extensions":["uva","uvva"]},"audio/vnd.digital-winds":{"source":"iana","extensions":["eol"]},"audio/vnd.dlna.adts":{"source":"iana"},"audio/vnd.dolby.heaac.1":{"source":"iana"},"audio/vnd.dolby.heaac.2":{"source":"iana"},"audio/vnd.dolby.mlp":{"source":"iana"},"audio/vnd.dolby.mps":{"source":"iana"},"audio/vnd.dolby.pl2":{"source":"iana"},"audio/vnd.dolby.pl2x":{"source":"iana"},"audio/vnd.dolby.pl2z":{"source":"iana"},"audio/vnd.dolby.pulse.1":{"source":"iana"},"audio/vnd.dra":{"source":"iana","extensions":["dra"]},"audio/vnd.dts":{"source":"iana","extensions":["dts"]},"audio/vnd.dts.hd":{"source":"iana","extensions":["dtshd"]},"audio/vnd.dvb.file":{"source":"iana"},"audio/vnd.everad.plj":{"source":"iana"},"audio/vnd.hns.audio":{"source":"iana"},"audio/vnd.lucent.voice":{"source":"iana","extensions":["lvp"]},"audio/vnd.ms-playready.media.pya":{"source":"iana","extensions":["pya"]},"audio/vnd.nokia.mobile-xmf":{"source":"iana"},"audio/vnd.nortel.vbk":{"source":"iana"},"audio/vnd.nuera.ecelp4800":{"source":"iana","extensions":["ecelp4800"]},"audio/vnd.nuera.ecelp7470":{"source":"iana","extensions":["ecelp7470"]},"audio/vnd.nuera.ecelp9600":{"source":"iana","extensions":["ecelp9600"]},"audio/vnd.octel.sbc":{"source":"iana"},"audio/vnd.presonus.multitrack":{"source":"iana"},"audio/vnd.qcelp":{"source":"iana"},"audio/vnd.rhetorex.32kadpcm":{"source":"iana"},"audio/vnd.rip":{"source":"iana","extensions":["rip"]},"audio/vnd.rn-realaudio":{"compressible":false},"audio/vnd.sealedmedia.softseal.mpeg":{"source":"iana"},"audio/vnd.vmx.cvsd":{"source":"iana"},"audio/vnd.wave":{"compressible":false},"audio/vorbis":{"source":"iana","compressible":false},"audio/vorbis-config":{"source":"iana"},"audio/wav":{"compressible":false,"extensions":["wav"]},"audio/wave":{"compressible":false,"extensions":["wav"]},"audio/webm":{"source":"apache","compressible":false,"extensions":["weba"]},"audio/x-aac":{"source":"apache","compressible":false,"extensions":["aac"]},"audio/x-aiff":{"source":"apache","extensions":["aif","aiff","aifc"]},"audio/x-caf":{"source":"apache","compressible":false,"extensions":["caf"]},"audio/x-flac":{"source":"apache","extensions":["flac"]},"audio/x-m4a":{"source":"nginx","extensions":["m4a"]},"audio/x-matroska":{"source":"apache","extensions":["mka"]},"audio/x-mpegurl":{"source":"apache","extensions":["m3u"]},"audio/x-ms-wax":{"source":"apache","extensions":["wax"]},"audio/x-ms-wma":{"source":"apache","extensions":["wma"]},"audio/x-pn-realaudio":{"source":"apache","extensions":["ram","ra"]},"audio/x-pn-realaudio-plugin":{"source":"apache","extensions":["rmp"]},"audio/x-realaudio":{"source":"nginx","extensions":["ra"]},"audio/x-tta":{"source":"apache"},"audio/x-wav":{"source":"apache","extensions":["wav"]},"audio/xm":{"source":"apache","extensions":["xm"]},"chemical/x-cdx":{"source":"apache","extensions":["cdx"]},"chemical/x-cif":{"source":"apache","extensions":["cif"]},"chemical/x-cmdf":{"source":"apache","extensions":["cmdf"]},"chemical/x-cml":{"source":"apache","extensions":["cml"]},"chemical/x-csml":{"source":"apache","extensions":["csml"]},"chemical/x-pdb":{"source":"apache"},"chemical/x-xyz":{"source":"apache","extensions":["xyz"]},"font/collection":{"source":"iana","extensions":["ttc"]},"font/otf":{"source":"iana","compressible":true,"extensions":["otf"]},"font/sfnt":{"source":"iana"},"font/ttf":{"source":"iana","extensions":["ttf"]},"font/woff":{"source":"iana","extensions":["woff"]},"font/woff2":{"source":"iana","extensions":["woff2"]},"image/aces":{"source":"iana"},"image/apng":{"compressible":false,"extensions":["apng"]},"image/bmp":{"source":"iana","compressible":true,"extensions":["bmp"]},"image/cgm":{"source":"iana","extensions":["cgm"]},"image/dicom-rle":{"source":"iana"},"image/emf":{"source":"iana"},"image/fits":{"source":"iana"},"image/g3fax":{"source":"iana","extensions":["g3"]},"image/gif":{"source":"iana","compressible":false,"extensions":["gif"]},"image/ief":{"source":"iana","extensions":["ief"]},"image/jls":{"source":"iana"},"image/jp2":{"source":"iana","compressible":false,"extensions":["jp2","jpg2"]},"image/jpeg":{"source":"iana","compressible":false,"extensions":["jpeg","jpg","jpe"]},"image/jpm":{"source":"iana","compressible":false,"extensions":["jpm"]},"image/jpx":{"source":"iana","compressible":false,"extensions":["jpx","jpf"]},"image/ktx":{"source":"iana","extensions":["ktx"]},"image/naplps":{"source":"iana"},"image/pjpeg":{"compressible":false},"image/png":{"source":"iana","compressible":false,"extensions":["png"]},"image/prs.btif":{"source":"iana","extensions":["btif"]},"image/prs.pti":{"source":"iana"},"image/pwg-raster":{"source":"iana"},"image/sgi":{"source":"apache","extensions":["sgi"]},"image/svg+xml":{"source":"iana","compressible":true,"extensions":["svg","svgz"]},"image/t38":{"source":"iana"},"image/tiff":{"source":"iana","compressible":false,"extensions":["tiff","tif"]},"image/tiff-fx":{"source":"iana"},"image/vnd.adobe.photoshop":{"source":"iana","compressible":true,"extensions":["psd"]},"image/vnd.airzip.accelerator.azv":{"source":"iana"},"image/vnd.cns.inf2":{"source":"iana"},"image/vnd.dece.graphic":{"source":"iana","extensions":["uvi","uvvi","uvg","uvvg"]},"image/vnd.djvu":{"source":"iana","extensions":["djvu","djv"]},"image/vnd.dvb.subtitle":{"source":"iana","extensions":["sub"]},"image/vnd.dwg":{"source":"iana","extensions":["dwg"]},"image/vnd.dxf":{"source":"iana","extensions":["dxf"]},"image/vnd.fastbidsheet":{"source":"iana","extensions":["fbs"]},"image/vnd.fpx":{"source":"iana","extensions":["fpx"]},"image/vnd.fst":{"source":"iana","extensions":["fst"]},"image/vnd.fujixerox.edmics-mmr":{"source":"iana","extensions":["mmr"]},"image/vnd.fujixerox.edmics-rlc":{"source":"iana","extensions":["rlc"]},"image/vnd.globalgraphics.pgb":{"source":"iana"},"image/vnd.microsoft.icon":{"source":"iana"},"image/vnd.mix":{"source":"iana"},"image/vnd.mozilla.apng":{"source":"iana"},"image/vnd.ms-modi":{"source":"iana","extensions":["mdi"]},"image/vnd.ms-photo":{"source":"apache","extensions":["wdp"]},"image/vnd.net-fpx":{"source":"iana","extensions":["npx"]},"image/vnd.radiance":{"source":"iana"},"image/vnd.sealed.png":{"source":"iana"},"image/vnd.sealedmedia.softseal.gif":{"source":"iana"},"image/vnd.sealedmedia.softseal.jpg":{"source":"iana"},"image/vnd.svf":{"source":"iana"},"image/vnd.tencent.tap":{"source":"iana"},"image/vnd.valve.source.texture":{"source":"iana"},"image/vnd.wap.wbmp":{"source":"iana","extensions":["wbmp"]},"image/vnd.xiff":{"source":"iana","extensions":["xif"]},"image/vnd.zbrush.pcx":{"source":"iana"},"image/webp":{"source":"apache","extensions":["webp"]},"image/wmf":{"source":"iana"},"image/x-3ds":{"source":"apache","extensions":["3ds"]},"image/x-cmu-raster":{"source":"apache","extensions":["ras"]},"image/x-cmx":{"source":"apache","extensions":["cmx"]},"image/x-freehand":{"source":"apache","extensions":["fh","fhc","fh4","fh5","fh7"]},"image/x-icon":{"source":"apache","compressible":true,"extensions":["ico"]},"image/x-jng":{"source":"nginx","extensions":["jng"]},"image/x-mrsid-image":{"source":"apache","extensions":["sid"]},"image/x-ms-bmp":{"source":"nginx","compressible":true,"extensions":["bmp"]},"image/x-pcx":{"source":"apache","extensions":["pcx"]},"image/x-pict":{"source":"apache","extensions":["pic","pct"]},"image/x-portable-anymap":{"source":"apache","extensions":["pnm"]},"image/x-portable-bitmap":{"source":"apache","extensions":["pbm"]},"image/x-portable-graymap":{"source":"apache","extensions":["pgm"]},"image/x-portable-pixmap":{"source":"apache","extensions":["ppm"]},"image/x-rgb":{"source":"apache","extensions":["rgb"]},"image/x-tga":{"source":"apache","extensions":["tga"]},"image/x-xbitmap":{"source":"apache","extensions":["xbm"]},"image/x-xcf":{"compressible":false},"image/x-xpixmap":{"source":"apache","extensions":["xpm"]},"image/x-xwindowdump":{"source":"apache","extensions":["xwd"]},"message/cpim":{"source":"iana"},"message/delivery-status":{"source":"iana"},"message/disposition-notification":{"source":"iana","extensions":["disposition-notification"]},"message/external-body":{"source":"iana"},"message/feedback-report":{"source":"iana"},"message/global":{"source":"iana","extensions":["u8msg"]},"message/global-delivery-status":{"source":"iana","extensions":["u8dsn"]},"message/global-disposition-notification":{"source":"iana","extensions":["u8mdn"]},"message/global-headers":{"source":"iana","extensions":["u8hdr"]},"message/http":{"source":"iana","compressible":false},"message/imdn+xml":{"source":"iana","compressible":true},"message/news":{"source":"iana"},"message/partial":{"source":"iana","compressible":false},"message/rfc822":{"source":"iana","compressible":true,"extensions":["eml","mime"]},"message/s-http":{"source":"iana"},"message/sip":{"source":"iana"},"message/sipfrag":{"source":"iana"},"message/tracking-status":{"source":"iana"},"message/vnd.si.simp":{"source":"iana"},"message/vnd.wfa.wsc":{"source":"iana","extensions":["wsc"]},"model/3mf":{"source":"iana"},"model/gltf+json":{"source":"iana","compressible":true,"extensions":["gltf"]},"model/gltf-binary":{"source":"iana","compressible":true,"extensions":["glb"]},"model/iges":{"source":"iana","compressible":false,"extensions":["igs","iges"]},"model/mesh":{"source":"iana","compressible":false,"extensions":["msh","mesh","silo"]},"model/vnd.collada+xml":{"source":"iana","extensions":["dae"]},"model/vnd.dwf":{"source":"iana","extensions":["dwf"]},"model/vnd.flatland.3dml":{"source":"iana"},"model/vnd.gdl":{"source":"iana","extensions":["gdl"]},"model/vnd.gs-gdl":{"source":"apache"},"model/vnd.gs.gdl":{"source":"iana"},"model/vnd.gtw":{"source":"iana","extensions":["gtw"]},"model/vnd.moml+xml":{"source":"iana"},"model/vnd.mts":{"source":"iana","extensions":["mts"]},"model/vnd.opengex":{"source":"iana"},"model/vnd.parasolid.transmit.binary":{"source":"iana"},"model/vnd.parasolid.transmit.text":{"source":"iana"},"model/vnd.rosette.annotated-data-model":{"source":"iana"},"model/vnd.valve.source.compiled-map":{"source":"iana"},"model/vnd.vtu":{"source":"iana","extensions":["vtu"]},"model/vrml":{"source":"iana","compressible":false,"extensions":["wrl","vrml"]},"model/x3d+binary":{"source":"apache","compressible":false,"extensions":["x3db","x3dbz"]},"model/x3d+fastinfoset":{"source":"iana"},"model/x3d+vrml":{"source":"apache","compressible":false,"extensions":["x3dv","x3dvz"]},"model/x3d+xml":{"source":"iana","compressible":true,"extensions":["x3d","x3dz"]},"model/x3d-vrml":{"source":"iana"},"multipart/alternative":{"source":"iana","compressible":false},"multipart/appledouble":{"source":"iana"},"multipart/byteranges":{"source":"iana"},"multipart/digest":{"source":"iana"},"multipart/encrypted":{"source":"iana","compressible":false},"multipart/form-data":{"source":"iana","compressible":false},"multipart/header-set":{"source":"iana"},"multipart/mixed":{"source":"iana","compressible":false},"multipart/multilingual":{"source":"iana"},"multipart/parallel":{"source":"iana"},"multipart/related":{"source":"iana","compressible":false},"multipart/report":{"source":"iana"},"multipart/signed":{"source":"iana","compressible":false},"multipart/vnd.bint.med-plus":{"source":"iana"},"multipart/voice-message":{"source":"iana"},"multipart/x-mixed-replace":{"source":"iana"},"text/1d-interleaved-parityfec":{"source":"iana"},"text/cache-manifest":{"source":"iana","compressible":true,"extensions":["appcache","manifest"]},"text/calendar":{"source":"iana","extensions":["ics","ifb"]},"text/calender":{"compressible":true},"text/cmd":{"compressible":true},"text/coffeescript":{"extensions":["coffee","litcoffee"]},"text/css":{"source":"iana","charset":"UTF-8","compressible":true,"extensions":["css"]},"text/csv":{"source":"iana","compressible":true,"extensions":["csv"]},"text/csv-schema":{"source":"iana"},"text/directory":{"source":"iana"},"text/dns":{"source":"iana"},"text/ecmascript":{"source":"iana"},"text/encaprtp":{"source":"iana"},"text/enriched":{"source":"iana"},"text/fwdred":{"source":"iana"},"text/grammar-ref-list":{"source":"iana"},"text/html":{"source":"iana","compressible":true,"extensions":["html","htm","shtml"]},"text/jade":{"extensions":["jade"]},"text/javascript":{"source":"iana","compressible":true},"text/jcr-cnd":{"source":"iana"},"text/jsx":{"compressible":true,"extensions":["jsx"]},"text/less":{"extensions":["less"]},"text/markdown":{"source":"iana","compressible":true,"extensions":["markdown","md"]},"text/mathml":{"source":"nginx","extensions":["mml"]},"text/mizar":{"source":"iana"},"text/n3":{"source":"iana","compressible":true,"extensions":["n3"]},"text/parameters":{"source":"iana"},"text/parityfec":{"source":"iana"},"text/plain":{"source":"iana","compressible":true,"extensions":["txt","text","conf","def","list","log","in","ini"]},"text/provenance-notation":{"source":"iana"},"text/prs.fallenstein.rst":{"source":"iana"},"text/prs.lines.tag":{"source":"iana","extensions":["dsc"]},"text/prs.prop.logic":{"source":"iana"},"text/raptorfec":{"source":"iana"},"text/red":{"source":"iana"},"text/rfc822-headers":{"source":"iana"},"text/richtext":{"source":"iana","compressible":true,"extensions":["rtx"]},"text/rtf":{"source":"iana","compressible":true,"extensions":["rtf"]},"text/rtp-enc-aescm128":{"source":"iana"},"text/rtploopback":{"source":"iana"},"text/rtx":{"source":"iana"},"text/sgml":{"source":"iana","extensions":["sgml","sgm"]},"text/shex":{"extensions":["shex"]},"text/slim":{"extensions":["slim","slm"]},"text/strings":{"source":"iana"},"text/stylus":{"extensions":["stylus","styl"]},"text/t140":{"source":"iana"},"text/tab-separated-values":{"source":"iana","compressible":true,"extensions":["tsv"]},"text/troff":{"source":"iana","extensions":["t","tr","roff","man","me","ms"]},"text/turtle":{"source":"iana","extensions":["ttl"]},"text/ulpfec":{"source":"iana"},"text/uri-list":{"source":"iana","compressible":true,"extensions":["uri","uris","urls"]},"text/vcard":{"source":"iana","compressible":true,"extensions":["vcard"]},"text/vnd.a":{"source":"iana"},"text/vnd.abc":{"source":"iana"},"text/vnd.ascii-art":{"source":"iana"},"text/vnd.curl":{"source":"iana","extensions":["curl"]},"text/vnd.curl.dcurl":{"source":"apache","extensions":["dcurl"]},"text/vnd.curl.mcurl":{"source":"apache","extensions":["mcurl"]},"text/vnd.curl.scurl":{"source":"apache","extensions":["scurl"]},"text/vnd.debian.copyright":{"source":"iana"},"text/vnd.dmclientscript":{"source":"iana"},"text/vnd.dvb.subtitle":{"source":"iana","extensions":["sub"]},"text/vnd.esmertec.theme-descriptor":{"source":"iana"},"text/vnd.fly":{"source":"iana","extensions":["fly"]},"text/vnd.fmi.flexstor":{"source":"iana","extensions":["flx"]},"text/vnd.graphviz":{"source":"iana","extensions":["gv"]},"text/vnd.in3d.3dml":{"source":"iana","extensions":["3dml"]},"text/vnd.in3d.spot":{"source":"iana","extensions":["spot"]},"text/vnd.iptc.newsml":{"source":"iana"},"text/vnd.iptc.nitf":{"source":"iana"},"text/vnd.latex-z":{"source":"iana"},"text/vnd.motorola.reflex":{"source":"iana"},"text/vnd.ms-mediapackage":{"source":"iana"},"text/vnd.net2phone.commcenter.command":{"source":"iana"},"text/vnd.radisys.msml-basic-layout":{"source":"iana"},"text/vnd.si.uricatalogue":{"source":"iana"},"text/vnd.sun.j2me.app-descriptor":{"source":"iana","extensions":["jad"]},"text/vnd.trolltech.linguist":{"source":"iana"},"text/vnd.wap.si":{"source":"iana"},"text/vnd.wap.sl":{"source":"iana"},"text/vnd.wap.wml":{"source":"iana","extensions":["wml"]},"text/vnd.wap.wmlscript":{"source":"iana","extensions":["wmls"]},"text/vtt":{"charset":"UTF-8","compressible":true,"extensions":["vtt"]},"text/x-asm":{"source":"apache","extensions":["s","asm"]},"text/x-c":{"source":"apache","extensions":["c","cc","cxx","cpp","h","hh","dic"]},"text/x-component":{"source":"nginx","extensions":["htc"]},"text/x-fortran":{"source":"apache","extensions":["f","for","f77","f90"]},"text/x-gwt-rpc":{"compressible":true},"text/x-handlebars-template":{"extensions":["hbs"]},"text/x-java-source":{"source":"apache","extensions":["java"]},"text/x-jquery-tmpl":{"compressible":true},"text/x-lua":{"extensions":["lua"]},"text/x-markdown":{"compressible":true,"extensions":["mkd"]},"text/x-nfo":{"source":"apache","extensions":["nfo"]},"text/x-opml":{"source":"apache","extensions":["opml"]},"text/x-org":{"compressible":true,"extensions":["org"]},"text/x-pascal":{"source":"apache","extensions":["p","pas"]},"text/x-processing":{"compressible":true,"extensions":["pde"]},"text/x-sass":{"extensions":["sass"]},"text/x-scss":{"extensions":["scss"]},"text/x-setext":{"source":"apache","extensions":["etx"]},"text/x-sfv":{"source":"apache","extensions":["sfv"]},"text/x-suse-ymp":{"compressible":true,"extensions":["ymp"]},"text/x-uuencode":{"source":"apache","extensions":["uu"]},"text/x-vcalendar":{"source":"apache","extensions":["vcs"]},"text/x-vcard":{"source":"apache","extensions":["vcf"]},"text/xml":{"source":"iana","compressible":true,"extensions":["xml"]},"text/xml-external-parsed-entity":{"source":"iana"},"text/yaml":{"extensions":["yaml","yml"]},"video/1d-interleaved-parityfec":{"source":"iana"},"video/3gpp":{"source":"iana","extensions":["3gp","3gpp"]},"video/3gpp-tt":{"source":"iana"},"video/3gpp2":{"source":"iana","extensions":["3g2"]},"video/bmpeg":{"source":"iana"},"video/bt656":{"source":"iana"},"video/celb":{"source":"iana"},"video/dv":{"source":"iana"},"video/encaprtp":{"source":"iana"},"video/h261":{"source":"iana","extensions":["h261"]},"video/h263":{"source":"iana","extensions":["h263"]},"video/h263-1998":{"source":"iana"},"video/h263-2000":{"source":"iana"},"video/h264":{"source":"iana","extensions":["h264"]},"video/h264-rcdo":{"source":"iana"},"video/h264-svc":{"source":"iana"},"video/h265":{"source":"iana"},"video/iso.segment":{"source":"iana"},"video/jpeg":{"source":"iana","extensions":["jpgv"]},"video/jpeg2000":{"source":"iana"},"video/jpm":{"source":"apache","extensions":["jpm","jpgm"]},"video/mj2":{"source":"iana","extensions":["mj2","mjp2"]},"video/mp1s":{"source":"iana"},"video/mp2p":{"source":"iana"},"video/mp2t":{"source":"iana","extensions":["ts"]},"video/mp4":{"source":"iana","compressible":false,"extensions":["mp4","mp4v","mpg4"]},"video/mp4v-es":{"source":"iana"},"video/mpeg":{"source":"iana","compressible":false,"extensions":["mpeg","mpg","mpe","m1v","m2v"]},"video/mpeg4-generic":{"source":"iana"},"video/mpv":{"source":"iana"},"video/nv":{"source":"iana"},"video/ogg":{"source":"iana","compressible":false,"extensions":["ogv"]},"video/parityfec":{"source":"iana"},"video/pointer":{"source":"iana"},"video/quicktime":{"source":"iana","compressible":false,"extensions":["qt","mov"]},"video/raptorfec":{"source":"iana"},"video/raw":{"source":"iana"},"video/rtp-enc-aescm128":{"source":"iana"},"video/rtploopback":{"source":"iana"},"video/rtx":{"source":"iana"},"video/smpte291":{"source":"iana"},"video/smpte292m":{"source":"iana"},"video/ulpfec":{"source":"iana"},"video/vc1":{"source":"iana"},"video/vnd.cctv":{"source":"iana"},"video/vnd.dece.hd":{"source":"iana","extensions":["uvh","uvvh"]},"video/vnd.dece.mobile":{"source":"iana","extensions":["uvm","uvvm"]},"video/vnd.dece.mp4":{"source":"iana"},"video/vnd.dece.pd":{"source":"iana","extensions":["uvp","uvvp"]},"video/vnd.dece.sd":{"source":"iana","extensions":["uvs","uvvs"]},"video/vnd.dece.video":{"source":"iana","extensions":["uvv","uvvv"]},"video/vnd.directv.mpeg":{"source":"iana"},"video/vnd.directv.mpeg-tts":{"source":"iana"},"video/vnd.dlna.mpeg-tts":{"source":"iana"},"video/vnd.dvb.file":{"source":"iana","extensions":["dvb"]},"video/vnd.fvt":{"source":"iana","extensions":["fvt"]},"video/vnd.hns.video":{"source":"iana"},"video/vnd.iptvforum.1dparityfec-1010":{"source":"iana"},"video/vnd.iptvforum.1dparityfec-2005":{"source":"iana"},"video/vnd.iptvforum.2dparityfec-1010":{"source":"iana"},"video/vnd.iptvforum.2dparityfec-2005":{"source":"iana"},"video/vnd.iptvforum.ttsavc":{"source":"iana"},"video/vnd.iptvforum.ttsmpeg2":{"source":"iana"},"video/vnd.motorola.video":{"source":"iana"},"video/vnd.motorola.videop":{"source":"iana"},"video/vnd.mpegurl":{"source":"iana","extensions":["mxu","m4u"]},"video/vnd.ms-playready.media.pyv":{"source":"iana","extensions":["pyv"]},"video/vnd.nokia.interleaved-multimedia":{"source":"iana"},"video/vnd.nokia.mp4vr":{"source":"iana"},"video/vnd.nokia.videovoip":{"source":"iana"},"video/vnd.objectvideo":{"source":"iana"},"video/vnd.radgamettools.bink":{"source":"iana"},"video/vnd.radgamettools.smacker":{"source":"iana"},"video/vnd.sealed.mpeg1":{"source":"iana"},"video/vnd.sealed.mpeg4":{"source":"iana"},"video/vnd.sealed.swf":{"source":"iana"},"video/vnd.sealedmedia.softseal.mov":{"source":"iana"},"video/vnd.uvvu.mp4":{"source":"iana","extensions":["uvu","uvvu"]},"video/vnd.vivo":{"source":"iana","extensions":["viv"]},"video/vp8":{"source":"iana"},"video/webm":{"source":"apache","compressible":false,"extensions":["webm"]},"video/x-f4v":{"source":"apache","extensions":["f4v"]},"video/x-fli":{"source":"apache","extensions":["fli"]},"video/x-flv":{"source":"apache","compressible":false,"extensions":["flv"]},"video/x-m4v":{"source":"apache","extensions":["m4v"]},"video/x-matroska":{"source":"apache","compressible":false,"extensions":["mkv","mk3d","mks"]},"video/x-mng":{"source":"apache","extensions":["mng"]},"video/x-ms-asf":{"source":"apache","extensions":["asf","asx"]},"video/x-ms-vob":{"source":"apache","extensions":["vob"]},"video/x-ms-wm":{"source":"apache","extensions":["wm"]},"video/x-ms-wmv":{"source":"apache","compressible":false,"extensions":["wmv"]},"video/x-ms-wmx":{"source":"apache","extensions":["wmx"]},"video/x-ms-wvx":{"source":"apache","extensions":["wvx"]},"video/x-msvideo":{"source":"apache","extensions":["avi"]},"video/x-sgi-movie":{"source":"apache","extensions":["movie"]},"video/x-smv":{"source":"apache","extensions":["smv"]},"x-conference/x-cooltalk":{"source":"apache","extensions":["ice"]},"x-shader/x-fragment":{"compressible":true},"x-shader/x-vertex":{"compressible":true}}',
  );
});

parcelRegister('9Puct', function (module, exports) {
  'use strict';

  var $72804d9adf684d0b$require$Writable = $dmXIQ$stream.Writable;

  var $5QfTR = parcelRequire('5QfTR');

  var $97vyB = parcelRequire('97vyB');
  var $72804d9adf684d0b$require$BINARY_TYPES = $97vyB.BINARY_TYPES;
  var $72804d9adf684d0b$require$EMPTY_BUFFER = $97vyB.EMPTY_BUFFER;
  var $72804d9adf684d0b$require$kStatusCode = $97vyB.kStatusCode;
  var $72804d9adf684d0b$require$kWebSocket = $97vyB.kWebSocket;

  var $2vcMF = parcelRequire('2vcMF');
  var $72804d9adf684d0b$require$concat = $2vcMF.concat;
  var $72804d9adf684d0b$require$toArrayBuffer = $2vcMF.toArrayBuffer;
  var $72804d9adf684d0b$require$unmask = $2vcMF.unmask;

  var $hONSk = parcelRequire('hONSk');
  var $72804d9adf684d0b$require$isValidStatusCode = $hONSk.isValidStatusCode;
  var $72804d9adf684d0b$require$isValidUTF8 = $hONSk.isValidUTF8;
  const $72804d9adf684d0b$var$GET_INFO = 0;
  const $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_16 = 1;
  const $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_64 = 2;
  const $72804d9adf684d0b$var$GET_MASK = 3;
  const $72804d9adf684d0b$var$GET_DATA = 4;
  const $72804d9adf684d0b$var$INFLATING = 5;
  /**
   * HyBi Receiver implementation.
   *
   * @extends Writable
   */ class $72804d9adf684d0b$var$Receiver extends $72804d9adf684d0b$require$Writable {
    /**
     * Creates a Receiver instance.
     *
     * @param {String} [binaryType=nodebuffer] The type for binary data
     * @param {Object} [extensions] An object containing the negotiated extensions
     * @param {Boolean} [isServer=false] Specifies whether to operate in client or
     *     server mode
     * @param {Number} [maxPayload=0] The maximum allowed message length
     */ constructor(binaryType, extensions, isServer, maxPayload) {
      super();
      this._binaryType =
        binaryType || $72804d9adf684d0b$require$BINARY_TYPES[0];
      this[$72804d9adf684d0b$require$kWebSocket] = undefined;
      this._extensions = extensions || {};
      this._isServer = !!isServer;
      this._maxPayload = maxPayload | 0;
      this._bufferedBytes = 0;
      this._buffers = [];
      this._compressed = false;
      this._payloadLength = 0;
      this._mask = undefined;
      this._fragmented = 0;
      this._masked = false;
      this._fin = false;
      this._opcode = 0;
      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragments = [];
      this._state = $72804d9adf684d0b$var$GET_INFO;
      this._loop = false;
    }
    /**
     * Implements `Writable.prototype._write()`.
     *
     * @param {Buffer} chunk The chunk of data to write
     * @param {String} encoding The character encoding of `chunk`
     * @param {Function} cb Callback
     * @private
     */ _write(chunk, encoding, cb) {
      if (
        this._opcode === 0x08 &&
        this._state == $72804d9adf684d0b$var$GET_INFO
      )
        return cb();
      this._bufferedBytes += chunk.length;
      this._buffers.push(chunk);
      this.startLoop(cb);
    }
    /**
     * Consumes `n` bytes from the buffered data.
     *
     * @param {Number} n The number of bytes to consume
     * @return {Buffer} The consumed bytes
     * @private
     */ consume(n) {
      this._bufferedBytes -= n;
      if (n === this._buffers[0].length) return this._buffers.shift();
      if (n < this._buffers[0].length) {
        const buf = this._buffers[0];
        this._buffers[0] = buf.slice(n);
        return buf.slice(0, n);
      }
      const dst = Buffer.allocUnsafe(n);
      do {
        const buf = this._buffers[0];
        const offset = dst.length - n;
        if (n >= buf.length) dst.set(this._buffers.shift(), offset);
        else {
          dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
          this._buffers[0] = buf.slice(n);
        }
        n -= buf.length;
      } while (n > 0);
      return dst;
    }
    /**
     * Starts the parsing loop.
     *
     * @param {Function} cb Callback
     * @private
     */ startLoop(cb) {
      let err;
      this._loop = true;
      do
        switch (this._state) {
          case $72804d9adf684d0b$var$GET_INFO:
            err = this.getInfo();
            break;
          case $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_16:
            err = this.getPayloadLength16();
            break;
          case $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_64:
            err = this.getPayloadLength64();
            break;
          case $72804d9adf684d0b$var$GET_MASK:
            this.getMask();
            break;
          case $72804d9adf684d0b$var$GET_DATA:
            err = this.getData(cb);
            break;
          default:
            // `INFLATING`
            this._loop = false;
            return;
        }
      while (this._loop);
      cb(err);
    }
    /**
     * Reads the first two bytes of a frame.
     *
     * @return {(RangeError|undefined)} A possible error
     * @private
     */ getInfo() {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      const buf = this.consume(2);
      if ((buf[0] & 0x30) !== 0x00) {
        this._loop = false;
        return $72804d9adf684d0b$var$error(
          RangeError,
          'RSV2 and RSV3 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_2_3',
        );
      }
      const compressed = (buf[0] & 0x40) === 0x40;
      if (compressed && !this._extensions[$5QfTR.extensionName]) {
        this._loop = false;
        return $72804d9adf684d0b$var$error(
          RangeError,
          'RSV1 must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_RSV_1',
        );
      }
      this._fin = (buf[0] & 0x80) === 0x80;
      this._opcode = buf[0] & 0x0f;
      this._payloadLength = buf[1] & 0x7f;
      if (this._opcode === 0x00) {
        if (compressed) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'RSV1 must be clear',
            true,
            1002,
            'WS_ERR_UNEXPECTED_RSV_1',
          );
        }
        if (!this._fragmented) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'invalid opcode 0',
            true,
            1002,
            'WS_ERR_INVALID_OPCODE',
          );
        }
        this._opcode = this._fragmented;
      } else if (this._opcode === 0x01 || this._opcode === 0x02) {
        if (this._fragmented) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            'WS_ERR_INVALID_OPCODE',
          );
        }
        this._compressed = compressed;
      } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
        if (!this._fin) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'FIN must be set',
            true,
            1002,
            'WS_ERR_EXPECTED_FIN',
          );
        }
        if (compressed) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'RSV1 must be clear',
            true,
            1002,
            'WS_ERR_UNEXPECTED_RSV_1',
          );
        }
        if (this._payloadLength > 0x7d) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            `invalid payload length ${this._payloadLength}`,
            true,
            1002,
            'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH',
          );
        }
      } else {
        this._loop = false;
        return $72804d9adf684d0b$var$error(
          RangeError,
          `invalid opcode ${this._opcode}`,
          true,
          1002,
          'WS_ERR_INVALID_OPCODE',
        );
      }
      if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
      this._masked = (buf[1] & 0x80) === 0x80;
      if (this._isServer) {
        if (!this._masked) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'MASK must be set',
            true,
            1002,
            'WS_ERR_EXPECTED_MASK',
          );
        }
      } else if (this._masked) {
        this._loop = false;
        return $72804d9adf684d0b$var$error(
          RangeError,
          'MASK must be clear',
          true,
          1002,
          'WS_ERR_UNEXPECTED_MASK',
        );
      }
      if (this._payloadLength === 126)
        this._state = $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_16;
      else if (this._payloadLength === 127)
        this._state = $72804d9adf684d0b$var$GET_PAYLOAD_LENGTH_64;
      else return this.haveLength();
    }
    /**
     * Gets extended payload length (7+16).
     *
     * @return {(RangeError|undefined)} A possible error
     * @private
     */ getPayloadLength16() {
      if (this._bufferedBytes < 2) {
        this._loop = false;
        return;
      }
      this._payloadLength = this.consume(2).readUInt16BE(0);
      return this.haveLength();
    }
    /**
     * Gets extended payload length (7+64).
     *
     * @return {(RangeError|undefined)} A possible error
     * @private
     */ getPayloadLength64() {
      if (this._bufferedBytes < 8) {
        this._loop = false;
        return;
      }
      const buf = this.consume(8);
      const num = buf.readUInt32BE(0);
      //
      // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
      // if payload length is greater than this number.
      //
      if (num > Math.pow(2, 21) - 1) {
        this._loop = false;
        return $72804d9adf684d0b$var$error(
          RangeError,
          'Unsupported WebSocket frame: payload length > 2^53 - 1',
          false,
          1009,
          'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH',
        );
      }
      this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
      return this.haveLength();
    }
    /**
     * Payload length has been read.
     *
     * @return {(RangeError|undefined)} A possible error
     * @private
     */ haveLength() {
      if (this._payloadLength && this._opcode < 0x08) {
        this._totalPayloadLength += this._payloadLength;
        if (
          this._totalPayloadLength > this._maxPayload &&
          this._maxPayload > 0
        ) {
          this._loop = false;
          return $72804d9adf684d0b$var$error(
            RangeError,
            'Max payload size exceeded',
            false,
            1009,
            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
          );
        }
      }
      if (this._masked) this._state = $72804d9adf684d0b$var$GET_MASK;
      else this._state = $72804d9adf684d0b$var$GET_DATA;
    }
    /**
     * Reads mask bytes.
     *
     * @private
     */ getMask() {
      if (this._bufferedBytes < 4) {
        this._loop = false;
        return;
      }
      this._mask = this.consume(4);
      this._state = $72804d9adf684d0b$var$GET_DATA;
    }
    /**
     * Reads data bytes.
     *
     * @param {Function} cb Callback
     * @return {(Error|RangeError|undefined)} A possible error
     * @private
     */ getData(cb) {
      let data = $72804d9adf684d0b$require$EMPTY_BUFFER;
      if (this._payloadLength) {
        if (this._bufferedBytes < this._payloadLength) {
          this._loop = false;
          return;
        }
        data = this.consume(this._payloadLength);
        if (this._masked) $72804d9adf684d0b$require$unmask(data, this._mask);
      }
      if (this._opcode > 0x07) return this.controlMessage(data);
      if (this._compressed) {
        this._state = $72804d9adf684d0b$var$INFLATING;
        this.decompress(data, cb);
        return;
      }
      if (data.length) {
        //
        // This message is not compressed so its lenght is the sum of the payload
        // length of all fragments.
        //
        this._messageLength = this._totalPayloadLength;
        this._fragments.push(data);
      }
      return this.dataMessage();
    }
    /**
     * Decompresses data.
     *
     * @param {Buffer} data Compressed data
     * @param {Function} cb Callback
     * @private
     */ decompress(data, cb) {
      const perMessageDeflate = this._extensions[$5QfTR.extensionName];
      perMessageDeflate.decompress(data, this._fin, (err, buf) => {
        if (err) return cb(err);
        if (buf.length) {
          this._messageLength += buf.length;
          if (this._messageLength > this._maxPayload && this._maxPayload > 0)
            return cb(
              $72804d9adf684d0b$var$error(
                RangeError,
                'Max payload size exceeded',
                false,
                1009,
                'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
              ),
            );
          this._fragments.push(buf);
        }
        const er = this.dataMessage();
        if (er) return cb(er);
        this.startLoop(cb);
      });
    }
    /**
     * Handles a data message.
     *
     * @return {(Error|undefined)} A possible error
     * @private
     */ dataMessage() {
      if (this._fin) {
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === 'nodebuffer')
            data = $72804d9adf684d0b$require$concat(fragments, messageLength);
          else if (this._binaryType === 'arraybuffer')
            data = $72804d9adf684d0b$require$toArrayBuffer(
              $72804d9adf684d0b$require$concat(fragments, messageLength),
            );
          else data = fragments;
          this.emit('message', data);
        } else {
          const buf = $72804d9adf684d0b$require$concat(
            fragments,
            messageLength,
          );
          if (!$72804d9adf684d0b$require$isValidUTF8(buf)) {
            this._loop = false;
            return $72804d9adf684d0b$var$error(
              Error,
              'invalid UTF-8 sequence',
              true,
              1007,
              'WS_ERR_INVALID_UTF8',
            );
          }
          this.emit('message', buf.toString());
        }
      }
      this._state = $72804d9adf684d0b$var$GET_INFO;
    }
    /**
     * Handles a control message.
     *
     * @param {Buffer} data Data to handle
     * @return {(Error|RangeError|undefined)} A possible error
     * @private
     */ controlMessage(data) {
      if (this._opcode === 0x08) {
        this._loop = false;
        if (data.length === 0) {
          this.emit('conclude', 1005, '');
          this.end();
        } else if (data.length === 1)
          return $72804d9adf684d0b$var$error(
            RangeError,
            'invalid payload length 1',
            true,
            1002,
            'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH',
          );
        else {
          const code = data.readUInt16BE(0);
          if (!$72804d9adf684d0b$require$isValidStatusCode(code))
            return $72804d9adf684d0b$var$error(
              RangeError,
              `invalid status code ${code}`,
              true,
              1002,
              'WS_ERR_INVALID_CLOSE_CODE',
            );
          const buf = data.slice(2);
          if (!$72804d9adf684d0b$require$isValidUTF8(buf))
            return $72804d9adf684d0b$var$error(
              Error,
              'invalid UTF-8 sequence',
              true,
              1007,
              'WS_ERR_INVALID_UTF8',
            );
          this.emit('conclude', code, buf.toString());
          this.end();
        }
      } else if (this._opcode === 0x09) this.emit('ping', data);
      else this.emit('pong', data);
      this._state = $72804d9adf684d0b$var$GET_INFO;
    }
  }
  module.exports = $72804d9adf684d0b$var$Receiver;
  /**
   * Builds an error object.
   *
   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
   * @param {String} message The error message
   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
   *     `message`
   * @param {Number} statusCode The status code
   * @param {String} errorCode The exposed error code
   * @return {(Error|RangeError)} The error
   * @private
   */ function $72804d9adf684d0b$var$error(
    ErrorCtor,
    message,
    prefix,
    statusCode,
    errorCode,
  ) {
    const err = new ErrorCtor(
      prefix ? `Invalid WebSocket frame: ${message}` : message,
    );
    Error.captureStackTrace(err, $72804d9adf684d0b$var$error);
    err.code = errorCode;
    err[$72804d9adf684d0b$require$kStatusCode] = statusCode;
    return err;
  }
});
parcelRegister('5QfTR', function (module, exports) {
  'use strict';

  var $2vcMF = parcelRequire('2vcMF');

  var $3v2CE = parcelRequire('3v2CE');

  var $97vyB = parcelRequire('97vyB');
  var $440e247fcf48a40e$require$kStatusCode = $97vyB.kStatusCode;
  var $440e247fcf48a40e$require$NOOP = $97vyB.NOOP;
  const $440e247fcf48a40e$var$TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
  const $440e247fcf48a40e$var$kPerMessageDeflate = Symbol('permessage-deflate');
  const $440e247fcf48a40e$var$kTotalLength = Symbol('total-length');
  const $440e247fcf48a40e$var$kCallback = Symbol('callback');
  const $440e247fcf48a40e$var$kBuffers = Symbol('buffers');
  const $440e247fcf48a40e$var$kError = Symbol('error');
  //
  // We limit zlib concurrency, which prevents severe memory fragmentation
  // as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
  // and https://github.com/websockets/ws/issues/1202
  //
  // Intentionally global; it's the global thread pool that's an issue.
  //
  let $440e247fcf48a40e$var$zlibLimiter;
  /**
   * permessage-deflate implementation.
   */ class $440e247fcf48a40e$var$PerMessageDeflate {
    /**
     * Creates a PerMessageDeflate instance.
     *
     * @param {Object} [options] Configuration options
     * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
     *     disabling of server context takeover
     * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
     *     acknowledge disabling of client context takeover
     * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
     *     use of a custom server window size
     * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
     *     for, or request, a custom client window size
     * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
     *     deflate
     * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
     *     inflate
     * @param {Number} [options.threshold=1024] Size (in bytes) below which
     *     messages should not be compressed
     * @param {Number} [options.concurrencyLimit=10] The number of concurrent
     *     calls to zlib
     * @param {Boolean} [isServer=false] Create the instance in either server or
     *     client mode
     * @param {Number} [maxPayload=0] The maximum allowed message length
     */ constructor(options, isServer, maxPayload) {
      this._maxPayload = maxPayload | 0;
      this._options = options || {};
      this._threshold =
        this._options.threshold !== undefined ? this._options.threshold : 1024;
      this._isServer = !!isServer;
      this._deflate = null;
      this._inflate = null;
      this.params = null;
      if (!$440e247fcf48a40e$var$zlibLimiter) {
        const concurrency =
          this._options.concurrencyLimit !== undefined
            ? this._options.concurrencyLimit
            : 10;
        $440e247fcf48a40e$var$zlibLimiter = new $3v2CE(concurrency);
      }
    }
    /**
     * @type {String}
     */ static get extensionName() {
      return 'permessage-deflate';
    }
    /**
     * Create an extension negotiation offer.
     *
     * @return {Object} Extension parameters
     * @public
     */ offer() {
      const params = {};
      if (this._options.serverNoContextTakeover)
        params.server_no_context_takeover = true;
      if (this._options.clientNoContextTakeover)
        params.client_no_context_takeover = true;
      if (this._options.serverMaxWindowBits)
        params.server_max_window_bits = this._options.serverMaxWindowBits;
      if (this._options.clientMaxWindowBits)
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      else if (this._options.clientMaxWindowBits == null)
        params.client_max_window_bits = true;
      return params;
    }
    /**
     * Accept an extension negotiation offer/response.
     *
     * @param {Array} configurations The extension negotiation offers/reponse
     * @return {Object} Accepted configuration
     * @public
     */ accept(configurations) {
      configurations = this.normalizeParams(configurations);
      this.params = this._isServer
        ? this.acceptAsServer(configurations)
        : this.acceptAsClient(configurations);
      return this.params;
    }
    /**
     * Releases all resources used by the extension.
     *
     * @public
     */ cleanup() {
      if (this._inflate) {
        this._inflate.close();
        this._inflate = null;
      }
      if (this._deflate) {
        const callback = this._deflate[$440e247fcf48a40e$var$kCallback];
        this._deflate.close();
        this._deflate = null;
        if (callback)
          callback(
            new Error(
              'The deflate stream was closed while data was being processed',
            ),
          );
      }
    }
    /**
     *  Accept an extension negotiation offer.
     *
     * @param {Array} offers The extension negotiation offers
     * @return {Object} Accepted configuration
     * @private
     */ acceptAsServer(offers) {
      const opts = this._options;
      const accepted = offers.find(params => {
        if (
          (opts.serverNoContextTakeover === false &&
            params.server_no_context_takeover) ||
          (params.server_max_window_bits &&
            (opts.serverMaxWindowBits === false ||
              (typeof opts.serverMaxWindowBits === 'number' &&
                opts.serverMaxWindowBits > params.server_max_window_bits))) ||
          (typeof opts.clientMaxWindowBits === 'number' &&
            !params.client_max_window_bits)
        )
          return false;
        return true;
      });
      if (!accepted)
        throw new Error('None of the extension offers can be accepted');
      if (opts.serverNoContextTakeover)
        accepted.server_no_context_takeover = true;
      if (opts.clientNoContextTakeover)
        accepted.client_no_context_takeover = true;
      if (typeof opts.serverMaxWindowBits === 'number')
        accepted.server_max_window_bits = opts.serverMaxWindowBits;
      if (typeof opts.clientMaxWindowBits === 'number')
        accepted.client_max_window_bits = opts.clientMaxWindowBits;
      else if (
        accepted.client_max_window_bits === true ||
        opts.clientMaxWindowBits === false
      )
        delete accepted.client_max_window_bits;
      return accepted;
    }
    /**
     * Accept the extension negotiation response.
     *
     * @param {Array} response The extension negotiation response
     * @return {Object} Accepted configuration
     * @private
     */ acceptAsClient(response) {
      const params = response[0];
      if (
        this._options.clientNoContextTakeover === false &&
        params.client_no_context_takeover
      )
        throw new Error('Unexpected parameter "client_no_context_takeover"');
      if (!params.client_max_window_bits) {
        if (typeof this._options.clientMaxWindowBits === 'number')
          params.client_max_window_bits = this._options.clientMaxWindowBits;
      } else if (this._options.clientMaxWindowBits === false || (typeof this._options.clientMaxWindowBits === 'number' && params.client_max_window_bits > this._options.clientMaxWindowBits)) throw new Error('Unexpected or invalid parameter "client_max_window_bits"');
      return params;
    }
    /**
     * Normalize parameters.
     *
     * @param {Array} configurations The extension negotiation offers/reponse
     * @return {Array} The offers/response with normalized parameters
     * @private
     */ normalizeParams(configurations) {
      configurations.forEach(params => {
        Object.keys(params).forEach(key => {
          let value = params[key];
          if (value.length > 1)
            throw new Error(`Parameter "${key}" must have only a single value`);
          value = value[0];
          if (key === 'client_max_window_bits') {
            if (value !== true) {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15)
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`,
                );
              value = num;
            } else if (!this._isServer)
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`,
              );
          } else if (key === 'server_max_window_bits') {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15)
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`,
              );
            value = num;
          } else if (
            key === 'client_no_context_takeover' ||
            key === 'server_no_context_takeover'
          ) {
            if (value !== true)
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`,
              );
          } else throw new Error(`Unknown parameter "${key}"`);
          params[key] = value;
        });
      });
      return configurations;
    }
    /**
     * Decompress data. Concurrency limited.
     *
     * @param {Buffer} data Compressed data
     * @param {Boolean} fin Specifies whether or not this is the last fragment
     * @param {Function} callback Callback
     * @public
     */ decompress(data, fin, callback) {
      $440e247fcf48a40e$var$zlibLimiter.add(done => {
        this._decompress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    /**
     * Compress data. Concurrency limited.
     *
     * @param {Buffer} data Data to compress
     * @param {Boolean} fin Specifies whether or not this is the last fragment
     * @param {Function} callback Callback
     * @public
     */ compress(data, fin, callback) {
      $440e247fcf48a40e$var$zlibLimiter.add(done => {
        this._compress(data, fin, (err, result) => {
          done();
          callback(err, result);
        });
      });
    }
    /**
     * Decompress data.
     *
     * @param {Buffer} data Compressed data
     * @param {Boolean} fin Specifies whether or not this is the last fragment
     * @param {Function} callback Callback
     * @private
     */ _decompress(data, fin, callback) {
      const endpoint = this._isServer ? 'client' : 'server';
      if (!this._inflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits =
          typeof this.params[key] !== 'number'
            ? $dmXIQ$zlib.Z_DEFAULT_WINDOWBITS
            : this.params[key];
        this._inflate = $dmXIQ$zlib.createInflateRaw({
          ...this._options.zlibInflateOptions,
          windowBits: windowBits,
        });
        this._inflate[$440e247fcf48a40e$var$kPerMessageDeflate] = this;
        this._inflate[$440e247fcf48a40e$var$kTotalLength] = 0;
        this._inflate[$440e247fcf48a40e$var$kBuffers] = [];
        this._inflate.on('error', $440e247fcf48a40e$var$inflateOnError);
        this._inflate.on('data', $440e247fcf48a40e$var$inflateOnData);
      }
      this._inflate[$440e247fcf48a40e$var$kCallback] = callback;
      this._inflate.write(data);
      if (fin) this._inflate.write($440e247fcf48a40e$var$TRAILER);
      this._inflate.flush(() => {
        const err = this._inflate[$440e247fcf48a40e$var$kError];
        if (err) {
          this._inflate.close();
          this._inflate = null;
          callback(err);
          return;
        }
        const data = $2vcMF.concat(
          this._inflate[$440e247fcf48a40e$var$kBuffers],
          this._inflate[$440e247fcf48a40e$var$kTotalLength],
        );
        if (this._inflate._readableState.endEmitted) {
          this._inflate.close();
          this._inflate = null;
        } else {
          this._inflate[$440e247fcf48a40e$var$kTotalLength] = 0;
          this._inflate[$440e247fcf48a40e$var$kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`])
            this._inflate.reset();
        }
        callback(null, data);
      });
    }
    /**
     * Compress data.
     *
     * @param {Buffer} data Data to compress
     * @param {Boolean} fin Specifies whether or not this is the last fragment
     * @param {Function} callback Callback
     * @private
     */ _compress(data, fin, callback) {
      const endpoint = this._isServer ? 'server' : 'client';
      if (!this._deflate) {
        const key = `${endpoint}_max_window_bits`;
        const windowBits =
          typeof this.params[key] !== 'number'
            ? $dmXIQ$zlib.Z_DEFAULT_WINDOWBITS
            : this.params[key];
        this._deflate = $dmXIQ$zlib.createDeflateRaw({
          ...this._options.zlibDeflateOptions,
          windowBits: windowBits,
        });
        this._deflate[$440e247fcf48a40e$var$kTotalLength] = 0;
        this._deflate[$440e247fcf48a40e$var$kBuffers] = [];
        //
        // An `'error'` event is emitted, only on Node.js < 10.0.0, if the
        // `zlib.DeflateRaw` instance is closed while data is being processed.
        // This can happen if `PerMessageDeflate#cleanup()` is called at the wrong
        // time due to an abnormal WebSocket closure.
        //
        this._deflate.on('error', $440e247fcf48a40e$require$NOOP);
        this._deflate.on('data', $440e247fcf48a40e$var$deflateOnData);
      }
      this._deflate[$440e247fcf48a40e$var$kCallback] = callback;
      this._deflate.write(data);
      this._deflate.flush($dmXIQ$zlib.Z_SYNC_FLUSH, () => {
        if (!this._deflate)
          //
          // The deflate stream was closed while data was being processed.
          //
          return;
        let data = $2vcMF.concat(
          this._deflate[$440e247fcf48a40e$var$kBuffers],
          this._deflate[$440e247fcf48a40e$var$kTotalLength],
        );
        if (fin) data = data.slice(0, data.length - 4);
        //
        // Ensure that the callback will not be called again in
        // `PerMessageDeflate#cleanup()`.
        //
        this._deflate[$440e247fcf48a40e$var$kCallback] = null;
        this._deflate[$440e247fcf48a40e$var$kTotalLength] = 0;
        this._deflate[$440e247fcf48a40e$var$kBuffers] = [];
        if (fin && this.params[`${endpoint}_no_context_takeover`])
          this._deflate.reset();
        callback(null, data);
      });
    }
  }
  module.exports = $440e247fcf48a40e$var$PerMessageDeflate;
  /**
   * The listener of the `zlib.DeflateRaw` stream `'data'` event.
   *
   * @param {Buffer} chunk A chunk of data
   * @private
   */ function $440e247fcf48a40e$var$deflateOnData(chunk) {
    this[$440e247fcf48a40e$var$kBuffers].push(chunk);
    this[$440e247fcf48a40e$var$kTotalLength] += chunk.length;
  }
  /**
   * The listener of the `zlib.InflateRaw` stream `'data'` event.
   *
   * @param {Buffer} chunk A chunk of data
   * @private
   */ function $440e247fcf48a40e$var$inflateOnData(chunk) {
    this[$440e247fcf48a40e$var$kTotalLength] += chunk.length;
    if (
      this[$440e247fcf48a40e$var$kPerMessageDeflate]._maxPayload < 1 ||
      this[$440e247fcf48a40e$var$kTotalLength] <=
        this[$440e247fcf48a40e$var$kPerMessageDeflate]._maxPayload
    ) {
      this[$440e247fcf48a40e$var$kBuffers].push(chunk);
      return;
    }
    this[$440e247fcf48a40e$var$kError] = new RangeError(
      'Max payload size exceeded',
    );
    this[$440e247fcf48a40e$var$kError].code =
      'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
    this[$440e247fcf48a40e$var$kError][
      $440e247fcf48a40e$require$kStatusCode
    ] = 1009;
    this.removeListener('data', $440e247fcf48a40e$var$inflateOnData);
    this.reset();
  }
  /**
   * The listener of the `zlib.InflateRaw` stream `'error'` event.
   *
   * @param {Error} err The emitted error
   * @private
   */ function $440e247fcf48a40e$var$inflateOnError(err) {
    //
    // There is no need to call `Zlib#close()` as the handle is automatically
    // closed when an error is emitted.
    //
    this[$440e247fcf48a40e$var$kPerMessageDeflate]._inflate = null;
    err[$440e247fcf48a40e$require$kStatusCode] = 1007;
    this[$440e247fcf48a40e$var$kCallback](err);
  }
});
parcelRegister('2vcMF', function (module, exports) {
  'use strict';

  var $97vyB = parcelRequire('97vyB');
  var $1d2864aa8436f0bd$require$EMPTY_BUFFER = $97vyB.EMPTY_BUFFER;
  /**
   * Merges an array of buffers into a new buffer.
   *
   * @param {Buffer[]} list The array of buffers to concat
   * @param {Number} totalLength The total length of buffers in the list
   * @return {Buffer} The resulting buffer
   * @public
   */ function $1d2864aa8436f0bd$var$concat(list, totalLength) {
    if (list.length === 0) return $1d2864aa8436f0bd$require$EMPTY_BUFFER;
    if (list.length === 1) return list[0];
    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      target.set(buf, offset);
      offset += buf.length;
    }
    if (offset < totalLength) return target.slice(0, offset);
    return target;
  }
  /**
   * Masks a buffer using the given mask.
   *
   * @param {Buffer} source The buffer to mask
   * @param {Buffer} mask The mask to use
   * @param {Buffer} output The buffer where to store the result
   * @param {Number} offset The offset at which to start writing
   * @param {Number} length The number of bytes to mask.
   * @public
   */ function $1d2864aa8436f0bd$var$_mask(
    source,
    mask,
    output,
    offset,
    length,
  ) {
    for (let i = 0; i < length; i++)
      output[offset + i] = source[i] ^ mask[i & 3];
  }
  /**
   * Unmasks a buffer using the given mask.
   *
   * @param {Buffer} buffer The buffer to unmask
   * @param {Buffer} mask The mask to use
   * @public
   */ function $1d2864aa8436f0bd$var$_unmask(buffer, mask) {
    // Required until https://github.com/nodejs/node/issues/9006 is resolved.
    const length = buffer.length;
    for (let i = 0; i < length; i++) buffer[i] ^= mask[i & 3];
  }
  /**
   * Converts a buffer to an `ArrayBuffer`.
   *
   * @param {Buffer} buf The buffer to convert
   * @return {ArrayBuffer} Converted buffer
   * @public
   */ function $1d2864aa8436f0bd$var$toArrayBuffer(buf) {
    if (buf.byteLength === buf.buffer.byteLength) return buf.buffer;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  /**
   * Converts `data` to a `Buffer`.
   *
   * @param {*} data The data to convert
   * @return {Buffer} The buffer
   * @throws {TypeError}
   * @public
   */ function $1d2864aa8436f0bd$var$toBuffer(data) {
    $1d2864aa8436f0bd$var$toBuffer.readOnly = true;
    if (Buffer.isBuffer(data)) return data;
    let buf;
    if (data instanceof ArrayBuffer) buf = Buffer.from(data);
    else if (ArrayBuffer.isView(data))
      buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else {
      buf = Buffer.from(data);
      $1d2864aa8436f0bd$var$toBuffer.readOnly = false;
    }
    return buf;
  }

  try {
    const bufferUtil = $1d2864aa8436f0bd$import$8b5037d33e2670b;
    const bu = bufferUtil.BufferUtil || bufferUtil;
    module.exports = {
      concat: $1d2864aa8436f0bd$var$concat,
      mask(source, mask, output, offset, length) {
        if (length < 48)
          $1d2864aa8436f0bd$var$_mask(source, mask, output, offset, length);
        else bu.mask(source, mask, output, offset, length);
      },
      toArrayBuffer: $1d2864aa8436f0bd$var$toArrayBuffer,
      toBuffer: $1d2864aa8436f0bd$var$toBuffer,
      unmask(buffer, mask) {
        if (buffer.length < 32) $1d2864aa8436f0bd$var$_unmask(buffer, mask);
        else bu.unmask(buffer, mask);
      },
    };
  } catch (e) /* istanbul ignore next */ {
    module.exports = {
      concat: $1d2864aa8436f0bd$var$concat,
      mask: $1d2864aa8436f0bd$var$_mask,
      toArrayBuffer: $1d2864aa8436f0bd$var$toArrayBuffer,
      toBuffer: $1d2864aa8436f0bd$var$toBuffer,
      unmask: $1d2864aa8436f0bd$var$_unmask,
    };
  }
});
parcelRegister('97vyB', function (module, exports) {
  'use strict';
  module.exports = {
    BINARY_TYPES: ['nodebuffer', 'arraybuffer', 'fragments'],
    GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    kStatusCode: Symbol('status-code'),
    kWebSocket: Symbol('websocket'),
    EMPTY_BUFFER: Buffer.alloc(0),
    NOOP: () => {},
  };
});

parcelRegister('3v2CE', function (module, exports) {
  'use strict';
  const $28c64d19d7f6856d$var$kDone = Symbol('kDone');
  const $28c64d19d7f6856d$var$kRun = Symbol('kRun');
  /**
   * A very simple job queue with adjustable concurrency. Adapted from
   * https://github.com/STRML/async-limiter
   */ class $28c64d19d7f6856d$var$Limiter {
    /**
     * Creates a new `Limiter`.
     *
     * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
     *     to run concurrently
     */ constructor(concurrency) {
      this[$28c64d19d7f6856d$var$kDone] = () => {
        this.pending--;
        this[$28c64d19d7f6856d$var$kRun]();
      };
      this.concurrency = concurrency || Infinity;
      this.jobs = [];
      this.pending = 0;
    }
    /**
     * Adds a job to the queue.
     *
     * @param {Function} job The job to run
     * @public
     */ add(job) {
      this.jobs.push(job);
      this[$28c64d19d7f6856d$var$kRun]();
    }
    /**
     * Removes a job from the queue and runs it if possible.
     *
     * @private
     */ [$28c64d19d7f6856d$var$kRun]() {
      if (this.pending === this.concurrency) return;
      if (this.jobs.length) {
        const job = this.jobs.shift();
        this.pending++;
        job(this[$28c64d19d7f6856d$var$kDone]);
      }
    }
  }
  module.exports = $28c64d19d7f6856d$var$Limiter;
});

parcelRegister('hONSk', function (module, exports) {
  'use strict';
  /**
   * Checks if a status code is allowed in a close frame.
   *
   * @param {Number} code The status code
   * @return {Boolean} `true` if the status code is valid, else `false`
   * @public
   */ function $cf8dcb64e00c4120$var$isValidStatusCode(code) {
    return (
      (code >= 1000 &&
        code <= 1014 &&
        code !== 1004 &&
        code !== 1005 &&
        code !== 1006) ||
      (code >= 3000 && code <= 4999)
    );
  }
  /**
   * Checks if a given buffer contains only correct UTF-8.
   * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
   * Markus Kuhn.
   *
   * @param {Buffer} buf The buffer to check
   * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
   * @public
   */ function $cf8dcb64e00c4120$var$_isValidUTF8(buf) {
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if ((buf[i] & 0x80) === 0)
        // 0xxxxxxx
        i++;
      else if ((buf[i] & 0xe0) === 0xc0) {
        // 110xxxxx 10xxxxxx
        if (
          i + 1 === len ||
          (buf[i + 1] & 0xc0) !== 0x80 ||
          (buf[i] & 0xfe) === 0xc0 // Overlong
        )
          return false;
        i += 2;
      } else if ((buf[i] & 0xf0) === 0xe0) {
        // 1110xxxx 10xxxxxx 10xxxxxx
        if (
          i + 2 >= len ||
          (buf[i + 1] & 0xc0) !== 0x80 ||
          (buf[i + 2] & 0xc0) !== 0x80 ||
          (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
          (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
        )
          return false;
        i += 3;
      } else if ((buf[i] & 0xf8) === 0xf0) {
        // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
        if (
          i + 3 >= len ||
          (buf[i + 1] & 0xc0) !== 0x80 ||
          (buf[i + 2] & 0xc0) !== 0x80 ||
          (buf[i + 3] & 0xc0) !== 0x80 ||
          (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
          (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
          buf[i] > 0xf4 // > U+10FFFF
        )
          return false;
        i += 4;
      } else return false;
    }
    return true;
  }

  try {
    let isValidUTF8 = $cf8dcb64e00c4120$import$d1e5aed6682b23d4;
    /* istanbul ignore if */ if (typeof isValidUTF8 === 'object')
      isValidUTF8 = isValidUTF8.Validation.isValidUTF8; // utf-8-validate@<3.0.0
    module.exports = {
      isValidStatusCode: $cf8dcb64e00c4120$var$isValidStatusCode,
      isValidUTF8(buf) {
        return buf.length < 150
          ? $cf8dcb64e00c4120$var$_isValidUTF8(buf)
          : isValidUTF8(buf);
      },
    };
  } catch (e) /* istanbul ignore next */ {
    module.exports = {
      isValidStatusCode: $cf8dcb64e00c4120$var$isValidStatusCode,
      isValidUTF8: $cf8dcb64e00c4120$var$_isValidUTF8,
    };
  }
});

parcelRegister('f0Djp', function (module, exports) {
  /* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^net|tls$" }] */ 'use strict';

  var $aed559aeaf7b17f8$require$randomFillSync = $dmXIQ$crypto.randomFillSync;

  var $5QfTR = parcelRequire('5QfTR');

  var $97vyB = parcelRequire('97vyB');
  var $aed559aeaf7b17f8$require$EMPTY_BUFFER = $97vyB.EMPTY_BUFFER;

  var $hONSk = parcelRequire('hONSk');
  var $aed559aeaf7b17f8$require$isValidStatusCode = $hONSk.isValidStatusCode;

  var $2vcMF = parcelRequire('2vcMF');
  var $aed559aeaf7b17f8$require$applyMask = $2vcMF.mask;
  var $aed559aeaf7b17f8$require$toBuffer = $2vcMF.toBuffer;
  const $aed559aeaf7b17f8$var$mask = Buffer.alloc(4);
  /**
   * HyBi Sender implementation.
   */ class $aed559aeaf7b17f8$var$Sender {
    /**
     * Creates a Sender instance.
     *
     * @param {(net.Socket|tls.Socket)} socket The connection socket
     * @param {Object} [extensions] An object containing the negotiated extensions
     */ constructor(socket, extensions) {
      this._extensions = extensions || {};
      this._socket = socket;
      this._firstFragment = true;
      this._compress = false;
      this._bufferedBytes = 0;
      this._deflating = false;
      this._queue = [];
    }
    /**
     * Frames a piece of data according to the HyBi WebSocket protocol.
     *
     * @param {Buffer} data The data to frame
     * @param {Object} options Options object
     * @param {Number} options.opcode The opcode
     * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
     *     modified
     * @param {Boolean} [options.fin=false] Specifies whether or not to set the
     *     FIN bit
     * @param {Boolean} [options.mask=false] Specifies whether or not to mask
     *     `data`
     * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
     *     RSV1 bit
     * @return {Buffer[]} The framed data as a list of `Buffer` instances
     * @public
     */ static frame(data, options) {
      const merge = options.mask && options.readOnly;
      let offset = options.mask ? 6 : 2;
      let payloadLength = data.length;
      if (data.length >= 65536) {
        offset += 8;
        payloadLength = 127;
      } else if (data.length > 125) {
        offset += 2;
        payloadLength = 126;
      }
      const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);
      target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
      if (options.rsv1) target[0] |= 0x40;
      target[1] = payloadLength;
      if (payloadLength === 126) target.writeUInt16BE(data.length, 2);
      else if (payloadLength === 127) {
        target.writeUInt32BE(0, 2);
        target.writeUInt32BE(data.length, 6);
      }
      if (!options.mask) return [target, data];
      $aed559aeaf7b17f8$require$randomFillSync(
        $aed559aeaf7b17f8$var$mask,
        0,
        4,
      );
      target[1] |= 0x80;
      target[offset - 4] = $aed559aeaf7b17f8$var$mask[0];
      target[offset - 3] = $aed559aeaf7b17f8$var$mask[1];
      target[offset - 2] = $aed559aeaf7b17f8$var$mask[2];
      target[offset - 1] = $aed559aeaf7b17f8$var$mask[3];
      if (merge) {
        $aed559aeaf7b17f8$require$applyMask(
          data,
          $aed559aeaf7b17f8$var$mask,
          target,
          offset,
          data.length,
        );
        return [target];
      }
      $aed559aeaf7b17f8$require$applyMask(
        data,
        $aed559aeaf7b17f8$var$mask,
        data,
        0,
        data.length,
      );
      return [target, data];
    }
    /**
     * Sends a close message to the other peer.
     *
     * @param {Number} [code] The status code component of the body
     * @param {String} [data] The message component of the body
     * @param {Boolean} [mask=false] Specifies whether or not to mask the message
     * @param {Function} [cb] Callback
     * @public
     */ close(code, data, mask, cb) {
      let buf;
      if (code === undefined) buf = $aed559aeaf7b17f8$require$EMPTY_BUFFER;
      else if (
        typeof code !== 'number' ||
        !$aed559aeaf7b17f8$require$isValidStatusCode(code)
      )
        throw new TypeError('First argument must be a valid error code number');
      else if (data === undefined || data === '') {
        buf = Buffer.allocUnsafe(2);
        buf.writeUInt16BE(code, 0);
      } else {
        const length = Buffer.byteLength(data);
        if (length > 123)
          throw new RangeError(
            'The message must not be greater than 123 bytes',
          );
        buf = Buffer.allocUnsafe(2 + length);
        buf.writeUInt16BE(code, 0);
        buf.write(data, 2);
      }
      if (this._deflating) this.enqueue([this.doClose, buf, mask, cb]);
      else this.doClose(buf, mask, cb);
    }
    /**
     * Frames and sends a close message.
     *
     * @param {Buffer} data The message to send
     * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
     * @param {Function} [cb] Callback
     * @private
     */ doClose(data, mask, cb) {
      this.sendFrame(
        $aed559aeaf7b17f8$var$Sender.frame(data, {
          fin: true,
          rsv1: false,
          opcode: 0x08,
          mask: mask,
          readOnly: false,
        }),
        cb,
      );
    }
    /**
     * Sends a ping message to the other peer.
     *
     * @param {*} data The message to send
     * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
     * @param {Function} [cb] Callback
     * @public
     */ ping(data, mask, cb) {
      const buf = $aed559aeaf7b17f8$require$toBuffer(data);
      if (buf.length > 125)
        throw new RangeError(
          'The data size must not be greater than 125 bytes',
        );
      if (this._deflating)
        this.enqueue([
          this.doPing,
          buf,
          mask,
          $aed559aeaf7b17f8$require$toBuffer.readOnly,
          cb,
        ]);
      else
        this.doPing(buf, mask, $aed559aeaf7b17f8$require$toBuffer.readOnly, cb);
    }
    /**
     * Frames and sends a ping message.
     *
     * @param {Buffer} data The message to send
     * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
     * @param {Boolean} [readOnly=false] Specifies whether `data` can be modified
     * @param {Function} [cb] Callback
     * @private
     */ doPing(data, mask, readOnly, cb) {
      this.sendFrame(
        $aed559aeaf7b17f8$var$Sender.frame(data, {
          fin: true,
          rsv1: false,
          opcode: 0x09,
          mask: mask,
          readOnly: readOnly,
        }),
        cb,
      );
    }
    /**
     * Sends a pong message to the other peer.
     *
     * @param {*} data The message to send
     * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
     * @param {Function} [cb] Callback
     * @public
     */ pong(data, mask, cb) {
      const buf = $aed559aeaf7b17f8$require$toBuffer(data);
      if (buf.length > 125)
        throw new RangeError(
          'The data size must not be greater than 125 bytes',
        );
      if (this._deflating)
        this.enqueue([
          this.doPong,
          buf,
          mask,
          $aed559aeaf7b17f8$require$toBuffer.readOnly,
          cb,
        ]);
      else
        this.doPong(buf, mask, $aed559aeaf7b17f8$require$toBuffer.readOnly, cb);
    }
    /**
     * Frames and sends a pong message.
     *
     * @param {Buffer} data The message to send
     * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
     * @param {Boolean} [readOnly=false] Specifies whether `data` can be modified
     * @param {Function} [cb] Callback
     * @private
     */ doPong(data, mask, readOnly, cb) {
      this.sendFrame(
        $aed559aeaf7b17f8$var$Sender.frame(data, {
          fin: true,
          rsv1: false,
          opcode: 0x0a,
          mask: mask,
          readOnly: readOnly,
        }),
        cb,
      );
    }
    /**
     * Sends a data message to the other peer.
     *
     * @param {*} data The message to send
     * @param {Object} options Options object
     * @param {Boolean} [options.compress=false] Specifies whether or not to
     *     compress `data`
     * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
     *     or text
     * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
     *     last one
     * @param {Boolean} [options.mask=false] Specifies whether or not to mask
     *     `data`
     * @param {Function} [cb] Callback
     * @public
     */ send(data, options, cb) {
      const buf = $aed559aeaf7b17f8$require$toBuffer(data);
      const perMessageDeflate = this._extensions[$5QfTR.extensionName];
      let opcode = options.binary ? 2 : 1;
      let rsv1 = options.compress;
      if (this._firstFragment) {
        this._firstFragment = false;
        if (rsv1 && perMessageDeflate)
          rsv1 = buf.length >= perMessageDeflate._threshold;
        this._compress = rsv1;
      } else {
        rsv1 = false;
        opcode = 0;
      }
      if (options.fin) this._firstFragment = true;
      if (perMessageDeflate) {
        const opts = {
          fin: options.fin,
          rsv1: rsv1,
          opcode: opcode,
          mask: options.mask,
          readOnly: $aed559aeaf7b17f8$require$toBuffer.readOnly,
        };
        if (this._deflating)
          this.enqueue([this.dispatch, buf, this._compress, opts, cb]);
        else this.dispatch(buf, this._compress, opts, cb);
      } else
        this.sendFrame(
          $aed559aeaf7b17f8$var$Sender.frame(buf, {
            fin: options.fin,
            rsv1: false,
            opcode: opcode,
            mask: options.mask,
            readOnly: $aed559aeaf7b17f8$require$toBuffer.readOnly,
          }),
          cb,
        );
    }
    /**
     * Dispatches a data message.
     *
     * @param {Buffer} data The message to send
     * @param {Boolean} [compress=false] Specifies whether or not to compress
     *     `data`
     * @param {Object} options Options object
     * @param {Number} options.opcode The opcode
     * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
     *     modified
     * @param {Boolean} [options.fin=false] Specifies whether or not to set the
     *     FIN bit
     * @param {Boolean} [options.mask=false] Specifies whether or not to mask
     *     `data`
     * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
     *     RSV1 bit
     * @param {Function} [cb] Callback
     * @private
     */ dispatch(data, compress, options, cb) {
      if (!compress) {
        this.sendFrame($aed559aeaf7b17f8$var$Sender.frame(data, options), cb);
        return;
      }
      const perMessageDeflate = this._extensions[$5QfTR.extensionName];
      this._bufferedBytes += data.length;
      this._deflating = true;
      perMessageDeflate.compress(data, options.fin, (_, buf) => {
        if (this._socket.destroyed) {
          const err = new Error(
            'The socket was closed while data was being compressed',
          );
          if (typeof cb === 'function') cb(err);
          for (let i = 0; i < this._queue.length; i++) {
            const callback = this._queue[i][4];
            if (typeof callback === 'function') callback(err);
          }
          return;
        }
        this._bufferedBytes -= data.length;
        this._deflating = false;
        options.readOnly = false;
        this.sendFrame($aed559aeaf7b17f8$var$Sender.frame(buf, options), cb);
        this.dequeue();
      });
    }
    /**
     * Executes queued send operations.
     *
     * @private
     */ dequeue() {
      while (!this._deflating && this._queue.length) {
        const params = this._queue.shift();
        this._bufferedBytes -= params[1].length;
        Reflect.apply(params[0], this, params.slice(1));
      }
    }
    /**
     * Enqueues a send operation.
     *
     * @param {Array} params Send operation parameters.
     * @private
     */ enqueue(params) {
      this._bufferedBytes += params[1].length;
      this._queue.push(params);
    }
    /**
     * Sends a frame.
     *
     * @param {Buffer[]} list The frame to send
     * @param {Function} [cb] Callback
     * @private
     */ sendFrame(list, cb) {
      if (list.length === 2) {
        this._socket.cork();
        this._socket.write(list[0]);
        this._socket.write(list[1], cb);
        this._socket.uncork();
      } else this._socket.write(list[0], cb);
    }
  }
  module.exports = $aed559aeaf7b17f8$var$Sender;
});

parcelRegister('jW2m9', function (module, exports) {
  'use strict';

  var $e8354301e275d78f$require$Duplex = $dmXIQ$stream.Duplex;
  /**
   * Emits the `'close'` event on a stream.
   *
   * @param {Duplex} stream The stream.
   * @private
   */ function $e8354301e275d78f$var$emitClose(stream) {
    stream.emit('close');
  }
  /**
   * The listener of the `'end'` event.
   *
   * @private
   */ function $e8354301e275d78f$var$duplexOnEnd() {
    if (!this.destroyed && this._writableState.finished) this.destroy();
  }
  /**
   * The listener of the `'error'` event.
   *
   * @param {Error} err The error
   * @private
   */ function $e8354301e275d78f$var$duplexOnError(err) {
    this.removeListener('error', $e8354301e275d78f$var$duplexOnError);
    this.destroy();
    if (this.listenerCount('error') === 0)
      // Do not suppress the throwing behavior.
      this.emit('error', err);
  }
  /**
   * Wraps a `WebSocket` in a duplex stream.
   *
   * @param {WebSocket} ws The `WebSocket` to wrap
   * @param {Object} [options] The options for the `Duplex` constructor
   * @return {Duplex} The duplex stream
   * @public
   */ function $e8354301e275d78f$var$createWebSocketStream(ws, options) {
    let resumeOnReceiverDrain = true;
    let terminateOnDestroy = true;
    function receiverOnDrain() {
      if (resumeOnReceiverDrain) ws._socket.resume();
    }
    if (ws.readyState === ws.CONNECTING)
      ws.once('open', function open() {
        ws._receiver.removeAllListeners('drain');
        ws._receiver.on('drain', receiverOnDrain);
      });
    else {
      ws._receiver.removeAllListeners('drain');
      ws._receiver.on('drain', receiverOnDrain);
    }
    const duplex = new $e8354301e275d78f$require$Duplex({
      ...options,
      autoDestroy: false,
      emitClose: false,
      objectMode: false,
      writableObjectMode: false,
    });
    ws.on('message', function message(msg) {
      if (!duplex.push(msg)) {
        resumeOnReceiverDrain = false;
        ws._socket.pause();
      }
    });
    ws.once('error', function error(err) {
      if (duplex.destroyed) return;
      // Prevent `ws.terminate()` from being called by `duplex._destroy()`.
      //
      // - If the `'error'` event is emitted before the `'open'` event, then
      //   `ws.terminate()` is a noop as no socket is assigned.
      // - Otherwise, the error is re-emitted by the listener of the `'error'`
      //   event of the `Receiver` object. The listener already closes the
      //   connection by calling `ws.close()`. This allows a close frame to be
      //   sent to the other peer. If `ws.terminate()` is called right after this,
      //   then the close frame might not be sent.
      terminateOnDestroy = false;
      duplex.destroy(err);
    });
    ws.once('close', function close() {
      if (duplex.destroyed) return;
      duplex.push(null);
    });
    duplex._destroy = function (err, callback) {
      if (ws.readyState === ws.CLOSED) {
        callback(err);
        process.nextTick($e8354301e275d78f$var$emitClose, duplex);
        return;
      }
      let called = false;
      ws.once('error', function error(err) {
        called = true;
        callback(err);
      });
      ws.once('close', function close() {
        if (!called) callback(err);
        process.nextTick($e8354301e275d78f$var$emitClose, duplex);
      });
      if (terminateOnDestroy) ws.terminate();
    };
    duplex._final = function (callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once('open', function open() {
          duplex._final(callback);
        });
        return;
      }
      // If the value of the `_socket` property is `null` it means that `ws` is a
      // client websocket and the handshake failed. In fact, when this happens, a
      // socket is never assigned to the websocket. Wait for the `'error'` event
      // that will be emitted by the websocket.
      if (ws._socket === null) return;
      if (ws._socket._writableState.finished) {
        callback();
        if (duplex._readableState.endEmitted) duplex.destroy();
      } else {
        ws._socket.once('finish', function finish() {
          // `duplex` is not destroyed here because the `'end'` event will be
          // emitted on `duplex` after this `'finish'` event. The EOF signaling
          // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
          callback();
        });
        ws.close();
      }
    };
    duplex._read = function () {
      if (
        (ws.readyState === ws.OPEN || ws.readyState === ws.CLOSING) &&
        !resumeOnReceiverDrain
      ) {
        resumeOnReceiverDrain = true;
        if (!ws._receiver._writableState.needDrain) ws._socket.resume();
      }
    };
    duplex._write = function (chunk, encoding, callback) {
      if (ws.readyState === ws.CONNECTING) {
        ws.once('open', function open() {
          duplex._write(chunk, encoding, callback);
        });
        return;
      }
      ws.send(chunk, callback);
    };
    duplex.on('end', $e8354301e275d78f$var$duplexOnEnd);
    duplex.on('error', $e8354301e275d78f$var$duplexOnError);
    return duplex;
  }
  module.exports = $e8354301e275d78f$var$createWebSocketStream;
});

parcelRegister('8Pgpp', function (module, exports) {
  /* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^net|tls|https$" }] */ 'use strict';

  var $66cfd09c2ba0ff0d$require$createHash = $dmXIQ$crypto.createHash;

  var $5QfTR = parcelRequire('5QfTR');

  var $iKo1y = parcelRequire('iKo1y');

  var $7DMZB = parcelRequire('7DMZB');
  var $66cfd09c2ba0ff0d$require$format = $7DMZB.format;
  var $66cfd09c2ba0ff0d$require$parse = $7DMZB.parse;

  var $97vyB = parcelRequire('97vyB');
  var $66cfd09c2ba0ff0d$require$GUID = $97vyB.GUID;
  var $66cfd09c2ba0ff0d$require$kWebSocket = $97vyB.kWebSocket;
  const $66cfd09c2ba0ff0d$var$keyRegex = /^[+/0-9A-Za-z]{22}==$/;
  const $66cfd09c2ba0ff0d$var$RUNNING = 0;
  const $66cfd09c2ba0ff0d$var$CLOSING = 1;
  const $66cfd09c2ba0ff0d$var$CLOSED = 2;
  /**
   * Class representing a WebSocket server.
   *
   * @extends EventEmitter
   */ class $66cfd09c2ba0ff0d$var$WebSocketServer extends $dmXIQ$events {
    /**
     * Create a `WebSocketServer` instance.
     *
     * @param {Object} options Configuration options
     * @param {Number} [options.backlog=511] The maximum length of the queue of
     *     pending connections
     * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
     *     track clients
     * @param {Function} [options.handleProtocols] A hook to handle protocols
     * @param {String} [options.host] The hostname where to bind the server
     * @param {Number} [options.maxPayload=104857600] The maximum allowed message
     *     size
     * @param {Boolean} [options.noServer=false] Enable no server mode
     * @param {String} [options.path] Accept only connections matching this path
     * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
     *     permessage-deflate
     * @param {Number} [options.port] The port where to bind the server
     * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
     *     server to use
     * @param {Function} [options.verifyClient] A hook to reject connections
     * @param {Function} [callback] A listener for the `listening` event
     */ constructor(options, callback) {
      super();
      options = {
        maxPayload: 104857600,
        perMessageDeflate: false,
        handleProtocols: null,
        clientTracking: true,
        verifyClient: null,
        noServer: false,
        backlog: null,
        server: null,
        host: null,
        path: null,
        port: null,
        ...options,
      };
      if (
        (options.port == null && !options.server && !options.noServer) ||
        (options.port != null && (options.server || options.noServer)) ||
        (options.server && options.noServer)
      )
        throw new TypeError(
          'One and only one of the "port", "server", or "noServer" options must be specified',
        );
      if (options.port != null) {
        this._server = $dmXIQ$http.createServer((req, res) => {
          const body = $dmXIQ$http.STATUS_CODES[426];
          res.writeHead(426, {
            'Content-Length': body.length,
            'Content-Type': 'text/plain',
          });
          res.end(body);
        });
        this._server.listen(
          options.port,
          options.host,
          options.backlog,
          callback,
        );
      } else if (options.server) this._server = options.server;
      if (this._server) {
        const emitConnection = this.emit.bind(this, 'connection');
        this._removeListeners = $66cfd09c2ba0ff0d$var$addListeners(
          this._server,
          {
            listening: this.emit.bind(this, 'listening'),
            error: this.emit.bind(this, 'error'),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            },
          },
        );
      }
      if (options.perMessageDeflate === true) options.perMessageDeflate = {};
      if (options.clientTracking) this.clients = new Set();
      this.options = options;
      this._state = $66cfd09c2ba0ff0d$var$RUNNING;
    }
    /**
     * Returns the bound address, the address family name, and port of the server
     * as reported by the operating system if listening on an IP socket.
     * If the server is listening on a pipe or UNIX domain socket, the name is
     * returned as a string.
     *
     * @return {(Object|String|null)} The address of the server
     * @public
     */ address() {
      if (this.options.noServer)
        throw new Error('The server is operating in "noServer" mode');
      if (!this._server) return null;
      return this._server.address();
    }
    /**
     * Close the server.
     *
     * @param {Function} [cb] Callback
     * @public
     */ close(cb) {
      if (cb) this.once('close', cb);
      if (this._state === $66cfd09c2ba0ff0d$var$CLOSED) {
        process.nextTick($66cfd09c2ba0ff0d$var$emitClose, this);
        return;
      }
      if (this._state === $66cfd09c2ba0ff0d$var$CLOSING) return;
      this._state = $66cfd09c2ba0ff0d$var$CLOSING;
      //
      // Terminate all associated clients.
      //
      if (this.clients) for (const client of this.clients) client.terminate();
      const server = this._server;
      if (server) {
        this._removeListeners();
        this._removeListeners = this._server = null;
        //
        // Close the http server if it was internally created.
        //
        if (this.options.port != null) {
          server.close($66cfd09c2ba0ff0d$var$emitClose.bind(undefined, this));
          return;
        }
      }
      process.nextTick($66cfd09c2ba0ff0d$var$emitClose, this);
    }
    /**
     * See if a given request should be handled by this server instance.
     *
     * @param {http.IncomingMessage} req Request object to inspect
     * @return {Boolean} `true` if the request is valid, else `false`
     * @public
     */ shouldHandle(req) {
      if (this.options.path) {
        const index = req.url.indexOf('?');
        const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
        if (pathname !== this.options.path) return false;
      }
      return true;
    }
    /**
     * Handle a HTTP Upgrade request.
     *
     * @param {http.IncomingMessage} req The request object
     * @param {(net.Socket|tls.Socket)} socket The network socket between the
     *     server and client
     * @param {Buffer} head The first packet of the upgraded stream
     * @param {Function} cb Callback
     * @public
     */ handleUpgrade(req, socket, head, cb) {
      socket.on('error', $66cfd09c2ba0ff0d$var$socketOnError);
      const key =
        req.headers['sec-websocket-key'] !== undefined
          ? req.headers['sec-websocket-key'].trim()
          : false;
      const version = +req.headers['sec-websocket-version'];
      const extensions = {};
      if (
        req.method !== 'GET' ||
        req.headers.upgrade.toLowerCase() !== 'websocket' ||
        !key ||
        !$66cfd09c2ba0ff0d$var$keyRegex.test(key) ||
        (version !== 8 && version !== 13) ||
        !this.shouldHandle(req)
      )
        return $66cfd09c2ba0ff0d$var$abortHandshake(socket, 400);
      if (this.options.perMessageDeflate) {
        const perMessageDeflate = new $5QfTR(
          this.options.perMessageDeflate,
          true,
          this.options.maxPayload,
        );
        try {
          const offers = $66cfd09c2ba0ff0d$require$parse(
            req.headers['sec-websocket-extensions'],
          );
          if (offers[$5QfTR.extensionName]) {
            perMessageDeflate.accept(offers[$5QfTR.extensionName]);
            extensions[$5QfTR.extensionName] = perMessageDeflate;
          }
        } catch (err) {
          return $66cfd09c2ba0ff0d$var$abortHandshake(socket, 400);
        }
      }
      //
      // Optionally call external client verification handler.
      //
      if (this.options.verifyClient) {
        const info = {
          origin:
            req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
          secure: !!(req.socket.authorized || req.socket.encrypted),
          req: req,
        };
        if (this.options.verifyClient.length === 2) {
          this.options.verifyClient(
            info,
            (verified, code, message, headers) => {
              if (!verified)
                return $66cfd09c2ba0ff0d$var$abortHandshake(
                  socket,
                  code || 401,
                  message,
                  headers,
                );
              this.completeUpgrade(key, extensions, req, socket, head, cb);
            },
          );
          return;
        }
        if (!this.options.verifyClient(info))
          return $66cfd09c2ba0ff0d$var$abortHandshake(socket, 401);
      }
      this.completeUpgrade(key, extensions, req, socket, head, cb);
    }
    /**
     * Upgrade the connection to WebSocket.
     *
     * @param {String} key The value of the `Sec-WebSocket-Key` header
     * @param {Object} extensions The accepted extensions
     * @param {http.IncomingMessage} req The request object
     * @param {(net.Socket|tls.Socket)} socket The network socket between the
     *     server and client
     * @param {Buffer} head The first packet of the upgraded stream
     * @param {Function} cb Callback
     * @throws {Error} If called more than once with the same socket
     * @private
     */ completeUpgrade(key, extensions, req, socket, head, cb) {
      //
      // Destroy the socket if the client has already sent a FIN packet.
      //
      if (!socket.readable || !socket.writable) return socket.destroy();
      if (socket[$66cfd09c2ba0ff0d$require$kWebSocket])
        throw new Error(
          'server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration',
        );
      if (this._state > $66cfd09c2ba0ff0d$var$RUNNING)
        return $66cfd09c2ba0ff0d$var$abortHandshake(socket, 503);
      const digest = $66cfd09c2ba0ff0d$require$createHash('sha1')
        .update(key + $66cfd09c2ba0ff0d$require$GUID)
        .digest('base64');
      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${digest}`,
      ];
      const ws = new $iKo1y(null);
      let protocol = req.headers['sec-websocket-protocol'];
      if (protocol) {
        protocol = protocol.split(',').map($66cfd09c2ba0ff0d$var$trim);
        //
        // Optionally call external protocol selection handler.
        //
        if (this.options.handleProtocols)
          protocol = this.options.handleProtocols(protocol, req);
        else protocol = protocol[0];
        if (protocol) {
          headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
          ws._protocol = protocol;
        }
      }
      if (extensions[$5QfTR.extensionName]) {
        const params = extensions[$5QfTR.extensionName].params;
        const value = $66cfd09c2ba0ff0d$require$format({
          [$5QfTR.extensionName]: [params],
        });
        headers.push(`Sec-WebSocket-Extensions: ${value}`);
        ws._extensions = extensions;
      }
      //
      // Allow external modification/inspection of handshake headers.
      //
      this.emit('headers', headers, req);
      socket.write(headers.concat('\r\n').join('\r\n'));
      socket.removeListener('error', $66cfd09c2ba0ff0d$var$socketOnError);
      ws.setSocket(socket, head, this.options.maxPayload);
      if (this.clients) {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
      }
      cb(ws, req);
    }
  }
  module.exports = $66cfd09c2ba0ff0d$var$WebSocketServer;
  /**
   * Add event listeners on an `EventEmitter` using a map of <event, listener>
   * pairs.
   *
   * @param {EventEmitter} server The event emitter
   * @param {Object.<String, Function>} map The listeners to add
   * @return {Function} A function that will remove the added listeners when
   *     called
   * @private
   */ function $66cfd09c2ba0ff0d$var$addListeners(server, map) {
    for (const event of Object.keys(map)) server.on(event, map[event]);
    return function removeListeners() {
      for (const event of Object.keys(map))
        server.removeListener(event, map[event]);
    };
  }
  /**
   * Emit a `'close'` event on an `EventEmitter`.
   *
   * @param {EventEmitter} server The event emitter
   * @private
   */ function $66cfd09c2ba0ff0d$var$emitClose(server) {
    server._state = $66cfd09c2ba0ff0d$var$CLOSED;
    server.emit('close');
  }
  /**
   * Handle premature socket errors.
   *
   * @private
   */ function $66cfd09c2ba0ff0d$var$socketOnError() {
    this.destroy();
  }
  /**
   * Close the connection when preconditions are not fulfilled.
   *
   * @param {(net.Socket|tls.Socket)} socket The socket of the upgrade request
   * @param {Number} code The HTTP response status code
   * @param {String} [message] The HTTP response body
   * @param {Object} [headers] Additional HTTP response headers
   * @private
   */ function $66cfd09c2ba0ff0d$var$abortHandshake(
    socket,
    code,
    message,
    headers,
  ) {
    if (socket.writable) {
      message = message || $dmXIQ$http.STATUS_CODES[code];
      headers = {
        Connection: 'close',
        'Content-Type': 'text/html',
        'Content-Length': Buffer.byteLength(message),
        ...headers,
      };
      socket.write(
        `HTTP/1.1 ${code} ${$dmXIQ$http.STATUS_CODES[code]}\r\n` +
          Object.keys(headers)
            .map(h => `${h}: ${headers[h]}`)
            .join('\r\n') +
          '\r\n\r\n' +
          message,
      );
    }
    socket.removeListener('error', $66cfd09c2ba0ff0d$var$socketOnError);
    socket.destroy();
  }
  /**
   * Remove whitespace characters from both ends of a string.
   *
   * @param {String} str The string
   * @return {String} A new string representing `str` stripped of whitespace
   *     characters from both its beginning and end
   * @private
   */ function $66cfd09c2ba0ff0d$var$trim(str) {
    return str.trim();
  }
});
parcelRegister('iKo1y', function (module, exports) {
  /* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Readable$" }] */ 'use strict';

  var $da5f289045a8b9aa$require$randomBytes = $dmXIQ$crypto.randomBytes;
  var $da5f289045a8b9aa$require$createHash = $dmXIQ$crypto.createHash;

  var $da5f289045a8b9aa$require$Readable = $dmXIQ$stream.Readable;

  var $da5f289045a8b9aa$require$URL = $dmXIQ$url.URL;

  var $5QfTR = parcelRequire('5QfTR');

  var $9Puct = parcelRequire('9Puct');

  var $f0Djp = parcelRequire('f0Djp');

  var $97vyB = parcelRequire('97vyB');
  var $da5f289045a8b9aa$require$BINARY_TYPES = $97vyB.BINARY_TYPES;
  var $da5f289045a8b9aa$require$EMPTY_BUFFER = $97vyB.EMPTY_BUFFER;
  var $da5f289045a8b9aa$require$GUID = $97vyB.GUID;
  var $da5f289045a8b9aa$require$kStatusCode = $97vyB.kStatusCode;
  var $da5f289045a8b9aa$require$kWebSocket = $97vyB.kWebSocket;
  var $da5f289045a8b9aa$require$NOOP = $97vyB.NOOP;

  var $l2TZX = parcelRequire('l2TZX');
  var $da5f289045a8b9aa$require$addEventListener = $l2TZX.addEventListener;
  var $da5f289045a8b9aa$require$removeEventListener =
    $l2TZX.removeEventListener;

  var $7DMZB = parcelRequire('7DMZB');
  var $da5f289045a8b9aa$require$format = $7DMZB.format;
  var $da5f289045a8b9aa$require$parse = $7DMZB.parse;

  var $2vcMF = parcelRequire('2vcMF');
  var $da5f289045a8b9aa$require$toBuffer = $2vcMF.toBuffer;
  const $da5f289045a8b9aa$var$readyStates = [
    'CONNECTING',
    'OPEN',
    'CLOSING',
    'CLOSED',
  ];
  const $da5f289045a8b9aa$var$protocolVersions = [8, 13];
  const $da5f289045a8b9aa$var$closeTimeout = 30000;
  /**
   * Class representing a WebSocket.
   *
   * @extends EventEmitter
   */ class $da5f289045a8b9aa$var$WebSocket extends $dmXIQ$events {
    /**
     * Create a new `WebSocket`.
     *
     * @param {(String|URL)} address The URL to which to connect
     * @param {(String|String[])} [protocols] The subprotocols
     * @param {Object} [options] Connection options
     */ constructor(address, protocols, options) {
      super();
      this._binaryType = $da5f289045a8b9aa$require$BINARY_TYPES[0];
      this._closeCode = 1006;
      this._closeFrameReceived = false;
      this._closeFrameSent = false;
      this._closeMessage = '';
      this._closeTimer = null;
      this._extensions = {};
      this._protocol = '';
      this._readyState = $da5f289045a8b9aa$var$WebSocket.CONNECTING;
      this._receiver = null;
      this._sender = null;
      this._socket = null;
      if (address !== null) {
        this._bufferedAmount = 0;
        this._isServer = false;
        this._redirects = 0;
        if (Array.isArray(protocols)) protocols = protocols.join(', ');
        else if (typeof protocols === 'object' && protocols !== null) {
          options = protocols;
          protocols = undefined;
        }
        $da5f289045a8b9aa$var$initAsClient(this, address, protocols, options);
      } else this._isServer = true;
    }
    /**
     * This deviates from the WHATWG interface since ws doesn't support the
     * required default "blob" type (instead we define a custom "nodebuffer"
     * type).
     *
     * @type {String}
     */ get binaryType() {
      return this._binaryType;
    }
    set binaryType(type) {
      if (!$da5f289045a8b9aa$require$BINARY_TYPES.includes(type)) return;
      this._binaryType = type;
      //
      // Allow to change `binaryType` on the fly.
      //
      if (this._receiver) this._receiver._binaryType = type;
    }
    /**
     * @type {Number}
     */ get bufferedAmount() {
      if (!this._socket) return this._bufferedAmount;
      return this._socket._writableState.length + this._sender._bufferedBytes;
    }
    /**
     * @type {String}
     */ get extensions() {
      return Object.keys(this._extensions).join();
    }
    /**
     * @type {Function}
     */ /* istanbul ignore next */ get onclose() {
      return undefined;
    }
    /* istanbul ignore next */ set onclose(listener) {}
    /**
     * @type {Function}
     */ /* istanbul ignore next */ get onerror() {
      return undefined;
    }
    /* istanbul ignore next */ set onerror(listener) {}
    /**
     * @type {Function}
     */ /* istanbul ignore next */ get onopen() {
      return undefined;
    }
    /* istanbul ignore next */ set onopen(listener) {}
    /**
     * @type {Function}
     */ /* istanbul ignore next */ get onmessage() {
      return undefined;
    }
    /* istanbul ignore next */ set onmessage(listener) {}
    /**
     * @type {String}
     */ get protocol() {
      return this._protocol;
    }
    /**
     * @type {Number}
     */ get readyState() {
      return this._readyState;
    }
    /**
     * @type {String}
     */ get url() {
      return this._url;
    }
    /**
     * Set up the socket and the internal resources.
     *
     * @param {(net.Socket|tls.Socket)} socket The network socket between the
     *     server and client
     * @param {Buffer} head The first packet of the upgraded stream
     * @param {Number} [maxPayload=0] The maximum allowed message size
     * @private
     */ setSocket(socket, head, maxPayload) {
      const receiver = new $9Puct(
        this.binaryType,
        this._extensions,
        this._isServer,
        maxPayload,
      );
      this._sender = new $f0Djp(socket, this._extensions);
      this._receiver = receiver;
      this._socket = socket;
      receiver[$da5f289045a8b9aa$require$kWebSocket] = this;
      socket[$da5f289045a8b9aa$require$kWebSocket] = this;
      receiver.on('conclude', $da5f289045a8b9aa$var$receiverOnConclude);
      receiver.on('drain', $da5f289045a8b9aa$var$receiverOnDrain);
      receiver.on('error', $da5f289045a8b9aa$var$receiverOnError);
      receiver.on('message', $da5f289045a8b9aa$var$receiverOnMessage);
      receiver.on('ping', $da5f289045a8b9aa$var$receiverOnPing);
      receiver.on('pong', $da5f289045a8b9aa$var$receiverOnPong);
      socket.setTimeout(0);
      socket.setNoDelay();
      if (head.length > 0) socket.unshift(head);
      socket.on('close', $da5f289045a8b9aa$var$socketOnClose);
      socket.on('data', $da5f289045a8b9aa$var$socketOnData);
      socket.on('end', $da5f289045a8b9aa$var$socketOnEnd);
      socket.on('error', $da5f289045a8b9aa$var$socketOnError);
      this._readyState = $da5f289045a8b9aa$var$WebSocket.OPEN;
      this.emit('open');
    }
    /**
     * Emit the `'close'` event.
     *
     * @private
     */ emitClose() {
      if (!this._socket) {
        this._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSED;
        this.emit('close', this._closeCode, this._closeMessage);
        return;
      }
      if (this._extensions[$5QfTR.extensionName])
        this._extensions[$5QfTR.extensionName].cleanup();
      this._receiver.removeAllListeners();
      this._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSED;
      this.emit('close', this._closeCode, this._closeMessage);
    }
    /**
     * Start a closing handshake.
     *
     *          +----------+   +-----------+   +----------+
     *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
     *    |     +----------+   +-----------+   +----------+     |
     *          +----------+   +-----------+         |
     * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
     *          +----------+   +-----------+   |
     *    |           |                        |   +---+        |
     *                +------------------------+-->|fin| - - - -
     *    |         +---+                      |   +---+
     *     - - - - -|fin|<---------------------+
     *              +---+
     *
     * @param {Number} [code] Status code explaining why the connection is closing
     * @param {String} [data] A string explaining why the connection is closing
     * @public
     */ close(code, data) {
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CLOSED) return;
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CONNECTING) {
        const msg =
          'WebSocket was closed before the connection was established';
        return $da5f289045a8b9aa$var$abortHandshake(this, this._req, msg);
      }
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CLOSING) {
        if (
          this._closeFrameSent &&
          (this._closeFrameReceived ||
            this._receiver._writableState.errorEmitted)
        )
          this._socket.end();
        return;
      }
      this._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
      this._sender.close(code, data, !this._isServer, err => {
        //
        // This error is handled by the `'error'` listener on the socket. We only
        // want to know if the close frame has been sent here.
        //
        if (err) return;
        this._closeFrameSent = true;
        if (
          this._closeFrameReceived ||
          this._receiver._writableState.errorEmitted
        )
          this._socket.end();
      });
      //
      // Specify a timeout for the closing handshake to complete.
      //
      this._closeTimer = setTimeout(
        this._socket.destroy.bind(this._socket),
        $da5f289045a8b9aa$var$closeTimeout,
      );
    }
    /**
     * Send a ping.
     *
     * @param {*} [data] The data to send
     * @param {Boolean} [mask] Indicates whether or not to mask `data`
     * @param {Function} [cb] Callback which is executed when the ping is sent
     * @public
     */ ping(data, mask, cb) {
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CONNECTING)
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      if (typeof data === 'function') {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === 'function') {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== $da5f289045a8b9aa$var$WebSocket.OPEN) {
        $da5f289045a8b9aa$var$sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined) mask = !this._isServer;
      this._sender.ping(
        data || $da5f289045a8b9aa$require$EMPTY_BUFFER,
        mask,
        cb,
      );
    }
    /**
     * Send a pong.
     *
     * @param {*} [data] The data to send
     * @param {Boolean} [mask] Indicates whether or not to mask `data`
     * @param {Function} [cb] Callback which is executed when the pong is sent
     * @public
     */ pong(data, mask, cb) {
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CONNECTING)
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      if (typeof data === 'function') {
        cb = data;
        data = mask = undefined;
      } else if (typeof mask === 'function') {
        cb = mask;
        mask = undefined;
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== $da5f289045a8b9aa$var$WebSocket.OPEN) {
        $da5f289045a8b9aa$var$sendAfterClose(this, data, cb);
        return;
      }
      if (mask === undefined) mask = !this._isServer;
      this._sender.pong(
        data || $da5f289045a8b9aa$require$EMPTY_BUFFER,
        mask,
        cb,
      );
    }
    /**
     * Send a data message.
     *
     * @param {*} data The message to send
     * @param {Object} [options] Options object
     * @param {Boolean} [options.compress] Specifies whether or not to compress
     *     `data`
     * @param {Boolean} [options.binary] Specifies whether `data` is binary or
     *     text
     * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
     *     last one
     * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
     * @param {Function} [cb] Callback which is executed when data is written out
     * @public
     */ send(data, options, cb) {
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CONNECTING)
        throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
      if (typeof options === 'function') {
        cb = options;
        options = {};
      }
      if (typeof data === 'number') data = data.toString();
      if (this.readyState !== $da5f289045a8b9aa$var$WebSocket.OPEN) {
        $da5f289045a8b9aa$var$sendAfterClose(this, data, cb);
        return;
      }
      const opts = {
        binary: typeof data !== 'string',
        mask: !this._isServer,
        compress: true,
        fin: true,
        ...options,
      };
      if (!this._extensions[$5QfTR.extensionName]) opts.compress = false;
      this._sender.send(
        data || $da5f289045a8b9aa$require$EMPTY_BUFFER,
        opts,
        cb,
      );
    }
    /**
     * Forcibly close the connection.
     *
     * @public
     */ terminate() {
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CLOSED) return;
      if (this.readyState === $da5f289045a8b9aa$var$WebSocket.CONNECTING) {
        const msg =
          'WebSocket was closed before the connection was established';
        return $da5f289045a8b9aa$var$abortHandshake(this, this._req, msg);
      }
      if (this._socket) {
        this._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
        this._socket.destroy();
      }
    }
  }
  /**
   * @constant {Number} CONNECTING
   * @memberof WebSocket
   */ Object.defineProperty($da5f289045a8b9aa$var$WebSocket, 'CONNECTING', {
    enumerable: true,
    value: $da5f289045a8b9aa$var$readyStates.indexOf('CONNECTING'),
  });
  /**
   * @constant {Number} CONNECTING
   * @memberof WebSocket.prototype
   */ Object.defineProperty(
    $da5f289045a8b9aa$var$WebSocket.prototype,
    'CONNECTING',
    {
      enumerable: true,
      value: $da5f289045a8b9aa$var$readyStates.indexOf('CONNECTING'),
    },
  );
  /**
   * @constant {Number} OPEN
   * @memberof WebSocket
   */ Object.defineProperty($da5f289045a8b9aa$var$WebSocket, 'OPEN', {
    enumerable: true,
    value: $da5f289045a8b9aa$var$readyStates.indexOf('OPEN'),
  });
  /**
   * @constant {Number} OPEN
   * @memberof WebSocket.prototype
   */ Object.defineProperty($da5f289045a8b9aa$var$WebSocket.prototype, 'OPEN', {
    enumerable: true,
    value: $da5f289045a8b9aa$var$readyStates.indexOf('OPEN'),
  });
  /**
   * @constant {Number} CLOSING
   * @memberof WebSocket
   */ Object.defineProperty($da5f289045a8b9aa$var$WebSocket, 'CLOSING', {
    enumerable: true,
    value: $da5f289045a8b9aa$var$readyStates.indexOf('CLOSING'),
  });
  /**
   * @constant {Number} CLOSING
   * @memberof WebSocket.prototype
   */ Object.defineProperty(
    $da5f289045a8b9aa$var$WebSocket.prototype,
    'CLOSING',
    {
      enumerable: true,
      value: $da5f289045a8b9aa$var$readyStates.indexOf('CLOSING'),
    },
  );
  /**
   * @constant {Number} CLOSED
   * @memberof WebSocket
   */ Object.defineProperty($da5f289045a8b9aa$var$WebSocket, 'CLOSED', {
    enumerable: true,
    value: $da5f289045a8b9aa$var$readyStates.indexOf('CLOSED'),
  });
  /**
   * @constant {Number} CLOSED
   * @memberof WebSocket.prototype
   */ Object.defineProperty(
    $da5f289045a8b9aa$var$WebSocket.prototype,
    'CLOSED',
    {
      enumerable: true,
      value: $da5f289045a8b9aa$var$readyStates.indexOf('CLOSED'),
    },
  );
  [
    'binaryType',
    'bufferedAmount',
    'extensions',
    'protocol',
    'readyState',
    'url',
  ].forEach(property => {
    Object.defineProperty($da5f289045a8b9aa$var$WebSocket.prototype, property, {
      enumerable: true,
    });
  });
  //
  // Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
  // See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
  //
  ['open', 'error', 'close', 'message'].forEach(method => {
    Object.defineProperty(
      $da5f289045a8b9aa$var$WebSocket.prototype,
      `on${method}`,
      {
        enumerable: true,
        get() {
          const listeners = this.listeners(method);
          for (let i = 0; i < listeners.length; i++) {
            if (listeners[i]._listener) return listeners[i]._listener;
          }
          return undefined;
        },
        set(listener) {
          const listeners = this.listeners(method);
          for (
            let i = 0;
            i < listeners.length;
            i++ //
          )
            // Remove only the listeners added via `addEventListener`.
            //
            if (listeners[i]._listener)
              this.removeListener(method, listeners[i]);
          this.addEventListener(method, listener);
        },
      },
    );
  });
  $da5f289045a8b9aa$var$WebSocket.prototype.addEventListener =
    $da5f289045a8b9aa$require$addEventListener;
  $da5f289045a8b9aa$var$WebSocket.prototype.removeEventListener =
    $da5f289045a8b9aa$require$removeEventListener;
  module.exports = $da5f289045a8b9aa$var$WebSocket;
  /**
   * Initialize a WebSocket client.
   *
   * @param {WebSocket} websocket The client to initialize
   * @param {(String|URL)} address The URL to which to connect
   * @param {String} [protocols] The subprotocols
   * @param {Object} [options] Connection options
   * @param {(Boolean|Object)} [options.perMessageDeflate=true] Enable/disable
   *     permessage-deflate
   * @param {Number} [options.handshakeTimeout] Timeout in milliseconds for the
   *     handshake request
   * @param {Number} [options.protocolVersion=13] Value of the
   *     `Sec-WebSocket-Version` header
   * @param {String} [options.origin] Value of the `Origin` or
   *     `Sec-WebSocket-Origin` header
   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
   *     size
   * @param {Boolean} [options.followRedirects=false] Whether or not to follow
   *     redirects
   * @param {Number} [options.maxRedirects=10] The maximum number of redirects
   *     allowed
   * @private
   */ function $da5f289045a8b9aa$var$initAsClient(
    websocket,
    address,
    protocols,
    options,
  ) {
    const opts = {
      protocolVersion: $da5f289045a8b9aa$var$protocolVersions[1],
      maxPayload: 104857600,
      perMessageDeflate: true,
      followRedirects: false,
      maxRedirects: 10,
      ...options,
      createConnection: undefined,
      socketPath: undefined,
      hostname: undefined,
      protocol: undefined,
      timeout: undefined,
      method: undefined,
      host: undefined,
      path: undefined,
      port: undefined,
    };
    if (!$da5f289045a8b9aa$var$protocolVersions.includes(opts.protocolVersion))
      throw new RangeError(
        `Unsupported protocol version: ${opts.protocolVersion} ` +
          `(supported versions: ${$da5f289045a8b9aa$var$protocolVersions.join(
            ', ',
          )})`,
      );
    let parsedUrl;
    if (address instanceof $da5f289045a8b9aa$require$URL) {
      parsedUrl = address;
      websocket._url = address.href;
    } else {
      parsedUrl = new $da5f289045a8b9aa$require$URL(address);
      websocket._url = address;
    }
    const isUnixSocket = parsedUrl.protocol === 'ws+unix:';
    if (!parsedUrl.host && (!isUnixSocket || !parsedUrl.pathname)) {
      const err = new Error(`Invalid URL: ${websocket.url}`);
      if (websocket._redirects === 0) throw err;
      else {
        $da5f289045a8b9aa$var$emitErrorAndClose(websocket, err);
        return;
      }
    }
    const isSecure =
      parsedUrl.protocol === 'wss:' || parsedUrl.protocol === 'https:';
    const defaultPort = isSecure ? 443 : 80;
    const key = $da5f289045a8b9aa$require$randomBytes(16).toString('base64');
    const get = isSecure ? $dmXIQ$https.get : $dmXIQ$http.get;
    let perMessageDeflate;
    opts.createConnection = isSecure
      ? $da5f289045a8b9aa$var$tlsConnect
      : $da5f289045a8b9aa$var$netConnect;
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.port = parsedUrl.port || defaultPort;
    opts.host = parsedUrl.hostname.startsWith('[')
      ? parsedUrl.hostname.slice(1, -1)
      : parsedUrl.hostname;
    opts.headers = {
      'Sec-WebSocket-Version': opts.protocolVersion,
      'Sec-WebSocket-Key': key,
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      ...opts.headers,
    };
    opts.path = parsedUrl.pathname + parsedUrl.search;
    opts.timeout = opts.handshakeTimeout;
    if (opts.perMessageDeflate) {
      perMessageDeflate = new $5QfTR(
        opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
        false,
        opts.maxPayload,
      );
      opts.headers['Sec-WebSocket-Extensions'] =
        $da5f289045a8b9aa$require$format({
          [$5QfTR.extensionName]: perMessageDeflate.offer(),
        });
    }
    if (protocols) opts.headers['Sec-WebSocket-Protocol'] = protocols;
    if (opts.origin) {
      if (opts.protocolVersion < 13)
        opts.headers['Sec-WebSocket-Origin'] = opts.origin;
      else opts.headers.Origin = opts.origin;
    }
    if (parsedUrl.username || parsedUrl.password)
      opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    if (isUnixSocket) {
      const parts = opts.path.split(':');
      opts.socketPath = parts[0];
      opts.path = parts[1];
    }
    let req = (websocket._req = get(opts));
    if (opts.timeout)
      req.on('timeout', () => {
        $da5f289045a8b9aa$var$abortHandshake(
          websocket,
          req,
          'Opening handshake has timed out',
        );
      });
    req.on('error', err => {
      if (req === null || req.aborted) return;
      req = websocket._req = null;
      $da5f289045a8b9aa$var$emitErrorAndClose(websocket, err);
    });
    req.on('response', res => {
      const location = res.headers.location;
      const statusCode = res.statusCode;
      if (
        location &&
        opts.followRedirects &&
        statusCode >= 300 &&
        statusCode < 400
      ) {
        if (++websocket._redirects > opts.maxRedirects) {
          $da5f289045a8b9aa$var$abortHandshake(
            websocket,
            req,
            'Maximum redirects exceeded',
          );
          return;
        }
        req.abort();
        let addr;
        try {
          addr = new $da5f289045a8b9aa$require$URL(location, address);
        } catch (err) {
          $da5f289045a8b9aa$var$emitErrorAndClose(websocket, err);
          return;
        }
        $da5f289045a8b9aa$var$initAsClient(websocket, addr, protocols, options);
      } else if (!websocket.emit('unexpected-response', req, res))
        $da5f289045a8b9aa$var$abortHandshake(
          websocket,
          req,
          `Unexpected server response: ${res.statusCode}`,
        );
    });
    req.on('upgrade', (res, socket, head) => {
      websocket.emit('upgrade', res);
      //
      // The user may have closed the connection from a listener of the `upgrade`
      // event.
      //
      if (websocket.readyState !== $da5f289045a8b9aa$var$WebSocket.CONNECTING)
        return;
      req = websocket._req = null;
      const digest = $da5f289045a8b9aa$require$createHash('sha1')
        .update(key + $da5f289045a8b9aa$require$GUID)
        .digest('base64');
      if (res.headers['sec-websocket-accept'] !== digest) {
        $da5f289045a8b9aa$var$abortHandshake(
          websocket,
          socket,
          'Invalid Sec-WebSocket-Accept header',
        );
        return;
      }
      const serverProt = res.headers['sec-websocket-protocol'];
      const protList = (protocols || '').split(/, */);
      let protError;
      if (!protocols && serverProt)
        protError = 'Server sent a subprotocol but none was requested';
      else if (protocols && !serverProt)
        protError = 'Server sent no subprotocol';
      else if (serverProt && !protList.includes(serverProt))
        protError = 'Server sent an invalid subprotocol';
      if (protError) {
        $da5f289045a8b9aa$var$abortHandshake(websocket, socket, protError);
        return;
      }
      if (serverProt) websocket._protocol = serverProt;
      const secWebSocketExtensions = res.headers['sec-websocket-extensions'];
      if (secWebSocketExtensions !== undefined) {
        if (!perMessageDeflate) {
          const message =
            'Server sent a Sec-WebSocket-Extensions header but no extension was requested';
          $da5f289045a8b9aa$var$abortHandshake(websocket, socket, message);
          return;
        }
        let extensions;
        try {
          extensions = $da5f289045a8b9aa$require$parse(secWebSocketExtensions);
        } catch (err) {
          const message = 'Invalid Sec-WebSocket-Extensions header';
          $da5f289045a8b9aa$var$abortHandshake(websocket, socket, message);
          return;
        }
        const extensionNames = Object.keys(extensions);
        if (extensionNames.length) {
          if (
            extensionNames.length !== 1 ||
            extensionNames[0] !== $5QfTR.extensionName
          ) {
            const message =
              'Server indicated an extension that was not requested';
            $da5f289045a8b9aa$var$abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[$5QfTR.extensionName]);
          } catch (err) {
            const message = 'Invalid Sec-WebSocket-Extensions header';
            $da5f289045a8b9aa$var$abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[$5QfTR.extensionName] = perMessageDeflate;
        }
      }
      websocket.setSocket(socket, head, opts.maxPayload);
    });
  }
  /**
   * Emit the `'error'` and `'close'` event.
   *
   * @param {WebSocket} websocket The WebSocket instance
   * @param {Error} The error to emit
   * @private
   */ function $da5f289045a8b9aa$var$emitErrorAndClose(websocket, err) {
    websocket._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
    websocket.emit('error', err);
    websocket.emitClose();
  }
  /**
   * Create a `net.Socket` and initiate a connection.
   *
   * @param {Object} options Connection options
   * @return {net.Socket} The newly created socket used to start the connection
   * @private
   */ function $da5f289045a8b9aa$var$netConnect(options) {
    options.path = options.socketPath;
    return $dmXIQ$net.connect(options);
  }
  /**
   * Create a `tls.TLSSocket` and initiate a connection.
   *
   * @param {Object} options Connection options
   * @return {tls.TLSSocket} The newly created socket used to start the connection
   * @private
   */ function $da5f289045a8b9aa$var$tlsConnect(options) {
    options.path = undefined;
    if (!options.servername && options.servername !== '')
      options.servername = $dmXIQ$net.isIP(options.host) ? '' : options.host;
    return $dmXIQ$tls.connect(options);
  }
  /**
   * Abort the handshake and emit an error.
   *
   * @param {WebSocket} websocket The WebSocket instance
   * @param {(http.ClientRequest|net.Socket|tls.Socket)} stream The request to
   *     abort or the socket to destroy
   * @param {String} message The error message
   * @private
   */ function $da5f289045a8b9aa$var$abortHandshake(
    websocket,
    stream,
    message,
  ) {
    websocket._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
    const err = new Error(message);
    Error.captureStackTrace(err, $da5f289045a8b9aa$var$abortHandshake);
    if (stream.setHeader) {
      stream.abort();
      if (stream.socket && !stream.socket.destroyed)
        //
        // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if
        // called after the request completed. See
        // https://github.com/websockets/ws/issues/1869.
        //
        stream.socket.destroy();
      stream.once('abort', websocket.emitClose.bind(websocket));
      websocket.emit('error', err);
    } else {
      stream.destroy(err);
      stream.once('error', websocket.emit.bind(websocket, 'error'));
      stream.once('close', websocket.emitClose.bind(websocket));
    }
  }
  /**
   * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
   * when the `readyState` attribute is `CLOSING` or `CLOSED`.
   *
   * @param {WebSocket} websocket The WebSocket instance
   * @param {*} [data] The data to send
   * @param {Function} [cb] Callback
   * @private
   */ function $da5f289045a8b9aa$var$sendAfterClose(websocket, data, cb) {
    if (data) {
      const length = $da5f289045a8b9aa$require$toBuffer(data).length;
      //
      // The `_bufferedAmount` property is used only when the peer is a client and
      // the opening handshake fails. Under these circumstances, in fact, the
      // `setSocket()` method is not called, so the `_socket` and `_sender`
      // properties are set to `null`.
      //
      if (websocket._socket) websocket._sender._bufferedBytes += length;
      else websocket._bufferedAmount += length;
    }
    if (cb) {
      const err = new Error(
        `WebSocket is not open: readyState ${websocket.readyState} ` +
          `(${$da5f289045a8b9aa$var$readyStates[websocket.readyState]})`,
      );
      cb(err);
    }
  }
  /**
   * The listener of the `Receiver` `'conclude'` event.
   *
   * @param {Number} code The status code
   * @param {String} reason The reason for closing
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnConclude(code, reason) {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    websocket._closeFrameReceived = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;
    if (websocket._socket[$da5f289045a8b9aa$require$kWebSocket] === undefined)
      return;
    websocket._socket.removeListener(
      'data',
      $da5f289045a8b9aa$var$socketOnData,
    );
    process.nextTick($da5f289045a8b9aa$var$resume, websocket._socket);
    if (code === 1005) websocket.close();
    else websocket.close(code, reason);
  }
  /**
   * The listener of the `Receiver` `'drain'` event.
   *
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnDrain() {
    this[$da5f289045a8b9aa$require$kWebSocket]._socket.resume();
  }
  /**
   * The listener of the `Receiver` `'error'` event.
   *
   * @param {(RangeError|Error)} err The emitted error
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnError(err) {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    if (websocket._socket[$da5f289045a8b9aa$require$kWebSocket] !== undefined) {
      websocket._socket.removeListener(
        'data',
        $da5f289045a8b9aa$var$socketOnData,
      );
      //
      // On Node.js < 14.0.0 the `'error'` event is emitted synchronously. See
      // https://github.com/websockets/ws/issues/1940.
      //
      process.nextTick($da5f289045a8b9aa$var$resume, websocket._socket);
      websocket.close(err[$da5f289045a8b9aa$require$kStatusCode]);
    }
    websocket.emit('error', err);
  }
  /**
   * The listener of the `Receiver` `'finish'` event.
   *
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnFinish() {
    this[$da5f289045a8b9aa$require$kWebSocket].emitClose();
  }
  /**
   * The listener of the `Receiver` `'message'` event.
   *
   * @param {(String|Buffer|ArrayBuffer|Buffer[])} data The message
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnMessage(data) {
    this[$da5f289045a8b9aa$require$kWebSocket].emit('message', data);
  }
  /**
   * The listener of the `Receiver` `'ping'` event.
   *
   * @param {Buffer} data The data included in the ping frame
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnPing(data) {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    websocket.pong(data, !websocket._isServer, $da5f289045a8b9aa$require$NOOP);
    websocket.emit('ping', data);
  }
  /**
   * The listener of the `Receiver` `'pong'` event.
   *
   * @param {Buffer} data The data included in the pong frame
   * @private
   */ function $da5f289045a8b9aa$var$receiverOnPong(data) {
    this[$da5f289045a8b9aa$require$kWebSocket].emit('pong', data);
  }
  /**
   * Resume a readable stream
   *
   * @param {Readable} stream The readable stream
   * @private
   */ function $da5f289045a8b9aa$var$resume(stream) {
    stream.resume();
  }
  /**
   * The listener of the `net.Socket` `'close'` event.
   *
   * @private
   */ function $da5f289045a8b9aa$var$socketOnClose() {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    this.removeListener('close', $da5f289045a8b9aa$var$socketOnClose);
    this.removeListener('data', $da5f289045a8b9aa$var$socketOnData);
    this.removeListener('end', $da5f289045a8b9aa$var$socketOnEnd);
    websocket._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
    let chunk;
    //
    // The close frame might not have been received or the `'end'` event emitted,
    // for example, if the socket was destroyed due to an error. Ensure that the
    // `receiver` stream is closed after writing any remaining buffered data to
    // it. If the readable side of the socket is in flowing mode then there is no
    // buffered data as everything has been already written and `readable.read()`
    // will return `null`. If instead, the socket is paused, any possible buffered
    // data will be read as a single chunk.
    //
    if (
      !this._readableState.endEmitted &&
      !websocket._closeFrameReceived &&
      !websocket._receiver._writableState.errorEmitted &&
      (chunk = websocket._socket.read()) !== null
    )
      websocket._receiver.write(chunk);
    websocket._receiver.end();
    this[$da5f289045a8b9aa$require$kWebSocket] = undefined;
    clearTimeout(websocket._closeTimer);
    if (
      websocket._receiver._writableState.finished ||
      websocket._receiver._writableState.errorEmitted
    )
      websocket.emitClose();
    else {
      websocket._receiver.on('error', $da5f289045a8b9aa$var$receiverOnFinish);
      websocket._receiver.on('finish', $da5f289045a8b9aa$var$receiverOnFinish);
    }
  }
  /**
   * The listener of the `net.Socket` `'data'` event.
   *
   * @param {Buffer} chunk A chunk of data
   * @private
   */ function $da5f289045a8b9aa$var$socketOnData(chunk) {
    if (!this[$da5f289045a8b9aa$require$kWebSocket]._receiver.write(chunk))
      this.pause();
  }
  /**
   * The listener of the `net.Socket` `'end'` event.
   *
   * @private
   */ function $da5f289045a8b9aa$var$socketOnEnd() {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    websocket._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
    websocket._receiver.end();
    this.end();
  }
  /**
   * The listener of the `net.Socket` `'error'` event.
   *
   * @private
   */ function $da5f289045a8b9aa$var$socketOnError() {
    const websocket = this[$da5f289045a8b9aa$require$kWebSocket];
    this.removeListener('error', $da5f289045a8b9aa$var$socketOnError);
    this.on('error', $da5f289045a8b9aa$require$NOOP);
    if (websocket) {
      websocket._readyState = $da5f289045a8b9aa$var$WebSocket.CLOSING;
      this.destroy();
    }
  }
});
parcelRegister('l2TZX', function (module, exports) {
  'use strict';
  /**
   * Class representing an event.
   *
   * @private
   */ class $f52539008d008f12$var$Event {
    /**
     * Create a new `Event`.
     *
     * @param {String} type The name of the event
     * @param {Object} target A reference to the target to which the event was
     *     dispatched
     */ constructor(type, target) {
      this.target = target;
      this.type = type;
    }
  }
  /**
   * Class representing a message event.
   *
   * @extends Event
   * @private
   */ class $f52539008d008f12$var$MessageEvent extends $f52539008d008f12$var$Event {
    /**
     * Create a new `MessageEvent`.
     *
     * @param {(String|Buffer|ArrayBuffer|Buffer[])} data The received data
     * @param {WebSocket} target A reference to the target to which the event was
     *     dispatched
     */ constructor(data, target) {
      super('message', target);
      this.data = data;
    }
  }
  /**
   * Class representing a close event.
   *
   * @extends Event
   * @private
   */ class $f52539008d008f12$var$CloseEvent extends $f52539008d008f12$var$Event {
    /**
     * Create a new `CloseEvent`.
     *
     * @param {Number} code The status code explaining why the connection is being
     *     closed
     * @param {String} reason A human-readable string explaining why the
     *     connection is closing
     * @param {WebSocket} target A reference to the target to which the event was
     *     dispatched
     */ constructor(code, reason, target) {
      super('close', target);
      this.wasClean = target._closeFrameReceived && target._closeFrameSent;
      this.reason = reason;
      this.code = code;
    }
  }
  /**
   * Class representing an open event.
   *
   * @extends Event
   * @private
   */ class $f52539008d008f12$var$OpenEvent extends $f52539008d008f12$var$Event {
    /**
     * Create a new `OpenEvent`.
     *
     * @param {WebSocket} target A reference to the target to which the event was
     *     dispatched
     */ constructor(target) {
      super('open', target);
    }
  }
  /**
   * Class representing an error event.
   *
   * @extends Event
   * @private
   */ class $f52539008d008f12$var$ErrorEvent extends $f52539008d008f12$var$Event {
    /**
     * Create a new `ErrorEvent`.
     *
     * @param {Object} error The error that generated this event
     * @param {WebSocket} target A reference to the target to which the event was
     *     dispatched
     */ constructor(error, target) {
      super('error', target);
      this.message = error.message;
      this.error = error;
    }
  }
  /**
   * This provides methods for emulating the `EventTarget` interface. It's not
   * meant to be used directly.
   *
   * @mixin
   */ const $f52539008d008f12$var$EventTarget = {
    /**
     * Register an event listener.
     *
     * @param {String} type A string representing the event type to listen for
     * @param {Function} listener The listener to add
     * @param {Object} [options] An options object specifies characteristics about
     *     the event listener
     * @param {Boolean} [options.once=false] A `Boolean`` indicating that the
     *     listener should be invoked at most once after being added. If `true`,
     *     the listener would be automatically removed when invoked.
     * @public
     */ addEventListener(type, listener, options) {
      if (typeof listener !== 'function') return;
      function onMessage(data) {
        listener.call(this, new $f52539008d008f12$var$MessageEvent(data, this));
      }
      function onClose(code, message) {
        listener.call(
          this,
          new $f52539008d008f12$var$CloseEvent(code, message, this),
        );
      }
      function onError(error) {
        listener.call(this, new $f52539008d008f12$var$ErrorEvent(error, this));
      }
      function onOpen() {
        listener.call(this, new $f52539008d008f12$var$OpenEvent(this));
      }
      const method = options && options.once ? 'once' : 'on';
      if (type === 'message') {
        onMessage._listener = listener;
        this[method](type, onMessage);
      } else if (type === 'close') {
        onClose._listener = listener;
        this[method](type, onClose);
      } else if (type === 'error') {
        onError._listener = listener;
        this[method](type, onError);
      } else if (type === 'open') {
        onOpen._listener = listener;
        this[method](type, onOpen);
      } else this[method](type, listener);
    },
    /**
     * Remove an event listener.
     *
     * @param {String} type A string representing the event type to remove
     * @param {Function} listener The listener to remove
     * @public
     */ removeEventListener(type, listener) {
      const listeners = this.listeners(type);
      for (let i = 0; i < listeners.length; i++)
        if (listeners[i] === listener || listeners[i]._listener === listener)
          this.removeListener(type, listeners[i]);
    },
  };
  module.exports = $f52539008d008f12$var$EventTarget;
});

parcelRegister('7DMZB', function (module, exports) {
  'use strict';
  //
  // Allowed token characters:
  //
  // '!', '#', '$', '%', '&', ''', '*', '+', '-',
  // '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
  //
  // tokenChars[32] === 0 // ' '
  // tokenChars[33] === 1 // '!'
  // tokenChars[34] === 0 // '"'
  // ...
  //
  // prettier-ignore
  const $59022dd7f350a14c$var$tokenChars = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    1,
    0,
    1,
    0 // 112 - 127
];
  /**
   * Adds an offer to the map of extension offers or a parameter to the map of
   * parameters.
   *
   * @param {Object} dest The map of extension offers or parameters
   * @param {String} name The extension or parameter name
   * @param {(Object|Boolean|String)} elem The extension parameters or the
   *     parameter value
   * @private
   */ function $59022dd7f350a14c$var$push(dest, name, elem) {
    if (dest[name] === undefined) dest[name] = [elem];
    else dest[name].push(elem);
  }
  /**
   * Parses the `Sec-WebSocket-Extensions` header into an object.
   *
   * @param {String} header The field value of the header
   * @return {Object} The parsed object
   * @public
   */ function $59022dd7f350a14c$var$parse(header) {
    const offers = Object.create(null);
    if (header === undefined || header === '') return offers;
    let params = Object.create(null);
    let mustUnescape = false;
    let isEscaping = false;
    let inQuotes = false;
    let extensionName;
    let paramName;
    let start = -1;
    let end = -1;
    let i = 0;
    for (; i < header.length; i++) {
      const code = header.charCodeAt(i);
      if (extensionName === undefined) {
        if (end === -1 && $59022dd7f350a14c$var$tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 0x20 /* ' ' */ || code === 0x09 /* '\t' */) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
          if (start === -1)
            throw new SyntaxError(`Unexpected character at index ${i}`);
          if (end === -1) end = i;
          const name = header.slice(start, end);
          if (code === 0x2c) {
            $59022dd7f350a14c$var$push(offers, name, params);
            params = Object.create(null);
          } else extensionName = name;
          start = end = -1;
        } else throw new SyntaxError(`Unexpected character at index ${i}`);
      } else if (paramName === undefined) {
        if (end === -1 && $59022dd7f350a14c$var$tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 0x20 || code === 0x09) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 0x3b || code === 0x2c) {
          if (start === -1)
            throw new SyntaxError(`Unexpected character at index ${i}`);
          if (end === -1) end = i;
          $59022dd7f350a14c$var$push(params, header.slice(start, end), true);
          if (code === 0x2c) {
            $59022dd7f350a14c$var$push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          start = end = -1;
        } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
          paramName = header.slice(start, i);
          start = end = -1;
        } else throw new SyntaxError(`Unexpected character at index ${i}`);
      } else {
        //
        // The value of a quoted-string after unescaping must conform to the
        // token ABNF, so only token characters are valid.
        // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
        //
        if (isEscaping) {
          if ($59022dd7f350a14c$var$tokenChars[code] !== 1)
            throw new SyntaxError(`Unexpected character at index ${i}`);
          if (start === -1) start = i;
          else if (!mustUnescape) mustUnescape = true;
          isEscaping = false;
        } else if (inQuotes) {
          if ($59022dd7f350a14c$var$tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 0x22 /* '"' */ && start !== -1) {
            inQuotes = false;
            end = i;
          } else if (code === 0x5c /* '\' */) isEscaping = true;
          else throw new SyntaxError(`Unexpected character at index ${i}`);
        } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d)
          inQuotes = true;
        else if (end === -1 && $59022dd7f350a14c$var$tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
          if (end === -1) end = i;
        } else if (code === 0x3b || code === 0x2c) {
          if (start === -1)
            throw new SyntaxError(`Unexpected character at index ${i}`);
          if (end === -1) end = i;
          let value = header.slice(start, end);
          if (mustUnescape) {
            value = value.replace(/\\/g, '');
            mustUnescape = false;
          }
          $59022dd7f350a14c$var$push(params, paramName, value);
          if (code === 0x2c) {
            $59022dd7f350a14c$var$push(offers, extensionName, params);
            params = Object.create(null);
            extensionName = undefined;
          }
          paramName = undefined;
          start = end = -1;
        } else throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
    if (start === -1 || inQuotes)
      throw new SyntaxError('Unexpected end of input');
    if (end === -1) end = i;
    const token = header.slice(start, end);
    if (extensionName === undefined)
      $59022dd7f350a14c$var$push(offers, token, params);
    else {
      if (paramName === undefined)
        $59022dd7f350a14c$var$push(params, token, true);
      else if (mustUnescape)
        $59022dd7f350a14c$var$push(params, paramName, token.replace(/\\/g, ''));
      else $59022dd7f350a14c$var$push(params, paramName, token);
      $59022dd7f350a14c$var$push(offers, extensionName, params);
    }
    return offers;
  }
  /**
   * Builds the `Sec-WebSocket-Extensions` header field value.
   *
   * @param {Object} extensions The map of extensions and parameters to format
   * @return {String} A string representing the given object
   * @public
   */ function $59022dd7f350a14c$var$format(extensions) {
    return Object.keys(extensions)
      .map(extension => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations
          .map(params => {
            return [extension]
              .concat(
                Object.keys(params).map(k => {
                  let values = params[k];
                  if (!Array.isArray(values)) values = [values];
                  return values
                    .map(v => (v === true ? k : `${k}=${v}`))
                    .join('; ');
                }),
              )
              .join('; ');
          })
          .join(', ');
      })
      .join(', ');
  }
  module.exports = {
    format: $59022dd7f350a14c$var$format,
    parse: $59022dd7f350a14c$var$parse,
  };
});

$parcel$defineInteropFlag(module.exports);

$parcel$export(
  module.exports,
  'default',
  () => $8979d6fa383c8759$export$2e2bcd8739ae039,
);

const $e2337524fa4d3e41$var$serverErrorList = {
  EACCES: "You don't have access to bind the server to port {port}.",
  EADDRINUSE: 'There is already a process listening on port {port}.',
};
function $e2337524fa4d3e41$export$2e2bcd8739ae039(err, port) {
  let desc = `Error: ${
    err.code
  } occurred while setting up server on port ${port.toString()}.`;
  if ($e2337524fa4d3e41$var$serverErrorList[err.code])
    desc = $e2337524fa4d3e41$var$serverErrorList[err.code].replace(
      /{port}/g,
      port,
    );
  return desc;
}

var $902cd20c67b03e91$exports = {};
/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */ ('use strict');

/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */ /**
 * Private utility functions
 * @module utils
 * @private
 */ /**
 * Escape characters reserved in regular expressions.
 *
 * If `string` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} string Input string
 * @return {String} Escaped string
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$c998f240a39da81a;
/**
 * Escape characters reserved in XML.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @implements {EscapeCallback}
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$b2bcda23b30e00ac;
/**
 * Naive copy of properties from one object to another.
 * Does not recurse into non-scalar properties
 * Does not check to see if the property has a value before copying
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @return {Object}      Destination object
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$9c13236873b118a5;
/**
 * Naive copy of a list of key names, from one object to another.
 * Only copies property if it is actually defined
 * Does not recurse into non-scalar properties
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @param  {Array} list List of properties to copy
 * @return {Object}      Destination object
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$f83db5734555b793;
/**
 * Simple in-process cache implementation. Does not implement limits of any
 * sort.
 *
 * @implements {Cache}
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$69a3209f1a06c04d;
/**
 * Transforms hyphen case variable into camel case.
 *
 * @param {String} string Hyphen case string
 * @return {String} Camel case string
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$519b2305b0acfa6b;
/**
 * Returns a null-prototype object in runtimes that support it
 *
 * @return {Object} Object, prototype will be set to null where possible
 * @static
 * @private
 */ var $d3a6eace5bb59643$export$a59469c2841c043c;
('use strict');
var $d3a6eace5bb59643$var$regExpChars = /[|\\{}()[\]^$+*?.]/g;
var $d3a6eace5bb59643$var$hasOwnProperty = Object.prototype.hasOwnProperty;
var $d3a6eace5bb59643$var$hasOwn = function (obj, key) {
  return $d3a6eace5bb59643$var$hasOwnProperty.apply(obj, [key]);
};
$d3a6eace5bb59643$export$c998f240a39da81a = function (string) {
  // istanbul ignore if
  if (!string) return '';
  return String(string).replace($d3a6eace5bb59643$var$regExpChars, '\\$&');
};
var $d3a6eace5bb59643$var$_ENCODE_HTML_RULES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;',
};
var $d3a6eace5bb59643$var$_MATCH_HTML = /[&<>'"]/g;
function $d3a6eace5bb59643$var$encode_char(c) {
  return $d3a6eace5bb59643$var$_ENCODE_HTML_RULES[c] || c;
}
/**
 * Stringified version of constants used by {@link module:utils.escapeXML}.
 *
 * It is used in the process of generating {@link ClientFunction}s.
 *
 * @readonly
 * @type {String}
 */ var $d3a6eace5bb59643$var$escapeFuncStr =
  'var _ENCODE_HTML_RULES = {\n      "&": "&amp;"\n    , "<": "&lt;"\n    , ">": "&gt;"\n    , \'"\': "&#34;"\n    , "\'": "&#39;"\n    }\n  , _MATCH_HTML = /[&<>\'"]/g;\nfunction encode_char(c) {\n  return _ENCODE_HTML_RULES[c] || c;\n};\n';
$d3a6eace5bb59643$export$b2bcda23b30e00ac = function (markup) {
  return markup == undefined
    ? ''
    : String(markup).replace(
        $d3a6eace5bb59643$var$_MATCH_HTML,
        $d3a6eace5bb59643$var$encode_char,
      );
};
function $d3a6eace5bb59643$var$escapeXMLToString() {
  return (
    Function.prototype.toString.call(this) +
    ';\n' +
    $d3a6eace5bb59643$var$escapeFuncStr
  );
}
try {
  if (typeof Object.defineProperty === 'function')
    // If the Function prototype is frozen, the "toString" property is non-writable. This means that any objects which inherit this property
    // cannot have the property changed using an assignment. If using strict mode, attempting that will cause an error. If not using strict
    // mode, attempting that will be silently ignored.
    // However, we can still explicitly shadow the prototype's "toString" property by defining a new "toString" property on this object.
    Object.defineProperty(
      $d3a6eace5bb59643$export$b2bcda23b30e00ac,
      'toString',
      {
        value: $d3a6eace5bb59643$var$escapeXMLToString,
      },
    );
  // If Object.defineProperty() doesn't exist, attempt to shadow this property using the assignment operator.
  else
    $d3a6eace5bb59643$export$b2bcda23b30e00ac.toString =
      $d3a6eace5bb59643$var$escapeXMLToString;
} catch (err) {
  console.warn(
    'Unable to set escapeXML.toString (is the Function prototype frozen?)',
  );
}
$d3a6eace5bb59643$export$9c13236873b118a5 = function (to, from) {
  from = from || {};
  if (to !== null && to !== undefined)
    for (var p in from) {
      if (!$d3a6eace5bb59643$var$hasOwn(from, p)) continue;
      if (p === '__proto__' || p === 'constructor') continue;
      to[p] = from[p];
    }
  return to;
};
$d3a6eace5bb59643$export$f83db5734555b793 = function (to, from, list) {
  list = list || [];
  from = from || {};
  if (to !== null && to !== undefined)
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (typeof from[p] != 'undefined') {
        if (!$d3a6eace5bb59643$var$hasOwn(from, p)) continue;
        if (p === '__proto__' || p === 'constructor') continue;
        to[p] = from[p];
      }
    }
  return to;
};
$d3a6eace5bb59643$export$69a3209f1a06c04d = {
  _data: {},
  set: function (key, val) {
    this._data[key] = val;
  },
  get: function (key) {
    return this._data[key];
  },
  remove: function (key) {
    delete this._data[key];
  },
  reset: function () {
    this._data = {};
  },
};
$d3a6eace5bb59643$export$519b2305b0acfa6b = function (str) {
  return str.replace(/-[a-z]/g, function (match) {
    return match[1].toUpperCase();
  });
};
$d3a6eace5bb59643$export$a59469c2841c043c = (function () {
  if (typeof Object.create == 'function')
    return function () {
      return Object.create(null);
    };
  // Not possible, just pass through
  return function () {
    return {};
  };
})();

var $902cd20c67b03e91$var$scopeOptionWarned = false;
var $3a090431599337b6$exports = {};
$3a090431599337b6$exports = JSON.parse(
  '{"name":"ejs","description":"Embedded JavaScript templates","keywords":["template","engine","ejs"],"version":"3.1.9","author":"Matthew Eernisse <mde@fleegix.org> (http://fleegix.org)","license":"Apache-2.0","bin":{"ejs":"./bin/cli.js"},"main":"./lib/ejs.js","jsdelivr":"ejs.min.js","unpkg":"ejs.min.js","repository":{"type":"git","url":"git://github.com/mde/ejs.git"},"bugs":"https://github.com/mde/ejs/issues","homepage":"https://github.com/mde/ejs","dependencies":{"jake":"^10.8.5"},"devDependencies":{"browserify":"^16.5.1","eslint":"^6.8.0","git-directory-deploy":"^1.5.1","jsdoc":"^4.0.2","lru-cache":"^4.0.1","mocha":"^10.2.0","uglify-js":"^3.3.16"},"engines":{"node":">=0.10.0"},"scripts":{"test":"mocha -u tdd"}}',
);

var $902cd20c67b03e91$require$_VERSION_STRING =
  $3a090431599337b6$exports.version;
var $902cd20c67b03e91$var$_DEFAULT_OPEN_DELIMITER = '<';
var $902cd20c67b03e91$var$_DEFAULT_CLOSE_DELIMITER = '>';
var $902cd20c67b03e91$var$_DEFAULT_DELIMITER = '%';
var $902cd20c67b03e91$var$_DEFAULT_LOCALS_NAME = 'locals';
var $902cd20c67b03e91$var$_NAME = 'ejs';
var $902cd20c67b03e91$var$_REGEX_STRING =
  '(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)';
var $902cd20c67b03e91$var$_OPTS_PASSABLE_WITH_DATA = [
  'delimiter',
  'scope',
  'context',
  'debug',
  'compileDebug',
  'client',
  '_with',
  'rmWhitespace',
  'strict',
  'filename',
  'async',
];
// We don't allow 'cache' option to be passed in the data obj for
// the normal `render` call, but this is where Express 2 & 3 put it
// so we make an exception for `renderFile`
var $902cd20c67b03e91$var$_OPTS_PASSABLE_WITH_DATA_EXPRESS =
  $902cd20c67b03e91$var$_OPTS_PASSABLE_WITH_DATA.concat('cache');
var $902cd20c67b03e91$var$_BOM = /^\uFEFF/;
var $902cd20c67b03e91$var$_JS_IDENTIFIER = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;
/**
 * EJS template function cache. This can be a LRU object from lru-cache NPM
 * module. By default, it is {@link module:utils.cache}, a simple in-process
 * cache that grows continuously.
 *
 * @type {Cache}
 */ $902cd20c67b03e91$exports.cache = $d3a6eace5bb59643$export$69a3209f1a06c04d;
/**
 * Custom file loader. Useful for template preprocessing or restricting access
 * to a certain part of the filesystem.
 *
 * @type {fileLoader}
 */ $902cd20c67b03e91$exports.fileLoader = $dmXIQ$fs.readFileSync;
/**
 * Name of the object containing the locals.
 *
 * This variable is overridden by {@link Options}`.localsName` if it is not
 * `undefined`.
 *
 * @type {String}
 * @public
 */ $902cd20c67b03e91$exports.localsName =
  $902cd20c67b03e91$var$_DEFAULT_LOCALS_NAME;
/**
 * Promise implementation -- defaults to the native implementation if available
 * This is mostly just for testability
 *
 * @type {PromiseConstructorLike}
 * @public
 */ $902cd20c67b03e91$exports.promiseImpl = new Function(
  'return this;',
)().Promise;
/**
 * Get the path to the included file from the parent file path and the
 * specified path.
 *
 * @param {String}  name     specified path
 * @param {String}  filename parent file path
 * @param {Boolean} [isDir=false] whether the parent file path is a directory
 * @return {String}
 */ $902cd20c67b03e91$exports.resolveInclude = function (
  name,
  filename,
  isDir,
) {
  var dirname = $dmXIQ$path.dirname;
  var extname = $dmXIQ$path.extname;
  var resolve = $dmXIQ$path.resolve;
  var includePath = resolve(isDir ? filename : dirname(filename), name);
  var ext = extname(name);
  if (!ext) includePath += '.ejs';
  return includePath;
};
/**
 * Try to resolve file path on multiple directories
 *
 * @param  {String}        name  specified path
 * @param  {Array<String>} paths list of possible parent directory paths
 * @return {String}
 */ function $902cd20c67b03e91$var$resolvePaths(name, paths) {
  var filePath;
  if (
    paths.some(function (v) {
      filePath = $902cd20c67b03e91$exports.resolveInclude(name, v, true);
      return $dmXIQ$fs.existsSync(filePath);
    })
  )
    return filePath;
}
/**
 * Get the path to the included file by Options
 *
 * @param  {String}  path    specified path
 * @param  {Options} options compilation options
 * @return {String}
 */ function $902cd20c67b03e91$var$getIncludePath(path, options) {
  var includePath;
  var filePath;
  var views = options.views;
  var match = /^[A-Za-z]+:\\|^\//.exec(path);
  // Abs path
  if (match && match.length) {
    path = path.replace(/^\/*/, '');
    if (Array.isArray(options.root))
      includePath = $902cd20c67b03e91$var$resolvePaths(path, options.root);
    else
      includePath = $902cd20c67b03e91$exports.resolveInclude(
        path,
        options.root || '/',
        true,
      );
  } else {
    // Look relative to a passed filename first
    if (options.filename) {
      filePath = $902cd20c67b03e91$exports.resolveInclude(
        path,
        options.filename,
      );
      if ($dmXIQ$fs.existsSync(filePath)) includePath = filePath;
    }
    // Then look in any views directories
    if (!includePath && Array.isArray(views))
      includePath = $902cd20c67b03e91$var$resolvePaths(path, views);
    if (!includePath && typeof options.includer !== 'function')
      throw new Error(
        'Could not find the include file "' +
          options.escapeFunction(path) +
          '"',
      );
  }
  return includePath;
}
/**
 * Get the template from a string or a file, either compiled on-the-fly or
 * read from cache (if enabled), and cache the template if needed.
 *
 * If `template` is not set, the file specified in `options.filename` will be
 * read.
 *
 * If `options.cache` is true, this function reads the file from
 * `options.filename` so it must be set prior to calling this function.
 *
 * @memberof module:ejs-internal
 * @param {Options} options   compilation options
 * @param {String} [template] template source
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned.
 * @static
 */ function $902cd20c67b03e91$var$handleCache(options, template) {
  var func;
  var filename = options.filename;
  var hasTemplate = arguments.length > 1;
  if (options.cache) {
    if (!filename) throw new Error('cache option requires a filename');
    func = $902cd20c67b03e91$exports.cache.get(filename);
    if (func) return func;
    if (!hasTemplate)
      template = $902cd20c67b03e91$var$fileLoader(filename)
        .toString()
        .replace($902cd20c67b03e91$var$_BOM, '');
  } else if (!hasTemplate) {
    // istanbul ignore if: should not happen at all
    if (!filename)
      throw new Error('Internal EJS error: no file name or template provided');
    template = $902cd20c67b03e91$var$fileLoader(filename)
      .toString()
      .replace($902cd20c67b03e91$var$_BOM, '');
  }
  func = $902cd20c67b03e91$exports.compile(template, options);
  if (options.cache) $902cd20c67b03e91$exports.cache.set(filename, func);
  return func;
}
/**
 * Try calling handleCache with the given options and data and call the
 * callback with the result. If an error occurs, call the callback with
 * the error. Used by renderFile().
 *
 * @memberof module:ejs-internal
 * @param {Options} options    compilation options
 * @param {Object} data        template data
 * @param {RenderFileCallback} cb callback
 * @static
 */ function $902cd20c67b03e91$var$tryHandleCache(options, data, cb) {
  var result;
  if (!cb) {
    if (typeof $902cd20c67b03e91$exports.promiseImpl == 'function')
      return new $902cd20c67b03e91$exports.promiseImpl(function (
        resolve,
        reject,
      ) {
        try {
          result = $902cd20c67b03e91$var$handleCache(options)(data);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    else throw new Error('Please provide a callback function');
  } else {
    try {
      result = $902cd20c67b03e91$var$handleCache(options)(data);
    } catch (err) {
      return cb(err);
    }
    cb(null, result);
  }
}
/**
 * fileLoader is independent
 *
 * @param {String} filePath ejs file path.
 * @return {String} The contents of the specified file.
 * @static
 */ function $902cd20c67b03e91$var$fileLoader(filePath) {
  return $902cd20c67b03e91$exports.fileLoader(filePath);
}
/**
 * Get the template function.
 *
 * If `options.cache` is `true`, then the template is cached.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned
 * @static
 */ function $902cd20c67b03e91$var$includeFile(path, options) {
  var opts = $d3a6eace5bb59643$export$9c13236873b118a5(
    $d3a6eace5bb59643$export$a59469c2841c043c(),
    options,
  );
  opts.filename = $902cd20c67b03e91$var$getIncludePath(path, opts);
  if (typeof options.includer === 'function') {
    var includerResult = options.includer(path, opts.filename);
    if (includerResult) {
      if (includerResult.filename) opts.filename = includerResult.filename;
      if (includerResult.template)
        return $902cd20c67b03e91$var$handleCache(opts, includerResult.template);
    }
  }
  return $902cd20c67b03e91$var$handleCache(opts);
}
/**
 * Re-throw the given `err` in context to the `str` of ejs, `filename`, and
 * `lineno`.
 *
 * @implements {RethrowCallback}
 * @memberof module:ejs-internal
 * @param {Error}  err      Error object
 * @param {String} str      EJS source
 * @param {String} flnm     file name of the EJS file
 * @param {Number} lineno   line number of the error
 * @param {EscapeCallback} esc
 * @static
 */ function $902cd20c67b03e91$var$rethrow(err, str, flnm, lineno, esc) {
  var lines = str.split('\n');
  var start = Math.max(lineno - 3, 0);
  var end = Math.min(lines.length, lineno + 3);
  var filename = esc(flnm);
  // Error context
  var context = lines
    .slice(start, end)
    .map(function (line, i) {
      var curr = i + start + 1;
      return (curr == lineno ? ' >> ' : '    ') + curr + '| ' + line;
    })
    .join('\n');
  // Alter exception message
  err.path = filename;
  err.message =
    (filename || 'ejs') + ':' + lineno + '\n' + context + '\n\n' + err.message;
  throw err;
}
function $902cd20c67b03e91$var$stripSemi(str) {
  return str.replace(/;(\s*$)/, '$1');
}
/**
 * Compile the given `str` of ejs into a template function.
 *
 * @param {String}  template EJS template
 *
 * @param {Options} [opts] compilation options
 *
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `opts.client`, either type might be returned.
 * Note that the return type of the function also depends on the value of `opts.async`.
 * @public
 */ $902cd20c67b03e91$exports.compile = function compile(template, opts) {
  var templ;
  // v1 compat
  // 'scope' is 'context'
  // FIXME: Remove this in a future version
  if (opts && opts.scope) {
    if (!$902cd20c67b03e91$var$scopeOptionWarned) {
      console.warn('`scope` option is deprecated and will be removed in EJS 3');
      $902cd20c67b03e91$var$scopeOptionWarned = true;
    }
    if (!opts.context) opts.context = opts.scope;
    delete opts.scope;
  }
  templ = new $902cd20c67b03e91$var$Template(template, opts);
  return templ.compile();
};
/**
 * Render the given `template` of ejs.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}   template EJS template
 * @param {Object}  [data={}] template data
 * @param {Options} [opts={}] compilation and rendering options
 * @return {(String|Promise<String>)}
 * Return value type depends on `opts.async`.
 * @public
 */ $902cd20c67b03e91$exports.render = function (template, d, o) {
  var data = d || $d3a6eace5bb59643$export$a59469c2841c043c();
  var opts = o || $d3a6eace5bb59643$export$a59469c2841c043c();
  // No options object -- if there are optiony names
  // in the data, copy them to options
  if (arguments.length == 2)
    $d3a6eace5bb59643$export$f83db5734555b793(
      opts,
      data,
      $902cd20c67b03e91$var$_OPTS_PASSABLE_WITH_DATA,
    );
  return $902cd20c67b03e91$var$handleCache(opts, template)(data);
};
/**
 * Render an EJS file at the given `path` and callback `cb(err, str)`.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}             path     path to the EJS file
 * @param {Object}            [data={}] template data
 * @param {Options}           [opts={}] compilation and rendering options
 * @param {RenderFileCallback} cb callback
 * @public
 */ $902cd20c67b03e91$exports.renderFile = function () {
  var args = Array.prototype.slice.call(arguments);
  var filename = args.shift();
  var cb;
  var opts = {
    filename: filename,
  };
  var data;
  var viewOpts;
  // Do we have a callback?
  if (typeof arguments[arguments.length - 1] == 'function') cb = args.pop();
  // Do we have data/opts?
  if (args.length) {
    // Should always have data obj
    data = args.shift();
    // Normal passed opts (data obj + opts obj)
    if (args.length)
      // Use shallowCopy so we don't pollute passed in opts obj with new vals
      $d3a6eace5bb59643$export$9c13236873b118a5(opts, args.pop());
    else {
      // Express 3 and 4
      if (data.settings) {
        // Pull a few things from known locations
        if (data.settings.views) opts.views = data.settings.views;
        if (data.settings['view cache']) opts.cache = true;
        // Undocumented after Express 2, but still usable, esp. for
        // items that are unsafe to be passed along with data, like `root`
        viewOpts = data.settings['view options'];
        if (viewOpts) $d3a6eace5bb59643$export$9c13236873b118a5(opts, viewOpts);
      }
      // Express 2 and lower, values set in app.locals, or people who just
      // want to pass options in their data. NOTE: These values will override
      // anything previously set in settings  or settings['view options']
      $d3a6eace5bb59643$export$f83db5734555b793(
        opts,
        data,
        $902cd20c67b03e91$var$_OPTS_PASSABLE_WITH_DATA_EXPRESS,
      );
    }
    opts.filename = filename;
  } else data = $d3a6eace5bb59643$export$a59469c2841c043c();
  return $902cd20c67b03e91$var$tryHandleCache(opts, data, cb);
};
/**
 * Clear intermediate JavaScript cache. Calls {@link Cache#reset}.
 * @public
 */ /**
 * EJS template class
 * @public
 */ $902cd20c67b03e91$exports.Template = $902cd20c67b03e91$var$Template;
$902cd20c67b03e91$exports.clearCache = function () {
  $902cd20c67b03e91$exports.cache.reset();
};
function $902cd20c67b03e91$var$Template(text, opts) {
  opts = opts || $d3a6eace5bb59643$export$a59469c2841c043c();
  var options = $d3a6eace5bb59643$export$a59469c2841c043c();
  this.templateText = text;
  /** @type {string | null} */ this.mode = null;
  this.truncate = false;
  this.currentLine = 1;
  this.source = '';
  options.client = opts.client || false;
  options.escapeFunction =
    opts.escape ||
    opts.escapeFunction ||
    $d3a6eace5bb59643$export$b2bcda23b30e00ac;
  options.compileDebug = opts.compileDebug !== false;
  options.debug = !!opts.debug;
  options.filename = opts.filename;
  options.openDelimiter =
    opts.openDelimiter ||
    $902cd20c67b03e91$exports.openDelimiter ||
    $902cd20c67b03e91$var$_DEFAULT_OPEN_DELIMITER;
  options.closeDelimiter =
    opts.closeDelimiter ||
    $902cd20c67b03e91$exports.closeDelimiter ||
    $902cd20c67b03e91$var$_DEFAULT_CLOSE_DELIMITER;
  options.delimiter =
    opts.delimiter ||
    $902cd20c67b03e91$exports.delimiter ||
    $902cd20c67b03e91$var$_DEFAULT_DELIMITER;
  options.strict = opts.strict || false;
  options.context = opts.context;
  options.cache = opts.cache || false;
  options.rmWhitespace = opts.rmWhitespace;
  options.root = opts.root;
  options.includer = opts.includer;
  options.outputFunctionName = opts.outputFunctionName;
  options.localsName =
    opts.localsName ||
    $902cd20c67b03e91$exports.localsName ||
    $902cd20c67b03e91$var$_DEFAULT_LOCALS_NAME;
  options.views = opts.views;
  options.async = opts.async;
  options.destructuredLocals = opts.destructuredLocals;
  options.legacyInclude =
    typeof opts.legacyInclude != 'undefined' ? !!opts.legacyInclude : true;
  if (options.strict) options._with = false;
  else options._with = typeof opts._with != 'undefined' ? opts._with : true;
  this.opts = options;
  this.regex = this.createRegex();
}
$902cd20c67b03e91$var$Template.modes = {
  EVAL: 'eval',
  ESCAPED: 'escaped',
  RAW: 'raw',
  COMMENT: 'comment',
  LITERAL: 'literal',
};
$902cd20c67b03e91$var$Template.prototype = {
  createRegex: function () {
    var str = $902cd20c67b03e91$var$_REGEX_STRING;
    var delim = $d3a6eace5bb59643$export$c998f240a39da81a(this.opts.delimiter);
    var open = $d3a6eace5bb59643$export$c998f240a39da81a(
      this.opts.openDelimiter,
    );
    var close = $d3a6eace5bb59643$export$c998f240a39da81a(
      this.opts.closeDelimiter,
    );
    str = str.replace(/%/g, delim).replace(/</g, open).replace(/>/g, close);
    return new RegExp(str);
  },
  compile: function () {
    /** @type {string} */ var src;
    /** @type {ClientFunction} */ var fn;
    var opts = this.opts;
    var prepended = '';
    var appended = '';
    /** @type {EscapeCallback} */ var escapeFn = opts.escapeFunction;
    /** @type {FunctionConstructor} */ var ctor;
    /** @type {string} */ var sanitizedFilename = opts.filename
      ? JSON.stringify(opts.filename)
      : 'undefined';
    if (!this.source) {
      this.generateSource();
      prepended +=
        '  var __output = "";\n  function __append(s) { if (s !== undefined && s !== null) __output += s }\n';
      if (opts.outputFunctionName) {
        if (!$902cd20c67b03e91$var$_JS_IDENTIFIER.test(opts.outputFunctionName))
          throw new Error('outputFunctionName is not a valid JS identifier.');
        prepended += '  var ' + opts.outputFunctionName + ' = __append;' + '\n';
      }
      if (
        opts.localsName &&
        !$902cd20c67b03e91$var$_JS_IDENTIFIER.test(opts.localsName)
      )
        throw new Error('localsName is not a valid JS identifier.');
      if (opts.destructuredLocals && opts.destructuredLocals.length) {
        var destructuring =
          '  var __locals = (' + opts.localsName + ' || {}),\n';
        for (var i = 0; i < opts.destructuredLocals.length; i++) {
          var name = opts.destructuredLocals[i];
          if (!$902cd20c67b03e91$var$_JS_IDENTIFIER.test(name))
            throw new Error(
              'destructuredLocals[' + i + '] is not a valid JS identifier.',
            );
          if (i > 0) destructuring += ',\n  ';
          destructuring += name + ' = __locals.' + name;
        }
        prepended += destructuring + ';\n';
      }
      if (opts._with !== false) {
        prepended += '  with (' + opts.localsName + ' || {}) {' + '\n';
        appended += '  }\n';
      }
      appended += '  return __output;\n';
      this.source = prepended + this.source + appended;
    }
    if (opts.compileDebug)
      src =
        'var __line = 1\n  , __lines = ' +
        JSON.stringify(this.templateText) +
        '\n' +
        '  , __filename = ' +
        sanitizedFilename +
        ';' +
        '\n' +
        'try {' +
        '\n' +
        this.source +
        '} catch (e) {' +
        '\n' +
        '  rethrow(e, __lines, __filename, __line, escapeFn);' +
        '\n' +
        '}' +
        '\n';
    else src = this.source;
    if (opts.client) {
      src = 'escapeFn = escapeFn || ' + escapeFn.toString() + ';' + '\n' + src;
      if (opts.compileDebug)
        src =
          'rethrow = rethrow || ' +
          $902cd20c67b03e91$var$rethrow.toString() +
          ';' +
          '\n' +
          src;
    }
    if (opts.strict) src = '"use strict";\n' + src;
    if (opts.debug) console.log(src);
    if (opts.compileDebug && opts.filename)
      src = src + '\n' + '//# sourceURL=' + sanitizedFilename + '\n';
    try {
      if (opts.async)
        // Have to use generated function for this, since in envs without support,
        // it breaks in parsing
        try {
          ctor = new Function('return (async function(){}).constructor;')();
        } catch (e) {
          if (e instanceof SyntaxError)
            throw new Error('This environment does not support async/await');
          else throw e;
        }
      else ctor = Function;
      fn = new ctor(opts.localsName + ', escapeFn, include, rethrow', src);
    } catch (e) {
      // istanbul ignore else
      if (e instanceof SyntaxError) {
        if (opts.filename) e.message += ' in ' + opts.filename;
        e.message += ' while compiling ejs\n\n';
        e.message +=
          'If the above error is not helpful, you may want to try EJS-Lint:\n';
        e.message += 'https://github.com/RyanZim/EJS-Lint';
        if (!opts.async) {
          e.message += '\n';
          e.message +=
            'Or, if you meant to create an async function, pass `async: true` as an option.';
        }
      }
      throw e;
    }
    // Return a callable function which will execute the function
    // created by the source-code, with the passed data as locals
    // Adds a local `include` function which allows full recursive include
    var returnedFn = opts.client
      ? fn
      : function anonymous(data) {
          var include = function (path, includeData) {
            var d = $d3a6eace5bb59643$export$9c13236873b118a5(
              $d3a6eace5bb59643$export$a59469c2841c043c(),
              data,
            );
            if (includeData)
              d = $d3a6eace5bb59643$export$9c13236873b118a5(d, includeData);
            return $902cd20c67b03e91$var$includeFile(path, opts)(d);
          };
          return fn.apply(opts.context, [
            data || $d3a6eace5bb59643$export$a59469c2841c043c(),
            escapeFn,
            include,
            $902cd20c67b03e91$var$rethrow,
          ]);
        };
    if (opts.filename && typeof Object.defineProperty === 'function') {
      var filename = opts.filename;
      var basename = $dmXIQ$path.basename(
        filename,
        $dmXIQ$path.extname(filename),
      );
      try {
        Object.defineProperty(returnedFn, 'name', {
          value: basename,
          writable: false,
          enumerable: false,
          configurable: true,
        });
      } catch (e) {}
    }
    return returnedFn;
  },
  generateSource: function () {
    var opts = this.opts;
    if (opts.rmWhitespace)
      // Have to use two separate replace here as `^` and `$` operators don't
      // work well with `\r` and empty lines don't work well with the `m` flag.
      this.templateText = this.templateText
        .replace(/[\r\n]+/g, '\n')
        .replace(/^\s+|\s+$/gm, '');
    // Slurp spaces and tabs before <%_ and after _%>
    this.templateText = this.templateText
      .replace(/[ \t]*<%_/gm, '<%_')
      .replace(/_%>[ \t]*/gm, '_%>');
    var self = this;
    var matches = this.parseTemplateText();
    var d = this.opts.delimiter;
    var o = this.opts.openDelimiter;
    var c = this.opts.closeDelimiter;
    if (matches && matches.length)
      matches.forEach(function (line, index) {
        var closing;
        // If this is an opening tag, check for closing tags
        // FIXME: May end up with some false positives here
        // Better to store modes as k/v with openDelimiter + delimiter as key
        // Then this can simply check against the map
        if (
          line.indexOf(o + d) === 0 && // If it is a tag
          line.indexOf(o + d + d) !== 0
        ) {
          closing = matches[index + 2];
          if (
            !(
              closing == d + c ||
              closing == '-' + d + c ||
              closing == '_' + d + c
            )
          )
            throw new Error(
              'Could not find matching close tag for "' + line + '".',
            );
        }
        self.scanLine(line);
      });
  },
  parseTemplateText: function () {
    var str = this.templateText;
    var pat = this.regex;
    var result = pat.exec(str);
    var arr = [];
    var firstPos;
    while (result) {
      firstPos = result.index;
      if (firstPos !== 0) {
        arr.push(str.substring(0, firstPos));
        str = str.slice(firstPos);
      }
      arr.push(result[0]);
      str = str.slice(result[0].length);
      result = pat.exec(str);
    }
    if (str) arr.push(str);
    return arr;
  },
  _addOutput: function (line) {
    if (this.truncate) {
      // Only replace single leading linebreak in the line after
      // -%> tag -- this is the single, trailing linebreak
      // after the tag that the truncation mode replaces
      // Handle Win / Unix / old Mac linebreaks -- do the \r\n
      // combo first in the regex-or
      line = line.replace(/^(?:\r\n|\r|\n)/, '');
      this.truncate = false;
    }
    if (!line) return line;
    // Preserve literal slashes
    line = line.replace(/\\/g, '\\\\');
    // Convert linebreaks
    line = line.replace(/\n/g, '\\n');
    line = line.replace(/\r/g, '\\r');
    // Escape double-quotes
    // - this will be the delimiter during execution
    line = line.replace(/"/g, '\\"');
    this.source += '    ; __append("' + line + '")' + '\n';
  },
  scanLine: function (line) {
    var self = this;
    var d = this.opts.delimiter;
    var o = this.opts.openDelimiter;
    var c = this.opts.closeDelimiter;
    var newLineCount = 0;
    newLineCount = line.split('\n').length - 1;
    switch (line) {
      case o + d:
      case o + d + '_':
        this.mode = $902cd20c67b03e91$var$Template.modes.EVAL;
        break;
      case o + d + '=':
        this.mode = $902cd20c67b03e91$var$Template.modes.ESCAPED;
        break;
      case o + d + '-':
        this.mode = $902cd20c67b03e91$var$Template.modes.RAW;
        break;
      case o + d + '#':
        this.mode = $902cd20c67b03e91$var$Template.modes.COMMENT;
        break;
      case o + d + d:
        this.mode = $902cd20c67b03e91$var$Template.modes.LITERAL;
        this.source +=
          '    ; __append("' + line.replace(o + d + d, o + d) + '")' + '\n';
        break;
      case d + d + c:
        this.mode = $902cd20c67b03e91$var$Template.modes.LITERAL;
        this.source +=
          '    ; __append("' + line.replace(d + d + c, d + c) + '")' + '\n';
        break;
      case d + c:
      case '-' + d + c:
      case '_' + d + c:
        if (this.mode == $902cd20c67b03e91$var$Template.modes.LITERAL)
          this._addOutput(line);
        this.mode = null;
        this.truncate = line.indexOf('-') === 0 || line.indexOf('_') === 0;
        break;
      default:
        // In script mode, depends on type of tag
        if (this.mode) {
          // If '//' is found without a line break, add a line break.
          switch (this.mode) {
            case $902cd20c67b03e91$var$Template.modes.EVAL:
            case $902cd20c67b03e91$var$Template.modes.ESCAPED:
            case $902cd20c67b03e91$var$Template.modes.RAW:
              if (line.lastIndexOf('//') > line.lastIndexOf('\n')) line += '\n';
          }
          switch (this.mode) {
            // Just executing code
            case $902cd20c67b03e91$var$Template.modes.EVAL:
              this.source += '    ; ' + line + '\n';
              break;
            // Exec, esc, and output
            case $902cd20c67b03e91$var$Template.modes.ESCAPED:
              this.source +=
                '    ; __append(escapeFn(' +
                $902cd20c67b03e91$var$stripSemi(line) +
                '))' +
                '\n';
              break;
            // Exec and output
            case $902cd20c67b03e91$var$Template.modes.RAW:
              this.source +=
                '    ; __append(' +
                $902cd20c67b03e91$var$stripSemi(line) +
                ')' +
                '\n';
              break;
            case $902cd20c67b03e91$var$Template.modes.COMMENT:
              break;
            // Literal <%% mode, append as raw output
            case $902cd20c67b03e91$var$Template.modes.LITERAL:
              this._addOutput(line);
              break;
          }
        } else this._addOutput(line);
    }
    if (self.opts.compileDebug && newLineCount) {
      this.currentLine += newLineCount;
      this.source += '    ; __line = ' + this.currentLine + '\n';
    }
  },
};
/**
 * Escape characters reserved in XML.
 *
 * This is simply an export of {@link module:utils.escapeXML}.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @public
 * @func
 * */ $902cd20c67b03e91$exports.escapeXML =
  $d3a6eace5bb59643$export$b2bcda23b30e00ac;
/**
 * Express.js support.
 *
 * This is an alias for {@link module:ejs.renderFile}, in order to support
 * Express.js out-of-the-box.
 *
 * @func
 */ $902cd20c67b03e91$exports.__express = $902cd20c67b03e91$exports.renderFile;
/**
 * Version of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */ $902cd20c67b03e91$exports.VERSION =
  $902cd20c67b03e91$require$_VERSION_STRING;
/**
 * Name for detection of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */ $902cd20c67b03e91$exports.name = $902cd20c67b03e91$var$_NAME;
/* istanbul ignore if */ if (typeof window != 'undefined')
  window.ejs = $902cd20c67b03e91$exports;

var $c969ebc216babcb0$exports = {};
/*!
 * connect
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');

/**
 * Module dependencies.
 * @private
 */ var $c969ebc216babcb0$var$debug =
  parcelRequire('kCnJa')('connect:dispatcher');

var $c969ebc216babcb0$require$EventEmitter = $dmXIQ$events.EventEmitter;
var $1101d1d62d4ad7c9$exports = {};
/*!
 * finalhandler
 * Copyright(c) 2014-2017 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');

/**
 * Module dependencies.
 * @private
 */ var $1101d1d62d4ad7c9$var$debug = parcelRequire('eliWj')('finalhandler');
var $18ab92dd362e3405$exports = {};
/*!
 * encodeurl
 * Copyright(c) 2016 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $18ab92dd362e3405$exports = $18ab92dd362e3405$var$encodeUrl;
/**
 * RegExp to match non-URL code points, *after* encoding (i.e. not including "%")
 * and including invalid escape sequences.
 * @private
 */ var $18ab92dd362e3405$var$ENCODE_CHARS_REGEXP =
  /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
/**
 * RegExp to match unmatched surrogate pair.
 * @private
 */ var $18ab92dd362e3405$var$UNMATCHED_SURROGATE_PAIR_REGEXP =
  /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;
/**
 * String to replace unmatched surrogate pair with.
 * @private
 */ var $18ab92dd362e3405$var$UNMATCHED_SURROGATE_PAIR_REPLACE = '$1\uFFFD$2';
/**
 * Encode a URL to a percent-encoded form, excluding already-encoded sequences.
 *
 * This function will take an already-encoded URL and encode all the non-URL
 * code points. This function will not encode the "%" character unless it is
 * not part of a valid sequence (`%20` will be left as-is, but `%foo` will
 * be encoded as `%25foo`).
 *
 * This encode is meant to be "safe" and does not throw errors. It will try as
 * hard as it can to properly encode the given URL, including replacing any raw,
 * unpaired surrogate pairs with the Unicode replacement character prior to
 * encoding.
 *
 * @param {string} url
 * @return {string}
 * @public
 */ function $18ab92dd362e3405$var$encodeUrl(url) {
  return String(url)
    .replace(
      $18ab92dd362e3405$var$UNMATCHED_SURROGATE_PAIR_REGEXP,
      $18ab92dd362e3405$var$UNMATCHED_SURROGATE_PAIR_REPLACE,
    )
    .replace($18ab92dd362e3405$var$ENCODE_CHARS_REGEXP, encodeURI);
}

var $e016d48dad325d91$exports = {};
/*!
 * escape-html
 * Copyright(c) 2012-2013 TJ Holowaychuk
 * Copyright(c) 2015 Andreas Lubbe
 * Copyright(c) 2015 Tiancheng "Timothy" Gu
 * MIT Licensed
 */ ('use strict');
/**
 * Module variables.
 * @private
 */ var $e016d48dad325d91$var$matchHtmlRegExp = /["'&<>]/;
/**
 * Module exports.
 * @public
 */ $e016d48dad325d91$exports = $e016d48dad325d91$var$escapeHtml;
/**
 * Escape special characters in the given string of html.
 *
 * @param  {string} string The string to escape for inserting into HTML
 * @return {string}
 * @public
 */ function $e016d48dad325d91$var$escapeHtml(string) {
  var str = '' + string;
  var match = $e016d48dad325d91$var$matchHtmlRegExp.exec(str);
  if (!match) return str;
  var escape;
  var html = '';
  var index = 0;
  var lastIndex = 0;
  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34:
        escape = '&quot;';
        break;
      case 38:
        escape = '&amp;';
        break;
      case 39:
        escape = '&#39;';
        break;
      case 60:
        escape = '&lt;';
        break;
      case 62:
        escape = '&gt;';
        break;
      default:
        continue;
    }
    if (lastIndex !== index) html += str.substring(lastIndex, index);
    lastIndex = index + 1;
    html += escape;
  }
  return lastIndex !== index ? html + str.substring(lastIndex, index) : html;
}

var $3f5ae9f0bd6e41bd$exports = {};
/*!
 * on-finished
 * Copyright(c) 2013 Jonathan Ong
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $3f5ae9f0bd6e41bd$exports = $3f5ae9f0bd6e41bd$var$onFinished;
$3f5ae9f0bd6e41bd$exports.isFinished = $3f5ae9f0bd6e41bd$var$isFinished;
var $62ec216b20960491$exports = {};
/*!
 * ee-first
 * Copyright(c) 2014 Jonathan Ong
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $62ec216b20960491$exports = $62ec216b20960491$var$first;
/**
 * Get the first event in a set of event emitters and event pairs.
 *
 * @param {array} stuff
 * @param {function} done
 * @public
 */ function $62ec216b20960491$var$first(stuff, done) {
  if (!Array.isArray(stuff))
    throw new TypeError('arg must be an array of [ee, events...] arrays');
  var cleanups = [];
  for (var i = 0; i < stuff.length; i++) {
    var arr = stuff[i];
    if (!Array.isArray(arr) || arr.length < 2)
      throw new TypeError('each array member must be [ee, events...]');
    var ee = arr[0];
    for (var j = 1; j < arr.length; j++) {
      var event = arr[j];
      var fn = $62ec216b20960491$var$listener(event, callback);
      // listen to the event
      ee.on(event, fn);
      // push this listener to the list of cleanups
      cleanups.push({
        ee: ee,
        event: event,
        fn: fn,
      });
    }
  }
  function callback() {
    cleanup();
    done.apply(null, arguments);
  }
  function cleanup() {
    var x;
    for (var i = 0; i < cleanups.length; i++) {
      x = cleanups[i];
      x.ee.removeListener(x.event, x.fn);
    }
  }
  function thunk(fn) {
    done = fn;
  }
  thunk.cancel = cleanup;
  return thunk;
}
/**
 * Create the event listener.
 * @private
 */ function $62ec216b20960491$var$listener(event, done) {
  return function onevent(arg1) {
    var args = new Array(arguments.length);
    var ee = this;
    var err = event === 'error' ? arg1 : null;
    // copy args to prevent arguments escaping scope
    for (var i = 0; i < args.length; i++) args[i] = arguments[i];
    done(err, ee, event, args);
  };
}

/**
 * Variables.
 * @private
 */ /* istanbul ignore next */ var $3f5ae9f0bd6e41bd$var$defer =
  typeof setImmediate === 'function'
    ? setImmediate
    : function (fn) {
        process.nextTick(fn.bind.apply(fn, arguments));
      };
/**
 * Invoke callback when the response has finished, useful for
 * cleaning up resources afterwards.
 *
 * @param {object} msg
 * @param {function} listener
 * @return {object}
 * @public
 */ function $3f5ae9f0bd6e41bd$var$onFinished(msg, listener) {
  if ($3f5ae9f0bd6e41bd$var$isFinished(msg) !== false) {
    $3f5ae9f0bd6e41bd$var$defer(listener, null, msg);
    return msg;
  }
  // attach the listener to the message
  $3f5ae9f0bd6e41bd$var$attachListener(msg, listener);
  return msg;
}
/**
 * Determine if message is already finished.
 *
 * @param {object} msg
 * @return {boolean}
 * @public
 */ function $3f5ae9f0bd6e41bd$var$isFinished(msg) {
  var socket = msg.socket;
  if (typeof msg.finished === 'boolean')
    // OutgoingMessage
    return Boolean(msg.finished || (socket && !socket.writable));
  if (typeof msg.complete === 'boolean')
    // IncomingMessage
    return Boolean(
      msg.upgrade ||
        !socket ||
        !socket.readable ||
        (msg.complete && !msg.readable),
    );
  // don't know
  return undefined;
}
/**
 * Attach a finished listener to the message.
 *
 * @param {object} msg
 * @param {function} callback
 * @private
 */ function $3f5ae9f0bd6e41bd$var$attachFinishedListener(msg, callback) {
  var eeMsg;
  var eeSocket;
  var finished = false;
  function onFinish(error) {
    eeMsg.cancel();
    eeSocket.cancel();
    finished = true;
    callback(error);
  }
  // finished on first message event
  eeMsg = eeSocket = $62ec216b20960491$exports(
    [[msg, 'end', 'finish']],
    onFinish,
  );
  function onSocket(socket) {
    // remove listener
    msg.removeListener('socket', onSocket);
    if (finished) return;
    if (eeMsg !== eeSocket) return;
    // finished on first socket event
    eeSocket = $62ec216b20960491$exports(
      [[socket, 'error', 'close']],
      onFinish,
    );
  }
  if (msg.socket) {
    // socket already assigned
    onSocket(msg.socket);
    return;
  }
  // wait for socket to be assigned
  msg.on('socket', onSocket);
  if (msg.socket === undefined)
    // node.js 0.8 patch
    $3f5ae9f0bd6e41bd$var$patchAssignSocket(msg, onSocket);
}
/**
 * Attach the listener to the message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */ function $3f5ae9f0bd6e41bd$var$attachListener(msg, listener) {
  var attached = msg.__onFinished;
  // create a private single listener with queue
  if (!attached || !attached.queue) {
    attached = msg.__onFinished = $3f5ae9f0bd6e41bd$var$createListener(msg);
    $3f5ae9f0bd6e41bd$var$attachFinishedListener(msg, attached);
  }
  attached.queue.push(listener);
}
/**
 * Create listener on message.
 *
 * @param {object} msg
 * @return {function}
 * @private
 */ function $3f5ae9f0bd6e41bd$var$createListener(msg) {
  function listener(err) {
    if (msg.__onFinished === listener) msg.__onFinished = null;
    if (!listener.queue) return;
    var queue = listener.queue;
    listener.queue = null;
    for (var i = 0; i < queue.length; i++) queue[i](err, msg);
  }
  listener.queue = [];
  return listener;
}
/**
 * Patch ServerResponse.prototype.assignSocket for node.js 0.8.
 *
 * @param {ServerResponse} res
 * @param {function} callback
 * @private
 */ function $3f5ae9f0bd6e41bd$var$patchAssignSocket(res, callback) {
  var assignSocket = res.assignSocket;
  if (typeof assignSocket !== 'function') return;
  // res.on('socket', callback) is broken in 0.8
  res.assignSocket = function _assignSocket(socket) {
    assignSocket.call(this, socket);
    callback(socket);
  };
}

var $cc01e0e703290bbc$exports = {};
/*!
 * parseurl
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2017 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');

var $cc01e0e703290bbc$var$parse = $dmXIQ$url.parse;
var $cc01e0e703290bbc$var$Url = $dmXIQ$url.Url;
/**
 * Module exports.
 * @public
 */ $cc01e0e703290bbc$exports = $cc01e0e703290bbc$var$parseurl;
$cc01e0e703290bbc$exports.original = $cc01e0e703290bbc$var$originalurl;
/**
 * Parse the `req` url with memoization.
 *
 * @param {ServerRequest} req
 * @return {Object}
 * @public
 */ function $cc01e0e703290bbc$var$parseurl(req) {
  var url = req.url;
  if (url === undefined)
    // URL is undefined
    return undefined;
  var parsed = req._parsedUrl;
  if ($cc01e0e703290bbc$var$fresh(url, parsed))
    // Return cached URL parse
    return parsed;
  // Parse the URL
  parsed = $cc01e0e703290bbc$var$fastparse(url);
  parsed._raw = url;
  return (req._parsedUrl = parsed);
}
/**
 * Parse the `req` original url with fallback and memoization.
 *
 * @param {ServerRequest} req
 * @return {Object}
 * @public
 */ function $cc01e0e703290bbc$var$originalurl(req) {
  var url = req.originalUrl;
  if (typeof url !== 'string')
    // Fallback
    return $cc01e0e703290bbc$var$parseurl(req);
  var parsed = req._parsedOriginalUrl;
  if ($cc01e0e703290bbc$var$fresh(url, parsed))
    // Return cached URL parse
    return parsed;
  // Parse the URL
  parsed = $cc01e0e703290bbc$var$fastparse(url);
  parsed._raw = url;
  return (req._parsedOriginalUrl = parsed);
}
/**
 * Parse the `str` url with fast-path short-cut.
 *
 * @param {string} str
 * @return {Object}
 * @private
 */ function $cc01e0e703290bbc$var$fastparse(str) {
  if (typeof str !== 'string' || str.charCodeAt(0) !== 0x2f /* / */)
    return $cc01e0e703290bbc$var$parse(str);
  var pathname = str;
  var query = null;
  var search = null;
  // This takes the regexp from https://github.com/joyent/node/pull/7878
  // Which is /^(\/[^?#\s]*)(\?[^#\s]*)?$/
  // And unrolls it into a for loop
  for (var i = 1; i < str.length; i++)
    switch (str.charCodeAt(i)) {
      case 0x3f:
        /* ?  */ if (search === null) {
          pathname = str.substring(0, i);
          query = str.substring(i + 1);
          search = str.substring(i);
        }
        break;
      case 0x09:
      /* \t */ case 0x0a:
      /* \n */ case 0x0c:
      /* \f */ case 0x0d:
      /* \r */ case 0x20:
      /*    */ case 0x23:
      /* #  */ case 0xa0:
      case 0xfeff:
        return $cc01e0e703290bbc$var$parse(str);
    }
  var url =
    $cc01e0e703290bbc$var$Url !== undefined
      ? new $cc01e0e703290bbc$var$Url()
      : {};
  url.path = str;
  url.href = str;
  url.pathname = pathname;
  if (search !== null) {
    url.query = query;
    url.search = search;
  }
  return url;
}
/**
 * Determine if parsed is still fresh for url.
 *
 * @param {string} url
 * @param {object} parsedUrl
 * @return {boolean}
 * @private
 */ function $cc01e0e703290bbc$var$fresh(url, parsedUrl) {
  return (
    typeof parsedUrl === 'object' &&
    parsedUrl !== null &&
    ($cc01e0e703290bbc$var$Url === undefined ||
      parsedUrl instanceof $cc01e0e703290bbc$var$Url) &&
    parsedUrl._raw === url
  );
}

var $fddbe4da692edb4a$exports = {};
/*!
 * statuses
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2016 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
var $d0ec57c142c661db$exports = {};
$d0ec57c142c661db$exports = JSON.parse(
  '{"100":"Continue","101":"Switching Protocols","102":"Processing","103":"Early Hints","200":"OK","201":"Created","202":"Accepted","203":"Non-Authoritative Information","204":"No Content","205":"Reset Content","206":"Partial Content","207":"Multi-Status","208":"Already Reported","226":"IM Used","300":"Multiple Choices","301":"Moved Permanently","302":"Found","303":"See Other","304":"Not Modified","305":"Use Proxy","306":"(Unused)","307":"Temporary Redirect","308":"Permanent Redirect","400":"Bad Request","401":"Unauthorized","402":"Payment Required","403":"Forbidden","404":"Not Found","405":"Method Not Allowed","406":"Not Acceptable","407":"Proxy Authentication Required","408":"Request Timeout","409":"Conflict","410":"Gone","411":"Length Required","412":"Precondition Failed","413":"Payload Too Large","414":"URI Too Long","415":"Unsupported Media Type","416":"Range Not Satisfiable","417":"Expectation Failed","418":"I\'m a teapot","421":"Misdirected Request","422":"Unprocessable Entity","423":"Locked","424":"Failed Dependency","425":"Unordered Collection","426":"Upgrade Required","428":"Precondition Required","429":"Too Many Requests","431":"Request Header Fields Too Large","451":"Unavailable For Legal Reasons","500":"Internal Server Error","501":"Not Implemented","502":"Bad Gateway","503":"Service Unavailable","504":"Gateway Timeout","505":"HTTP Version Not Supported","506":"Variant Also Negotiates","507":"Insufficient Storage","508":"Loop Detected","509":"Bandwidth Limit Exceeded","510":"Not Extended","511":"Network Authentication Required"}',
);

/**
 * Module exports.
 * @public
 */ $fddbe4da692edb4a$exports = $fddbe4da692edb4a$var$status;
// status code to message map
$fddbe4da692edb4a$var$status.STATUS_CODES = $d0ec57c142c661db$exports;
// array of status codes
$fddbe4da692edb4a$var$status.codes = $fddbe4da692edb4a$var$populateStatusesMap(
  $fddbe4da692edb4a$var$status,
  $d0ec57c142c661db$exports,
);
// status codes for redirects
$fddbe4da692edb4a$var$status.redirect = {
  300: true,
  301: true,
  302: true,
  303: true,
  305: true,
  307: true,
  308: true,
};
// status codes for empty bodies
$fddbe4da692edb4a$var$status.empty = {
  204: true,
  205: true,
  304: true,
};
// status codes for when you should retry the request
$fddbe4da692edb4a$var$status.retry = {
  502: true,
  503: true,
  504: true,
};
/**
 * Populate the statuses map for given codes.
 * @private
 */ function $fddbe4da692edb4a$var$populateStatusesMap(statuses, codes) {
  var arr = [];
  Object.keys(codes).forEach(function forEachCode(code) {
    var message = codes[code];
    var status = Number(code);
    // Populate properties
    statuses[status] = message;
    statuses[message] = status;
    statuses[message.toLowerCase()] = status;
    // Add to array
    arr.push(status);
  });
  return arr;
}
/**
 * Get the status code.
 *
 * Given a number, this will throw if it is not a known status
 * code, otherwise the code will be returned. Given a string,
 * the string will be parsed for a number and return the code
 * if valid, otherwise will lookup the code assuming this is
 * the status message.
 *
 * @param {string|number} code
 * @returns {number}
 * @public
 */ function $fddbe4da692edb4a$var$status(code) {
  if (typeof code === 'number') {
    if (!$fddbe4da692edb4a$var$status[code])
      throw new Error('invalid status code: ' + code);
    return code;
  }
  if (typeof code !== 'string')
    throw new TypeError('code must be a number or string');
  // '403'
  var n = parseInt(code, 10);
  if (!isNaN(n)) {
    if (!$fddbe4da692edb4a$var$status[n])
      throw new Error('invalid status code: ' + n);
    return n;
  }
  n = $fddbe4da692edb4a$var$status[code.toLowerCase()];
  if (!n) throw new Error('invalid status message: "' + code + '"');
  return n;
}

var $3677d106dad067db$exports = {};
/*!
 * unpipe
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $3677d106dad067db$exports = $3677d106dad067db$var$unpipe;
/**
 * Determine if there are Node.js pipe-like data listeners.
 * @private
 */ function $3677d106dad067db$var$hasPipeDataListeners(stream) {
  var listeners = stream.listeners('data');
  for (var i = 0; i < listeners.length; i++) {
    if (listeners[i].name === 'ondata') return true;
  }
  return false;
}
/**
 * Unpipe a stream from all destinations.
 *
 * @param {object} stream
 * @public
 */ function $3677d106dad067db$var$unpipe(stream) {
  if (!stream) throw new TypeError('argument stream is required');
  if (typeof stream.unpipe === 'function') {
    // new-style
    stream.unpipe();
    return;
  }
  // Node.js 0.8 hack
  if (!$3677d106dad067db$var$hasPipeDataListeners(stream)) return;
  var listener;
  var listeners = stream.listeners('close');
  for (var i = 0; i < listeners.length; i++) {
    listener = listeners[i];
    if (listener.name !== 'cleanup' && listener.name !== 'onclose') continue;
    // invoke the listener
    listener.call(stream);
  }
}

/**
 * Module variables.
 * @private
 */ var $1101d1d62d4ad7c9$var$DOUBLE_SPACE_REGEXP = /\x20{2}/g;
var $1101d1d62d4ad7c9$var$NEWLINE_REGEXP = /\n/g;
/* istanbul ignore next */ var $1101d1d62d4ad7c9$var$defer =
  typeof setImmediate === 'function'
    ? setImmediate
    : function (fn) {
        process.nextTick(fn.bind.apply(fn, arguments));
      };
var $1101d1d62d4ad7c9$var$isFinished = $3f5ae9f0bd6e41bd$exports.isFinished;
/**
 * Create a minimal HTML document.
 *
 * @param {string} message
 * @private
 */ function $1101d1d62d4ad7c9$var$createHtmlDocument(message) {
  var body = $e016d48dad325d91$exports(message)
    .replace($1101d1d62d4ad7c9$var$NEWLINE_REGEXP, '<br>')
    .replace($1101d1d62d4ad7c9$var$DOUBLE_SPACE_REGEXP, ' &nbsp;');
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>' +
    body +
    '</pre>\n' +
    '</body>\n' +
    '</html>\n'
  );
}
/**
 * Module exports.
 * @public
 */ $1101d1d62d4ad7c9$exports = $1101d1d62d4ad7c9$var$finalhandler;
/**
 * Create a function to handle the final response.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {Object} [options]
 * @return {Function}
 * @public
 */ function $1101d1d62d4ad7c9$var$finalhandler(req, res, options) {
  var opts = options || {};
  // get environment
  var env = opts.env || process.env.NODE_ENV || 'development';
  // get error callback
  var onerror = opts.onerror;
  return function (err) {
    var headers;
    var msg;
    var status;
    // ignore 404 on in-flight response
    if (!err && $1101d1d62d4ad7c9$var$headersSent(res)) {
      $1101d1d62d4ad7c9$var$debug('cannot 404 after headers sent');
      return;
    }
    // unhandled error
    if (err) {
      // respect status code from error
      status = $1101d1d62d4ad7c9$var$getErrorStatusCode(err);
      if (status === undefined)
        // fallback to status code on response
        status = $1101d1d62d4ad7c9$var$getResponseStatusCode(res);
      // respect headers from error
      else headers = $1101d1d62d4ad7c9$var$getErrorHeaders(err);
      // get error message
      msg = $1101d1d62d4ad7c9$var$getErrorMessage(err, status, env);
    } else {
      // not found
      status = 404;
      msg =
        'Cannot ' +
        req.method +
        ' ' +
        $18ab92dd362e3405$exports($1101d1d62d4ad7c9$var$getResourceName(req));
    }
    $1101d1d62d4ad7c9$var$debug('default %s', status);
    // schedule onerror callback
    if (err && onerror) $1101d1d62d4ad7c9$var$defer(onerror, err, req, res);
    // cannot actually respond
    if ($1101d1d62d4ad7c9$var$headersSent(res)) {
      $1101d1d62d4ad7c9$var$debug('cannot %d after headers sent', status);
      req.socket.destroy();
      return;
    }
    // send response
    $1101d1d62d4ad7c9$var$send(req, res, status, headers, msg);
  };
}
/**
 * Get headers from Error object.
 *
 * @param {Error} err
 * @return {object}
 * @private
 */ function $1101d1d62d4ad7c9$var$getErrorHeaders(err) {
  if (!err.headers || typeof err.headers !== 'object') return undefined;
  var headers = Object.create(null);
  var keys = Object.keys(err.headers);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    headers[key] = err.headers[key];
  }
  return headers;
}
/**
 * Get message from Error object, fallback to status message.
 *
 * @param {Error} err
 * @param {number} status
 * @param {string} env
 * @return {string}
 * @private
 */ function $1101d1d62d4ad7c9$var$getErrorMessage(err, status, env) {
  var msg;
  if (env !== 'production') {
    // use err.stack, which typically includes err.message
    msg = err.stack;
    // fallback to err.toString() when possible
    if (!msg && typeof err.toString === 'function') msg = err.toString();
  }
  return msg || $fddbe4da692edb4a$exports[status];
}
/**
 * Get status code from Error object.
 *
 * @param {Error} err
 * @return {number}
 * @private
 */ function $1101d1d62d4ad7c9$var$getErrorStatusCode(err) {
  // check err.status
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 600)
    return err.status;
  // check err.statusCode
  if (
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 600
  )
    return err.statusCode;
  return undefined;
}
/**
 * Get resource name for the request.
 *
 * This is typically just the original pathname of the request
 * but will fallback to "resource" is that cannot be determined.
 *
 * @param {IncomingMessage} req
 * @return {string}
 * @private
 */ function $1101d1d62d4ad7c9$var$getResourceName(req) {
  try {
    return $cc01e0e703290bbc$exports.original(req).pathname;
  } catch (e) {
    return 'resource';
  }
}
/**
 * Get status code from response.
 *
 * @param {OutgoingMessage} res
 * @return {number}
 * @private
 */ function $1101d1d62d4ad7c9$var$getResponseStatusCode(res) {
  var status = res.statusCode;
  // default status code to 500 if outside valid range
  if (typeof status !== 'number' || status < 400 || status > 599) status = 500;
  return status;
}
/**
 * Determine if the response headers have been sent.
 *
 * @param {object} res
 * @returns {boolean}
 * @private
 */ function $1101d1d62d4ad7c9$var$headersSent(res) {
  return typeof res.headersSent !== 'boolean'
    ? Boolean(res._header)
    : res.headersSent;
}
/**
 * Send response.
 *
 * @param {IncomingMessage} req
 * @param {OutgoingMessage} res
 * @param {number} status
 * @param {object} headers
 * @param {string} message
 * @private
 */ function $1101d1d62d4ad7c9$var$send(req, res, status, headers, message) {
  function write() {
    // response body
    var body = $1101d1d62d4ad7c9$var$createHtmlDocument(message);
    // response status
    res.statusCode = status;
    res.statusMessage = $fddbe4da692edb4a$exports[status];
    // response headers
    $1101d1d62d4ad7c9$var$setHeaders(res, headers);
    // security headers
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // standard headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body, 'utf8');
  }
  if ($1101d1d62d4ad7c9$var$isFinished(req)) {
    write();
    return;
  }
  // unpipe everything from the request
  $3677d106dad067db$exports(req);
  // flush the request
  $3f5ae9f0bd6e41bd$exports(req, write);
  req.resume();
}
/**
 * Set response headers from an object.
 *
 * @param {OutgoingMessage} res
 * @param {object} headers
 * @private
 */ function $1101d1d62d4ad7c9$var$setHeaders(res, headers) {
  if (!headers) return;
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    res.setHeader(key, headers[key]);
  }
}

var $im7pL = parcelRequire('im7pL');

/**
 * Module exports.
 * @public
 */ $c969ebc216babcb0$exports = $c969ebc216babcb0$var$createServer;
/**
 * Module variables.
 * @private
 */ var $c969ebc216babcb0$var$env = process.env.NODE_ENV || 'development';
var $c969ebc216babcb0$var$proto = {};
/* istanbul ignore next */ var $c969ebc216babcb0$var$defer =
  typeof setImmediate === 'function'
    ? setImmediate
    : function (fn) {
        process.nextTick(fn.bind.apply(fn, arguments));
      };
/**
 * Create a new connect server.
 *
 * @return {function}
 * @public
 */ function $c969ebc216babcb0$var$createServer() {
  function app(req, res, next) {
    app.handle(req, res, next);
  }
  $im7pL(app, $c969ebc216babcb0$var$proto);
  $im7pL(app, $c969ebc216babcb0$require$EventEmitter.prototype);
  app.route = '/';
  app.stack = [];
  return app;
}
/**
 * Utilize the given middleware `handle` to the given `route`,
 * defaulting to _/_. This "route" is the mount-point for the
 * middleware, when given a value other than _/_ the middleware
 * is only effective when that segment is present in the request's
 * pathname.
 *
 * For example if we were to mount a function at _/admin_, it would
 * be invoked on _/admin_, and _/admin/settings_, however it would
 * not be invoked for _/_, or _/posts_.
 *
 * @param {String|Function|Server} route, callback or server
 * @param {Function|Server} callback or server
 * @return {Server} for chaining
 * @public
 */ $c969ebc216babcb0$var$proto.use = function use(route, fn) {
  var handle = fn;
  var path = route;
  // default route to '/'
  if (typeof route !== 'string') {
    handle = route;
    path = '/';
  }
  // wrap sub-apps
  if (typeof handle.handle === 'function') {
    var server = handle;
    server.route = path;
    handle = function (req, res, next) {
      server.handle(req, res, next);
    };
  }
  // wrap vanilla http.Servers
  if (handle instanceof $dmXIQ$http.Server)
    handle = handle.listeners('request')[0];
  // strip trailing slash
  if (path[path.length - 1] === '/') path = path.slice(0, -1);
  // add the middleware
  $c969ebc216babcb0$var$debug(
    'use %s %s',
    path || '/',
    handle.name || 'anonymous',
  );
  this.stack.push({
    route: path,
    handle: handle,
  });
  return this;
};
/**
 * Handle server requests, punting them down
 * the middleware stack.
 *
 * @private
 */ $c969ebc216babcb0$var$proto.handle = function handle(req, res, out) {
  var index = 0;
  var protohost = $c969ebc216babcb0$var$getProtohost(req.url) || '';
  var removed = '';
  var slashAdded = false;
  var stack = this.stack;
  // final function handler
  var done =
    out ||
    $1101d1d62d4ad7c9$exports(req, res, {
      env: $c969ebc216babcb0$var$env,
      onerror: $c969ebc216babcb0$var$logerror,
    });
  // store the original URL
  req.originalUrl = req.originalUrl || req.url;
  function next(err) {
    if (slashAdded) {
      req.url = req.url.substr(1);
      slashAdded = false;
    }
    if (removed.length !== 0) {
      req.url = protohost + removed + req.url.substr(protohost.length);
      removed = '';
    }
    // next callback
    var layer = stack[index++];
    // all done
    if (!layer) {
      $c969ebc216babcb0$var$defer(done, err);
      return;
    }
    // route data
    var path = $cc01e0e703290bbc$exports(req).pathname || '/';
    var route = layer.route;
    // skip this layer if the route doesn't match
    if (path.toLowerCase().substr(0, route.length) !== route.toLowerCase())
      return next(err);
    // skip if route match does not border "/", ".", or end
    var c = path.length > route.length && path[route.length];
    if (c && c !== '/' && c !== '.') return next(err);
    // trim off the part of the url that matches the route
    if (route.length !== 0 && route !== '/') {
      removed = route;
      req.url = protohost + req.url.substr(protohost.length + removed.length);
      // ensure leading slash
      if (!protohost && req.url[0] !== '/') {
        req.url = '/' + req.url;
        slashAdded = true;
      }
    }
    // call the layer handle
    $c969ebc216babcb0$var$call(layer.handle, route, err, req, res, next);
  }
  next();
};
/**
 * Listen for connections.
 *
 * This method takes the same arguments
 * as node's `http.Server#listen()`.
 *
 * HTTP and HTTPS:
 *
 * If you run your application both as HTTP
 * and HTTPS you may wrap them individually,
 * since your Connect "server" is really just
 * a JavaScript `Function`.
 *
 *      var connect = require('connect')
 *        , http = require('http')
 *        , https = require('https');
 *
 *      var app = connect();
 *
 *      http.createServer(app).listen(80);
 *      https.createServer(options, app).listen(443);
 *
 * @return {http.Server}
 * @api public
 */ $c969ebc216babcb0$var$proto.listen = function listen() {
  var server = $dmXIQ$http.createServer(this);
  return server.listen.apply(server, arguments);
};
/**
 * Invoke a route handle.
 * @private
 */ function $c969ebc216babcb0$var$call(handle, route, err, req, res, next) {
  var arity = handle.length;
  var error = err;
  var hasError = Boolean(err);
  $c969ebc216babcb0$var$debug(
    '%s %s : %s',
    handle.name || '<anonymous>',
    route,
    req.originalUrl,
  );
  try {
    if (hasError && arity === 4) {
      // error-handling middleware
      handle(err, req, res, next);
      return;
    } else if (!hasError && arity < 4) {
      // request-handling middleware
      handle(req, res, next);
      return;
    }
  } catch (e) {
    // replace the error
    error = e;
  }
  // continue
  next(error);
}
/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */ function $c969ebc216babcb0$var$logerror(err) {
  if ($c969ebc216babcb0$var$env !== 'test')
    console.error(err.stack || err.toString());
}
/**
 * Get get protocol + host for a URL.
 *
 * @param {string} url
 * @private
 */ function $c969ebc216babcb0$var$getProtohost(url) {
  if (url.length === 0 || url[0] === '/') return undefined;
  var fqdnIndex = url.indexOf('://');
  return fqdnIndex !== -1 && url.lastIndexOf('?', fqdnIndex) === -1
    ? url.substr(0, url.indexOf('/', 3 + fqdnIndex))
    : undefined;
}

var $116f4e94d746e22c$exports = {};
// Native

var $116f4e94d746e22c$require$promisify = $dmXIQ$util.promisify;

var $116f4e94d746e22c$require$createHash = $dmXIQ$crypto.createHash;

var $116f4e94d746e22c$require$realpath = $dmXIQ$fs.realpath;
var $116f4e94d746e22c$require$lstat = $dmXIQ$fs.lstat;
var $116f4e94d746e22c$require$createReadStream = $dmXIQ$fs.createReadStream;
var $116f4e94d746e22c$require$readdir = $dmXIQ$fs.readdir;
var $098e6ad56edac974$exports = {};
('use strict');
/*
Copyright (c) 2014 Petka Antonov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/ function $098e6ad56edac974$var$Url() {
  //For more efficient internal representation and laziness.
  //The non-underscore versions of these properties are accessor functions
  //defined on the prototype.
  this._protocol = null;
  this._href = '';
  this._port = -1;
  this._query = null;
  this.auth = null;
  this.slashes = null;
  this.host = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.pathname = null;
  this._prependSlash = false;
}

$098e6ad56edac974$var$Url.queryString = $dmXIQ$querystring;
$098e6ad56edac974$var$Url.prototype.parse = function Url$parse(
  str,
  parseQueryString,
  hostDenotesSlash,
  disableAutoEscapeChars,
) {
  if (typeof str !== 'string')
    throw new TypeError("Parameter 'url' must be a string, not " + typeof str);
  var start = 0;
  var end = str.length - 1;
  //Trim leading and trailing ws
  while (str.charCodeAt(start) <= 0x20 /*' '*/) start++;
  while (str.charCodeAt(end) <= 0x20 /*' '*/) end--;
  start = this._parseProtocol(str, start, end);
  //Javascript doesn't have host
  if (this._protocol !== 'javascript') {
    start = this._parseHost(str, start, end, hostDenotesSlash);
    var proto = this._protocol;
    if (
      !this.hostname &&
      (this.slashes || (proto && !$098e6ad56edac974$var$slashProtocols[proto]))
    )
      this.hostname = this.host = '';
  }
  if (start <= end) {
    var ch = str.charCodeAt(start);
    if (ch === 0x2f /*'/'*/ || ch === 0x5c /*'\'*/)
      this._parsePath(str, start, end, disableAutoEscapeChars);
    else if (ch === 0x3f /*'?'*/)
      this._parseQuery(str, start, end, disableAutoEscapeChars);
    else if (ch === 0x23 /*'#'*/)
      this._parseHash(str, start, end, disableAutoEscapeChars);
    else if (this._protocol !== 'javascript')
      this._parsePath(str, start, end, disableAutoEscapeChars);
    else this.pathname = str.slice(start, end + 1);
  }
  if (!this.pathname && this.hostname && this._slashProtocols[this._protocol])
    this.pathname = '/';
  if (parseQueryString) {
    var search = this.search;
    if (search == null) search = this.search = '';
    if (search.charCodeAt(0) === 0x3f /*'?'*/) search = search.slice(1);
    //This calls a setter function, there is no .query data property
    this.query = $098e6ad56edac974$var$Url.queryString.parse(search);
  }
};
$098e6ad56edac974$var$Url.prototype.resolve = function Url$resolve(relative) {
  return this.resolveObject(
    $098e6ad56edac974$var$Url.parse(relative, false, true),
  ).format();
};
$098e6ad56edac974$var$Url.prototype.format = function Url$format() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }
  var protocol = this.protocol || '';
  var pathname = this.pathname || '';
  var hash = this.hash || '';
  var search = this.search || '';
  var query = '';
  var hostname = this.hostname || '';
  var port = this.port || '';
  var host = false;
  var scheme = '';
  //Cache the result of the getter function
  var q = this.query;
  if (q && typeof q === 'object')
    query = $098e6ad56edac974$var$Url.queryString.stringify(q);
  if (!search) search = query ? '?' + query : '';
  if (protocol && protocol.charCodeAt(protocol.length - 1) !== 0x3a /*':'*/)
    protocol += ':';
  if (this.host) host = auth + this.host;
  else if (hostname) {
    var ip6 = hostname.indexOf(':') > -1;
    if (ip6) hostname = '[' + hostname + ']';
    host = auth + hostname + (port ? ':' + port : '');
  }
  var slashes =
    this.slashes ||
    ((!protocol || $098e6ad56edac974$var$slashProtocols[protocol]) &&
      host !== false);
  if (protocol) scheme = protocol + (slashes ? '//' : '');
  else if (slashes) scheme = '//';
  if (slashes && pathname && pathname.charCodeAt(0) !== 0x2f /*'/'*/)
    pathname = '/' + pathname;
  if (search && search.charCodeAt(0) !== 0x3f /*'?'*/) search = '?' + search;
  if (hash && hash.charCodeAt(0) !== 0x23 /*'#'*/) hash = '#' + hash;
  pathname = $098e6ad56edac974$var$escapePathName(pathname);
  search = $098e6ad56edac974$var$escapeSearch(search);
  return scheme + (host === false ? '' : host) + pathname + search + hash;
};
$098e6ad56edac974$var$Url.prototype.resolveObject = function Url$resolveObject(
  relative,
) {
  if (typeof relative === 'string')
    relative = $098e6ad56edac974$var$Url.parse(relative, false, true);
  var result = this._clone();
  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;
  // if the relative url is empty, then there"s nothing left to do here.
  if (!relative.href) {
    result._href = '';
    return result;
  }
  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative._protocol) {
    relative._copyPropsTo(result, true);
    if (
      $098e6ad56edac974$var$slashProtocols[result._protocol] &&
      result.hostname &&
      !result.pathname
    )
      result.pathname = '/';
    result._href = '';
    return result;
  }
  if (relative._protocol && relative._protocol !== result._protocol) {
    // if it"s a known url protocol, then changing
    // the protocol does weird things
    // first, if it"s not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that"s known to be hostless.
    // anything else is assumed to be absolute.
    if (!$098e6ad56edac974$var$slashProtocols[relative._protocol]) {
      relative._copyPropsTo(result, false);
      result._href = '';
      return result;
    }
    result._protocol = relative._protocol;
    if (!relative.host && relative._protocol !== 'javascript') {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else result.pathname = relative.pathname;
    result.search = relative.search;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result._port = relative._port;
    result.slashes = result.slashes || relative.slashes;
    result._href = '';
    return result;
  }
  var isSourceAbs =
    result.pathname && result.pathname.charCodeAt(0) === 0x2f; /*'/'*/
  var isRelAbs =
    relative.host ||
    (relative.pathname && relative.pathname.charCodeAt(0) === 0x2f); /*'/'*/
  var mustEndAbs =
    isRelAbs || isSourceAbs || (result.host && relative.pathname);
  var removeAllDots = mustEndAbs;
  var srcPath = (result.pathname && result.pathname.split('/')) || [];
  var relPath = (relative.pathname && relative.pathname.split('/')) || [];
  var psychotic =
    result._protocol && !$098e6ad56edac974$var$slashProtocols[result._protocol];
  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result._port = -1;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative._protocol) {
      relative.hostname = '';
      relative._port = -1;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = '';
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }
  if (isRelAbs) {
    // it"s absolute.
    result.host = relative.host ? relative.host : result.host;
    result.hostname = relative.hostname ? relative.hostname : result.hostname;
    result.search = relative.search;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it"s relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
  } else if (relative.search) {
    // just pull out the search.
    // like href="?foo".
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especialy happens in cases like
      //url.resolveObject("mailto:local1@domain1", "local2@domain2")
      var authInHost =
        result.host && result.host.indexOf('@') > 0
          ? result.host.split('@')
          : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result._href = '';
    return result;
  }
  if (!srcPath.length) {
    // no path at all.  easy.
    // we"ve already handled the other stuff above.
    result.pathname = null;
    result._href = '';
    return result;
  }
  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash =
    ((result.host || relative.host) && (last === '.' || last === '..')) ||
    last === '';
  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last === '.') srcPath.splice(i, 1);
    else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }
  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) for (; up--; up) srcPath.unshift('..');
  if (
    mustEndAbs &&
    srcPath[0] !== '' &&
    (!srcPath[0] || srcPath[0].charCodeAt(0) !== 0x2f) /*'/'*/
  )
    srcPath.unshift('');
  if (hasTrailingSlash && srcPath.join('/').substr(-1) !== '/')
    srcPath.push('');
  var isAbsolute =
    srcPath[0] === '' ||
    (srcPath[0] && srcPath[0].charCodeAt(0) === 0x2f); /*'/'*/
  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute
      ? ''
      : srcPath.length
      ? srcPath.shift()
      : '';
    //occationaly the auth can get stuck only in host
    //this especialy happens in cases like
    //url.resolveObject("mailto:local1@domain1", "local2@domain2")
    var authInHost =
      result.host && result.host.indexOf('@') > 0
        ? result.host.split('@')
        : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }
  mustEndAbs = mustEndAbs || (result.host && srcPath.length);
  if (mustEndAbs && !isAbsolute) srcPath.unshift('');
  result.pathname = srcPath.length === 0 ? null : srcPath.join('/');
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result._href = '';
  return result;
};

$098e6ad56edac974$var$Url.prototype._hostIdna = function Url$_hostIdna(
  hostname,
) {
  // IDNA Support: Returns a punycoded representation of "domain".
  // It only converts parts of the domain name that
  // have non-ASCII characters, i.e. it doesn't matter if
  // you call it with a domain that already is ASCII-only.
  return $dmXIQ$punycode.toASCII(hostname);
};
var $098e6ad56edac974$var$escapePathName =
  ($098e6ad56edac974$var$Url.prototype._escapePathName =
    function Url$_escapePathName(pathname) {
      if (
        !$098e6ad56edac974$var$containsCharacter2(
          pathname,
          0x23 /*'#'*/,
          0x3f /*'?'*/,
        )
      )
        return pathname;
      //Avoid closure creation to keep this inlinable
      return $098e6ad56edac974$var$_escapePath(pathname);
    });
var $098e6ad56edac974$var$escapeSearch =
  ($098e6ad56edac974$var$Url.prototype._escapeSearch =
    function Url$_escapeSearch(search) {
      if (!$098e6ad56edac974$var$containsCharacter2(search, 0x23 /*'#'*/, -1))
        return search;
      //Avoid closure creation to keep this inlinable
      return $098e6ad56edac974$var$_escapeSearch(search);
    });
$098e6ad56edac974$var$Url.prototype._parseProtocol =
  function Url$_parseProtocol(str, start, end) {
    var doLowerCase = false;
    var protocolCharacters = this._protocolCharacters;
    for (var i = start; i <= end; ++i) {
      var ch = str.charCodeAt(i);
      if (ch === 0x3a /*':'*/) {
        var protocol = str.slice(start, i);
        if (doLowerCase) protocol = protocol.toLowerCase();
        this._protocol = protocol;
        return i + 1;
      } else if (protocolCharacters[ch] === 1) {
        if (ch < 0x61 /*'a'*/) doLowerCase = true;
      } else return start;
    }
    return start;
  };
$098e6ad56edac974$var$Url.prototype._parseAuth = function Url$_parseAuth(
  str,
  start,
  end,
  decode,
) {
  var auth = str.slice(start, end + 1);
  if (decode) auth = decodeURIComponent(auth);
  this.auth = auth;
};
$098e6ad56edac974$var$Url.prototype._parsePort = function Url$_parsePort(
  str,
  start,
  end,
) {
  //Internal format is integer for more efficient parsing
  //and for efficient trimming of leading zeros
  var port = 0;
  //Distinguish between :0 and : (no port number at all)
  var hadChars = false;
  var validPort = true;
  for (var i = start; i <= end; ++i) {
    var ch = str.charCodeAt(i);
    if (0x30 /*'0'*/ <= ch && ch <= 0x39 /*'9'*/) {
      port = 10 * port + (ch - 0x30) /*'0'*/;
      hadChars = true;
    } else {
      validPort = false;
      if (ch === 0x5c /*'\'*/ || ch === 0x2f /*'/'*/) validPort = true;
      break;
    }
  }
  if ((port === 0 && !hadChars) || !validPort) {
    if (!validPort) this._port = -2;
    return 0;
  }
  this._port = port;
  return i - start;
};
$098e6ad56edac974$var$Url.prototype._parseHost = function Url$_parseHost(
  str,
  start,
  end,
  slashesDenoteHost,
) {
  var hostEndingCharacters = this._hostEndingCharacters;
  var first = str.charCodeAt(start);
  var second = str.charCodeAt(start + 1);
  if (
    (first === 0x2f /*'/'*/ || first === 0x5c) /*'\'*/ &&
    (second === 0x2f /*'/'*/ || second === 0x5c) /*'\'*/
  ) {
    this.slashes = true;
    //The string starts with //
    if (start === 0) {
      //The string is just "//"
      if (end < 2) return start;
      //If slashes do not denote host and there is no auth,
      //there is no host when the string starts with //
      var hasAuth = $098e6ad56edac974$var$containsCharacter(
        str,
        0x40 /*'@'*/,
        2,
        hostEndingCharacters,
      );
      if (!hasAuth && !slashesDenoteHost) {
        this.slashes = null;
        return start;
      }
    }
    //There is a host that starts after the //
    start += 2;
  } else if (
    !this._protocol || //2. there was a protocol that requires slashes
    //e.g. in 'http:asd' 'asd' is not a hostname
    $098e6ad56edac974$var$slashProtocols[this._protocol]
  )
    return start;
  var doLowerCase = false;
  var idna = false;
  var hostNameStart = start;
  var hostNameEnd = end;
  var lastCh = -1;
  var portLength = 0;
  var charsAfterDot = 0;
  var authNeedsDecoding = false;
  var j = -1;
  //Find the last occurrence of an @-sign until hostending character is met
  //also mark if decoding is needed for the auth portion
  for (var i = start; i <= end; ++i) {
    var ch = str.charCodeAt(i);
    if (ch === 0x40 /*'@'*/) j = i;
    else if (ch === 0x25 /*'%'*/) authNeedsDecoding = true;
    else if (hostEndingCharacters[ch] === 1) break;
  }
  //@-sign was found at index j, everything to the left from it
  //is auth part
  if (j > -1) {
    this._parseAuth(str, start, j - 1, authNeedsDecoding);
    //hostname starts after the last @-sign
    start = hostNameStart = j + 1;
  }
  //Host name is starting with a [
  if (str.charCodeAt(start) === 0x5b /*'['*/) {
    for (var i = start + 1; i <= end; ++i) {
      var ch = str.charCodeAt(i);
      //Assume valid IP6 is between the brackets
      if (ch === 0x5d /*']'*/) {
        if (str.charCodeAt(i + 1) === 0x3a /*':'*/)
          portLength = this._parsePort(str, i + 2, end) + 1;
        var hostname = str.slice(start + 1, i).toLowerCase();
        this.hostname = hostname;
        this.host =
          this._port > 0
            ? '[' + hostname + ']:' + this._port
            : '[' + hostname + ']';
        this.pathname = '/';
        return i + portLength + 1;
      }
    }
    //Empty hostname, [ starts a path
    return start;
  }
  for (var i = start; i <= end; ++i) {
    if (charsAfterDot > 62) {
      this.hostname = this.host = str.slice(start, i);
      return i;
    }
    var ch = str.charCodeAt(i);
    if (ch === 0x3a /*':'*/) {
      portLength = this._parsePort(str, i + 1, end) + 1;
      hostNameEnd = i - 1;
      break;
    } else if (ch < 0x61 /*'a'*/) {
      if (ch === 0x2e /*'.'*/)
        //Node.js ignores this error
        /*
                if (lastCh === DOT || lastCh === -1) {
                    this.hostname = this.host = "";
                    return start;
                }
                */ charsAfterDot = -1;
      else if (0x41 /*'A'*/ <= ch && ch <= 0x5a /*'Z'*/) doLowerCase = true;
      else if (
        !(
          (
            ch === 0x2d /*'-'*/ ||
            ch === 0x5f /*'_'*/ ||
            ch === 0x2b /*'+'*/ ||
            (0x30 /*'0'*/ <= ch && ch <= 0x39)
          ) /*'9'*/
        )
      ) {
        if (
          hostEndingCharacters[ch] === 0 &&
          this._noPrependSlashHostEnders[ch] === 0
        )
          this._prependSlash = true;
        hostNameEnd = i - 1;
        break;
      }
    } else if (ch >= 0x7b /*'{'*/) {
      if (ch <= 0x7e /*'~'*/) {
        if (this._noPrependSlashHostEnders[ch] === 0) this._prependSlash = true;
        hostNameEnd = i - 1;
        break;
      }
      idna = true;
    }
    lastCh = ch;
    charsAfterDot++;
  }
  //Node.js ignores this error
  /*
    if (lastCh === DOT) {
        hostNameEnd--;
    }
    */ if (hostNameEnd + 1 !== start && hostNameEnd - hostNameStart <= 256) {
    var hostname = str.slice(hostNameStart, hostNameEnd + 1);
    if (doLowerCase) hostname = hostname.toLowerCase();
    if (idna) hostname = this._hostIdna(hostname);
    this.hostname = hostname;
    this.host = this._port > 0 ? hostname + ':' + this._port : hostname;
  }
  return hostNameEnd + 1 + portLength;
};
$098e6ad56edac974$var$Url.prototype._copyPropsTo = function Url$_copyPropsTo(
  input,
  noProtocol,
) {
  if (!noProtocol) input._protocol = this._protocol;
  input._href = this._href;
  input._port = this._port;
  input._prependSlash = this._prependSlash;
  input.auth = this.auth;
  input.slashes = this.slashes;
  input.host = this.host;
  input.hostname = this.hostname;
  input.hash = this.hash;
  input.search = this.search;
  input.pathname = this.pathname;
};
$098e6ad56edac974$var$Url.prototype._clone = function Url$_clone() {
  var ret = new $098e6ad56edac974$var$Url();
  ret._protocol = this._protocol;
  ret._href = this._href;
  ret._port = this._port;
  ret._prependSlash = this._prependSlash;
  ret.auth = this.auth;
  ret.slashes = this.slashes;
  ret.host = this.host;
  ret.hostname = this.hostname;
  ret.hash = this.hash;
  ret.search = this.search;
  ret.pathname = this.pathname;
  return ret;
};
$098e6ad56edac974$var$Url.prototype._getComponentEscaped =
  function Url$_getComponentEscaped(str, start, end, isAfterQuery) {
    var cur = start;
    var i = start;
    var ret = '';
    var autoEscapeMap = isAfterQuery
      ? this._afterQueryAutoEscapeMap
      : this._autoEscapeMap;
    for (; i <= end; ++i) {
      var ch = str.charCodeAt(i);
      var escaped = autoEscapeMap[ch];
      if (escaped !== '' && escaped !== undefined) {
        if (cur < i) ret += str.slice(cur, i);
        ret += escaped;
        cur = i + 1;
      }
    }
    if (cur < i + 1) ret += str.slice(cur, i);
    return ret;
  };
$098e6ad56edac974$var$Url.prototype._parsePath = function Url$_parsePath(
  str,
  start,
  end,
  disableAutoEscapeChars,
) {
  var pathStart = start;
  var pathEnd = end;
  var escape1 = false;
  var autoEscapeCharacters = this._autoEscapeCharacters;
  var prePath = this._port === -2 ? '/:' : '';
  for (var i = start; i <= end; ++i) {
    var ch = str.charCodeAt(i);
    if (ch === 0x23 /*'#'*/) {
      this._parseHash(str, i, end, disableAutoEscapeChars);
      pathEnd = i - 1;
      break;
    } else if (ch === 0x3f /*'?'*/) {
      this._parseQuery(str, i, end, disableAutoEscapeChars);
      pathEnd = i - 1;
      break;
    } else if (
      !disableAutoEscapeChars &&
      !escape1 &&
      autoEscapeCharacters[ch] === 1
    )
      escape1 = true;
  }
  if (pathStart > pathEnd) {
    this.pathname = prePath === '' ? '/' : prePath;
    return;
  }
  var path;
  if (escape1) path = this._getComponentEscaped(str, pathStart, pathEnd, false);
  else path = str.slice(pathStart, pathEnd + 1);
  this.pathname =
    prePath === '' ? (this._prependSlash ? '/' + path : path) : prePath + path;
};
$098e6ad56edac974$var$Url.prototype._parseQuery = function Url$_parseQuery(
  str,
  start,
  end,
  disableAutoEscapeChars,
) {
  var queryStart = start;
  var queryEnd = end;
  var escape1 = false;
  var autoEscapeCharacters = this._autoEscapeCharacters;
  for (var i = start; i <= end; ++i) {
    var ch = str.charCodeAt(i);
    if (ch === 0x23 /*'#'*/) {
      this._parseHash(str, i, end, disableAutoEscapeChars);
      queryEnd = i - 1;
      break;
    } else if (
      !disableAutoEscapeChars &&
      !escape1 &&
      autoEscapeCharacters[ch] === 1
    )
      escape1 = true;
  }
  if (queryStart > queryEnd) {
    this.search = '';
    return;
  }
  var query;
  if (escape1)
    query = this._getComponentEscaped(str, queryStart, queryEnd, true);
  else query = str.slice(queryStart, queryEnd + 1);
  this.search = query;
};
$098e6ad56edac974$var$Url.prototype._parseHash = function Url$_parseHash(
  str,
  start,
  end,
  disableAutoEscapeChars,
) {
  if (start > end) {
    this.hash = '';
    return;
  }
  this.hash = disableAutoEscapeChars
    ? str.slice(start, end + 1)
    : this._getComponentEscaped(str, start, end, true);
};
Object.defineProperty($098e6ad56edac974$var$Url.prototype, 'port', {
  get: function () {
    if (this._port >= 0) return '' + this._port;
    return null;
  },
  set: function (v) {
    if (v == null) this._port = -1;
    else this._port = parseInt(v, 10);
  },
});
Object.defineProperty($098e6ad56edac974$var$Url.prototype, 'query', {
  get: function () {
    var query = this._query;
    if (query != null) return query;
    var search = this.search;
    if (search) {
      if (search.charCodeAt(0) === 0x3f /*'?'*/) search = search.slice(1);
      if (search !== '') {
        this._query = search;
        return search;
      }
    }
    return search;
  },
  set: function (v) {
    this._query = v;
  },
});
Object.defineProperty($098e6ad56edac974$var$Url.prototype, 'path', {
  get: function () {
    var p = this.pathname || '';
    var s = this.search || '';
    if (p || s) return p + s;
    return p == null && s ? '/' + s : null;
  },
  set: function () {},
});
Object.defineProperty($098e6ad56edac974$var$Url.prototype, 'protocol', {
  get: function () {
    var proto = this._protocol;
    return proto ? proto + ':' : proto;
  },
  set: function (v) {
    if (typeof v === 'string') {
      var end = v.length - 1;
      if (v.charCodeAt(end) === 0x3a /*':'*/) this._protocol = v.slice(0, end);
      else this._protocol = v;
    } else if (v == null) this._protocol = null;
  },
});
Object.defineProperty($098e6ad56edac974$var$Url.prototype, 'href', {
  get: function () {
    var href = this._href;
    if (!href) href = this._href = this.format();
    return href;
  },
  set: function (v) {
    this._href = v;
  },
});
$098e6ad56edac974$var$Url.parse = function Url$Parse(
  str,
  parseQueryString,
  hostDenotesSlash,
  disableAutoEscapeChars,
) {
  if (str instanceof $098e6ad56edac974$var$Url) return str;
  var ret = new $098e6ad56edac974$var$Url();
  ret.parse(
    str,
    !!parseQueryString,
    !!hostDenotesSlash,
    !!disableAutoEscapeChars,
  );
  return ret;
};
$098e6ad56edac974$var$Url.format = function Url$Format(obj) {
  if (typeof obj === 'string') obj = $098e6ad56edac974$var$Url.parse(obj);
  if (!(obj instanceof $098e6ad56edac974$var$Url))
    return $098e6ad56edac974$var$Url.prototype.format.call(obj);
  return obj.format();
};
$098e6ad56edac974$var$Url.resolve = function Url$Resolve(source, relative) {
  return $098e6ad56edac974$var$Url.parse(source, false, true).resolve(relative);
};
$098e6ad56edac974$var$Url.resolveObject = function Url$ResolveObject(
  source,
  relative,
) {
  if (!source) return relative;
  return $098e6ad56edac974$var$Url
    .parse(source, false, true)
    .resolveObject(relative);
};
function $098e6ad56edac974$var$_escapePath(pathname) {
  return pathname.replace(/[?#]/g, function (match) {
    return encodeURIComponent(match);
  });
}
function $098e6ad56edac974$var$_escapeSearch(search) {
  return search.replace(/#/g, function (match) {
    return encodeURIComponent(match);
  });
}
//Search `char1` (integer code for a character) in `string`
//starting from `fromIndex` and ending at `string.length - 1`
//or when a stop character is found
function $098e6ad56edac974$var$containsCharacter(
  string,
  char1,
  fromIndex,
  stopCharacterTable,
) {
  var len = string.length;
  for (var i = fromIndex; i < len; ++i) {
    var ch = string.charCodeAt(i);
    if (ch === char1) return true;
    else if (stopCharacterTable[ch] === 1) return false;
  }
  return false;
}
//See if `char1` or `char2` (integer codes for characters)
//is contained in `string`
function $098e6ad56edac974$var$containsCharacter2(string, char1, char2) {
  for (var i = 0, len = string.length; i < len; ++i) {
    var ch = string.charCodeAt(i);
    if (ch === char1 || ch === char2) return true;
  }
  return false;
}
//Makes an array of 128 uint8's which represent boolean values.
//Spec is an array of ascii code points or ascii code point ranges
//ranges are expressed as [start, end]
//Create a table with the characters 0x30-0x39 (decimals '0' - '9') and
//0x7A (lowercaseletter 'z') as `true`:
//
//var a = makeAsciiTable([[0x30, 0x39], 0x7A]);
//a[0x30]; //1
//a[0x15]; //0
//a[0x35]; //1
function $098e6ad56edac974$var$makeAsciiTable(spec) {
  var ret = new Uint8Array(128);
  spec.forEach(function (item) {
    if (typeof item === 'number') ret[item] = 1;
    else {
      var start = item[0];
      var end = item[1];
      for (var j = start; j <= end; ++j) ret[j] = 1;
    }
  });
  return ret;
}
var $098e6ad56edac974$var$autoEscape = [
  '<',
  '>',
  '"',
  '`',
  ' ',
  '\r',
  '\n',
  '	',
  '{',
  '}',
  '|',
  '\\',
  '^',
  '`',
  "'",
];
var $098e6ad56edac974$var$autoEscapeMap = new Array(128);
for (
  var $098e6ad56edac974$var$i = 0,
    $098e6ad56edac974$var$len = $098e6ad56edac974$var$autoEscapeMap.length;
  $098e6ad56edac974$var$i < $098e6ad56edac974$var$len;
  ++$098e6ad56edac974$var$i
)
  $098e6ad56edac974$var$autoEscapeMap[$098e6ad56edac974$var$i] = '';
for (
  var $098e6ad56edac974$var$i = 0,
    $098e6ad56edac974$var$len = $098e6ad56edac974$var$autoEscape.length;
  $098e6ad56edac974$var$i < $098e6ad56edac974$var$len;
  ++$098e6ad56edac974$var$i
) {
  var $098e6ad56edac974$var$c =
    $098e6ad56edac974$var$autoEscape[$098e6ad56edac974$var$i];
  var $098e6ad56edac974$var$esc = encodeURIComponent($098e6ad56edac974$var$c);
  if ($098e6ad56edac974$var$esc === $098e6ad56edac974$var$c)
    $098e6ad56edac974$var$esc = escape($098e6ad56edac974$var$c);
  $098e6ad56edac974$var$autoEscapeMap[$098e6ad56edac974$var$c.charCodeAt(0)] =
    $098e6ad56edac974$var$esc;
}
var $098e6ad56edac974$var$afterQueryAutoEscapeMap =
  $098e6ad56edac974$var$autoEscapeMap.slice();
$098e6ad56edac974$var$autoEscapeMap[0x5c /*'\'*/] = '/';
var $098e6ad56edac974$var$slashProtocols =
  ($098e6ad56edac974$var$Url.prototype._slashProtocols = {
    http: true,
    https: true,
    gopher: true,
    file: true,
    ftp: true,
    'http:': true,
    'https:': true,
    'gopher:': true,
    'file:': true,
    'ftp:': true,
  });
//Optimize back from normalized object caused by non-identifier keys
function $098e6ad56edac974$var$f() {}
$098e6ad56edac974$var$f.prototype = $098e6ad56edac974$var$slashProtocols;
$098e6ad56edac974$var$Url.prototype._protocolCharacters =
  $098e6ad56edac974$var$makeAsciiTable([
    [0x61 /*'a'*/, 0x7a /*'z'*/],
    [0x41 /*'A'*/, 0x5a /*'Z'*/],
    0x2e /*'.'*/,
    0x2b /*'+'*/,
    0x2d /*'-'*/,
  ]);
$098e6ad56edac974$var$Url.prototype._hostEndingCharacters =
  $098e6ad56edac974$var$makeAsciiTable([
    0x23 /*'#'*/, 0x3f /*'?'*/, 0x2f /*'/'*/, 0x5c /*'\'*/,
  ]);
$098e6ad56edac974$var$Url.prototype._autoEscapeCharacters =
  $098e6ad56edac974$var$makeAsciiTable(
    $098e6ad56edac974$var$autoEscape.map(function (v) {
      return v.charCodeAt(0);
    }),
  );
//If these characters end a host name, the path will not be prepended a /
$098e6ad56edac974$var$Url.prototype._noPrependSlashHostEnders =
  $098e6ad56edac974$var$makeAsciiTable(
    [
      '<',
      '>',
      "'",
      '`',
      ' ',
      '\r',
      '\n',
      '	',
      '{',
      '}',
      '|',
      '^',
      '`',
      '"',
      '%',
      ';',
    ].map(function (v) {
      return v.charCodeAt(0);
    }),
  );
$098e6ad56edac974$var$Url.prototype._autoEscapeMap =
  $098e6ad56edac974$var$autoEscapeMap;
$098e6ad56edac974$var$Url.prototype._afterQueryAutoEscapeMap =
  $098e6ad56edac974$var$afterQueryAutoEscapeMap;
$098e6ad56edac974$exports = $098e6ad56edac974$var$Url;
$098e6ad56edac974$var$Url.replace = function Url$Replace() {
  undefined.url = {
    exports: $098e6ad56edac974$var$Url,
  };
};

var $2d40ff1219c6261c$exports = {};
/* ! The MIT License (MIT) Copyright (c) 2014 Scott Corgan */ // This is adopted from https://github.com/scottcorgan/glob-slash/

const $2d40ff1219c6261c$var$normalize = value =>
  $dmXIQ$path.posix.normalize($dmXIQ$path.posix.join('/', value));
$2d40ff1219c6261c$exports = value =>
  value.charAt(0) === '!'
    ? `!${$2d40ff1219c6261c$var$normalize(value.substr(1))}`
    : $2d40ff1219c6261c$var$normalize(value);
$2d40ff1219c6261c$exports.normalize = $2d40ff1219c6261c$var$normalize;

var $d847e1b1c07f9415$exports = {};
$d847e1b1c07f9415$exports = $d847e1b1c07f9415$var$minimatch;
$d847e1b1c07f9415$var$minimatch.Minimatch = $d847e1b1c07f9415$var$Minimatch;
var $d847e1b1c07f9415$var$path = {
  sep: '/',
};

try {
  $d847e1b1c07f9415$var$path = $d847e1b1c07f9415$import$a18827f26064f067;
} catch (er) {}
var $d847e1b1c07f9415$var$GLOBSTAR =
  ($d847e1b1c07f9415$var$minimatch.GLOBSTAR =
  $d847e1b1c07f9415$var$Minimatch.GLOBSTAR =
    {});
var $aadf421a95691281$exports = {};
var $c01286cb6db1c827$exports = {};
$c01286cb6db1c827$exports = function (xs, fn) {
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    var x = fn(xs[i], i);
    if ($c01286cb6db1c827$var$isArray(x)) res.push.apply(res, x);
    else res.push(x);
  }
  return res;
};
var $c01286cb6db1c827$var$isArray =
  Array.isArray ||
  function (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
  };

var $fb542fd8d25b749f$exports = {};
('use strict');
$fb542fd8d25b749f$exports = $fb542fd8d25b749f$var$balanced;
function $fb542fd8d25b749f$var$balanced(a, b, str) {
  if (a instanceof RegExp) a = $fb542fd8d25b749f$var$maybeMatch(a, str);
  if (b instanceof RegExp) b = $fb542fd8d25b749f$var$maybeMatch(b, str);
  var r = $fb542fd8d25b749f$var$range(a, b, str);
  return (
    r && {
      start: r[0],
      end: r[1],
      pre: str.slice(0, r[0]),
      body: str.slice(r[0] + a.length, r[1]),
      post: str.slice(r[1] + b.length),
    }
  );
}
function $fb542fd8d25b749f$var$maybeMatch(reg, str) {
  var m = str.match(reg);
  return m ? m[0] : null;
}
$fb542fd8d25b749f$var$balanced.range = $fb542fd8d25b749f$var$range;
function $fb542fd8d25b749f$var$range(a, b, str) {
  var begs, beg, left, right, result;
  var ai = str.indexOf(a);
  var bi = str.indexOf(b, ai + 1);
  var i = ai;
  if (ai >= 0 && bi > 0) {
    begs = [];
    left = str.length;
    while (i >= 0 && !result) {
      if (i == ai) {
        begs.push(i);
        ai = str.indexOf(a, i + 1);
      } else if (begs.length == 1) result = [begs.pop(), bi];
      else {
        beg = begs.pop();
        if (beg < left) {
          left = beg;
          right = bi;
        }
        bi = str.indexOf(b, i + 1);
      }
      i = ai < bi && ai >= 0 ? ai : bi;
    }
    if (begs.length) result = [left, right];
  }
  return result;
}

$aadf421a95691281$exports = $aadf421a95691281$var$expandTop;
var $aadf421a95691281$var$escSlash = '\0SLASH' + Math.random() + '\0';
var $aadf421a95691281$var$escOpen = '\0OPEN' + Math.random() + '\0';
var $aadf421a95691281$var$escClose = '\0CLOSE' + Math.random() + '\0';
var $aadf421a95691281$var$escComma = '\0COMMA' + Math.random() + '\0';
var $aadf421a95691281$var$escPeriod = '\0PERIOD' + Math.random() + '\0';
function $aadf421a95691281$var$numeric(str) {
  return parseInt(str, 10) == str ? parseInt(str, 10) : str.charCodeAt(0);
}
function $aadf421a95691281$var$escapeBraces(str) {
  return str
    .split('\\\\')
    .join($aadf421a95691281$var$escSlash)
    .split('\\{')
    .join($aadf421a95691281$var$escOpen)
    .split('\\}')
    .join($aadf421a95691281$var$escClose)
    .split('\\,')
    .join($aadf421a95691281$var$escComma)
    .split('\\.')
    .join($aadf421a95691281$var$escPeriod);
}
function $aadf421a95691281$var$unescapeBraces(str) {
  return str
    .split($aadf421a95691281$var$escSlash)
    .join('\\')
    .split($aadf421a95691281$var$escOpen)
    .join('{')
    .split($aadf421a95691281$var$escClose)
    .join('}')
    .split($aadf421a95691281$var$escComma)
    .join(',')
    .split($aadf421a95691281$var$escPeriod)
    .join('.');
}
// Basically just str.split(","), but handling cases
// where we have nested braced sections, which should be
// treated as individual members, like {a,{b,c},d}
function $aadf421a95691281$var$parseCommaParts(str) {
  if (!str) return [''];
  var parts = [];
  var m = $fb542fd8d25b749f$exports('{', '}', str);
  if (!m) return str.split(',');
  var pre = m.pre;
  var body = m.body;
  var post = m.post;
  var p = pre.split(',');
  p[p.length - 1] += '{' + body + '}';
  var postParts = $aadf421a95691281$var$parseCommaParts(post);
  if (post.length) {
    p[p.length - 1] += postParts.shift();
    p.push.apply(p, postParts);
  }
  parts.push.apply(parts, p);
  return parts;
}
function $aadf421a95691281$var$expandTop(str) {
  if (!str) return [];
  // I don't know why Bash 4.3 does this, but it does.
  // Anything starting with {} will have the first two bytes preserved
  // but *only* at the top level, so {},a}b will not expand to anything,
  // but a{},b}c will be expanded to [a}c,abc].
  // One could argue that this is a bug in Bash, but since the goal of
  // this module is to match Bash's rules, we escape a leading {}
  if (str.substr(0, 2) === '{}') str = '\\{\\}' + str.substr(2);
  return $aadf421a95691281$var$expand(
    $aadf421a95691281$var$escapeBraces(str),
    true,
  ).map($aadf421a95691281$var$unescapeBraces);
}
function $aadf421a95691281$var$identity(e) {
  return e;
}
function $aadf421a95691281$var$embrace(str) {
  return '{' + str + '}';
}
function $aadf421a95691281$var$isPadded(el) {
  return /^-?0\d/.test(el);
}
function $aadf421a95691281$var$lte(i, y) {
  return i <= y;
}
function $aadf421a95691281$var$gte(i, y) {
  return i >= y;
}
function $aadf421a95691281$var$expand(str, isTop) {
  var expansions = [];
  var m = $fb542fd8d25b749f$exports('{', '}', str);
  if (!m || /\$$/.test(m.pre)) return [str];
  var isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
  var isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
  var isSequence = isNumericSequence || isAlphaSequence;
  var isOptions = m.body.indexOf(',') >= 0;
  if (!isSequence && !isOptions) {
    // {a},b}
    if (m.post.match(/,.*\}/)) {
      str = m.pre + '{' + m.body + $aadf421a95691281$var$escClose + m.post;
      return $aadf421a95691281$var$expand(str);
    }
    return [str];
  }
  var n;
  if (isSequence) n = m.body.split(/\.\./);
  else {
    n = $aadf421a95691281$var$parseCommaParts(m.body);
    if (n.length === 1) {
      // x{{a,b}}y ==> x{a}y x{b}y
      n = $aadf421a95691281$var$expand(n[0], false).map(
        $aadf421a95691281$var$embrace,
      );
      if (n.length === 1) {
        var post = m.post.length
          ? $aadf421a95691281$var$expand(m.post, false)
          : [''];
        return post.map(function (p) {
          return m.pre + n[0] + p;
        });
      }
    }
  }
  // at this point, n is the parts, and we know it's not a comma set
  // with a single entry.
  // no need to expand pre, since it is guaranteed to be free of brace-sets
  var pre = m.pre;
  var post = m.post.length ? $aadf421a95691281$var$expand(m.post, false) : [''];
  var N;
  if (isSequence) {
    var x = $aadf421a95691281$var$numeric(n[0]);
    var y = $aadf421a95691281$var$numeric(n[1]);
    var width = Math.max(n[0].length, n[1].length);
    var incr =
      n.length == 3 ? Math.abs($aadf421a95691281$var$numeric(n[2])) : 1;
    var test = $aadf421a95691281$var$lte;
    var reverse = y < x;
    if (reverse) {
      incr *= -1;
      test = $aadf421a95691281$var$gte;
    }
    var pad = n.some($aadf421a95691281$var$isPadded);
    N = [];
    for (var i = x; test(i, y); i += incr) {
      var c;
      if (isAlphaSequence) {
        c = String.fromCharCode(i);
        if (c === '\\') c = '';
      } else {
        c = String(i);
        if (pad) {
          var need = width - c.length;
          if (need > 0) {
            var z = new Array(need + 1).join('0');
            if (i < 0) c = '-' + z + c.slice(1);
            else c = z + c;
          }
        }
      }
      N.push(c);
    }
  } else
    N = $c01286cb6db1c827$exports(n, function (el) {
      return $aadf421a95691281$var$expand(el, false);
    });
  for (var j = 0; j < N.length; j++)
    for (var k = 0; k < post.length; k++) {
      var expansion = pre + N[j] + post[k];
      if (!isTop || isSequence || expansion) expansions.push(expansion);
    }
  return expansions;
}

var $d847e1b1c07f9415$var$plTypes = {
  '!': {
    open: '(?:(?!(?:',
    close: '))[^/]*?)',
  },
  '?': {
    open: '(?:',
    close: ')?',
  },
  '+': {
    open: '(?:',
    close: ')+',
  },
  '*': {
    open: '(?:',
    close: ')*',
  },
  '@': {
    open: '(?:',
    close: ')',
  },
};
// any single thing other than /
// don't need to escape / when using new RegExp()
var $d847e1b1c07f9415$var$qmark = '[^/]';
// * => any number of characters
var $d847e1b1c07f9415$var$star = $d847e1b1c07f9415$var$qmark + '*?';
// ** when dots are allowed.  Anything goes, except .. and .
// not (^ or / followed by one or two dots followed by $ or /),
// followed by anything, any number of times.
var $d847e1b1c07f9415$var$twoStarDot =
  '(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?';
// not a ^ or / followed by a dot,
// followed by anything, any number of times.
var $d847e1b1c07f9415$var$twoStarNoDot = '(?:(?!(?:\\/|^)\\.).)*?';
// characters that need to be escaped in RegExp.
var $d847e1b1c07f9415$var$reSpecials =
  $d847e1b1c07f9415$var$charSet('().*{}+?[]^$\\!');
// "abc" -> { a:true, b:true, c:true }
function $d847e1b1c07f9415$var$charSet(s) {
  return s.split('').reduce(function (set, c) {
    set[c] = true;
    return set;
  }, {});
}
// normalizes slashes.
var $d847e1b1c07f9415$var$slashSplit = /\/+/;
$d847e1b1c07f9415$var$minimatch.filter = $d847e1b1c07f9415$var$filter;
function $d847e1b1c07f9415$var$filter(pattern, options) {
  options = options || {};
  return function (p, i, list) {
    return $d847e1b1c07f9415$var$minimatch(p, pattern, options);
  };
}
function $d847e1b1c07f9415$var$ext(a, b) {
  a = a || {};
  b = b || {};
  var t = {};
  Object.keys(b).forEach(function (k) {
    t[k] = b[k];
  });
  Object.keys(a).forEach(function (k) {
    t[k] = a[k];
  });
  return t;
}
$d847e1b1c07f9415$var$minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return $d847e1b1c07f9415$var$minimatch;
  var orig = $d847e1b1c07f9415$var$minimatch;
  var m = function minimatch(p, pattern, options) {
    return orig.minimatch(p, pattern, $d847e1b1c07f9415$var$ext(def, options));
  };
  m.Minimatch = function Minimatch(pattern, options) {
    return new orig.Minimatch(pattern, $d847e1b1c07f9415$var$ext(def, options));
  };
  return m;
};
$d847e1b1c07f9415$var$Minimatch.defaults = function (def) {
  if (!def || !Object.keys(def).length) return $d847e1b1c07f9415$var$Minimatch;
  return $d847e1b1c07f9415$var$minimatch.defaults(def).Minimatch;
};
function $d847e1b1c07f9415$var$minimatch(p, pattern, options) {
  if (typeof pattern !== 'string')
    throw new TypeError('glob pattern string required');
  if (!options) options = {};
  // shortcut: comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === '#') return false;
  // "" only matches ""
  if (pattern.trim() === '') return p === '';
  return new $d847e1b1c07f9415$var$Minimatch(pattern, options).match(p);
}
function $d847e1b1c07f9415$var$Minimatch(pattern, options) {
  if (!(this instanceof $d847e1b1c07f9415$var$Minimatch))
    return new $d847e1b1c07f9415$var$Minimatch(pattern, options);
  if (typeof pattern !== 'string')
    throw new TypeError('glob pattern string required');
  if (!options) options = {};
  pattern = pattern.trim();
  // windows support: need to use /, not \
  if ($d847e1b1c07f9415$var$path.sep !== '/')
    pattern = pattern.split($d847e1b1c07f9415$var$path.sep).join('/');
  this.options = options;
  this.set = [];
  this.pattern = pattern;
  this.regexp = null;
  this.negate = false;
  this.comment = false;
  this.empty = false;
  // make the set of regexps etc.
  this.make();
}
$d847e1b1c07f9415$var$Minimatch.prototype.debug = function () {};
$d847e1b1c07f9415$var$Minimatch.prototype.make = $d847e1b1c07f9415$var$make;
function $d847e1b1c07f9415$var$make() {
  // don't do it more than once.
  if (this._made) return;
  var pattern = this.pattern;
  var options = this.options;
  // empty patterns and comments match nothing.
  if (!options.nocomment && pattern.charAt(0) === '#') {
    this.comment = true;
    return;
  }
  if (!pattern) {
    this.empty = true;
    return;
  }
  // step 1: figure out negation, etc.
  this.parseNegate();
  // step 2: expand braces
  var set = (this.globSet = this.braceExpand());
  if (options.debug) this.debug = console.error;
  this.debug(this.pattern, set);
  // step 3: now we have a set, so turn each one into a series of path-portion
  // matching patterns.
  // These will be regexps, except in the case of "**", which is
  // set to the GLOBSTAR object for globstar behavior,
  // and will not contain any / characters
  set = this.globParts = set.map(function (s) {
    return s.split($d847e1b1c07f9415$var$slashSplit);
  });
  this.debug(this.pattern, set);
  // glob --> regexps
  set = set.map(function (s, si, set) {
    return s.map(this.parse, this);
  }, this);
  this.debug(this.pattern, set);
  // filter out everything that didn't compile properly.
  set = set.filter(function (s) {
    return s.indexOf(false) === -1;
  });
  this.debug(this.pattern, set);
  this.set = set;
}
$d847e1b1c07f9415$var$Minimatch.prototype.parseNegate =
  $d847e1b1c07f9415$var$parseNegate;
function $d847e1b1c07f9415$var$parseNegate() {
  var pattern = this.pattern;
  var negate = false;
  var options = this.options;
  var negateOffset = 0;
  if (options.nonegate) return;
  for (var i = 0, l = pattern.length; i < l && pattern.charAt(i) === '!'; i++) {
    negate = !negate;
    negateOffset++;
  }
  if (negateOffset) this.pattern = pattern.substr(negateOffset);
  this.negate = negate;
}
// Brace expansion:
// a{b,c}d -> abd acd
// a{b,}c -> abc ac
// a{0..3}d -> a0d a1d a2d a3d
// a{b,c{d,e}f}g -> abg acdfg acefg
// a{b,c}d{e,f}g -> abdeg acdeg abdeg abdfg
//
// Invalid sets are not expanded.
// a{2..}b -> a{2..}b
// a{b}c -> a{b}c
$d847e1b1c07f9415$var$minimatch.braceExpand = function (pattern, options) {
  return $d847e1b1c07f9415$var$braceExpand(pattern, options);
};
$d847e1b1c07f9415$var$Minimatch.prototype.braceExpand =
  $d847e1b1c07f9415$var$braceExpand;
function $d847e1b1c07f9415$var$braceExpand(pattern, options) {
  if (!options) {
    if (this instanceof $d847e1b1c07f9415$var$Minimatch) options = this.options;
    else options = {};
  }
  pattern = typeof pattern === 'undefined' ? this.pattern : pattern;
  if (typeof pattern === 'undefined') throw new TypeError('undefined pattern');
  if (options.nobrace || !pattern.match(/\{.*\}/))
    // shortcut. no need to expand.
    return [pattern];
  return $aadf421a95691281$exports(pattern);
}
// parse a component of the expanded set.
// At this point, no pattern may contain "/" in it
// so we're going to return a 2d array, where each entry is the full
// pattern, split on '/', and then turned into a regular expression.
// A regexp is made at the end which joins each array with an
// escaped /, and another full one which joins each regexp with |.
//
// Following the lead of Bash 4.1, note that "**" only has special meaning
// when it is the *only* thing in a path portion.  Otherwise, any series
// of * is equivalent to a single *.  Globstar behavior is enabled by
// default, and can be disabled by setting options.noglobstar.
$d847e1b1c07f9415$var$Minimatch.prototype.parse = $d847e1b1c07f9415$var$parse;
var $d847e1b1c07f9415$var$SUBPARSE = {};
function $d847e1b1c07f9415$var$parse(pattern, isSub) {
  if (pattern.length > 65536) throw new TypeError('pattern is too long');
  var options = this.options;
  // shortcuts
  if (!options.noglobstar && pattern === '**')
    return $d847e1b1c07f9415$var$GLOBSTAR;
  if (pattern === '') return '';
  var re = '';
  var hasMagic = !!options.nocase;
  var escaping = false;
  // ? => one single character
  var patternListStack = [];
  var negativeLists = [];
  var stateChar;
  var inClass = false;
  var reClassStart = -1;
  var classStart = -1;
  // . and .. never match anything that doesn't start with .,
  // even when options.dot is set.
  var patternStart =
    pattern.charAt(0) === '.'
      ? '' // anything
      : options.dot
      ? '(?!(?:^|\\/)\\.{1,2}(?:$|\\/))'
      : '(?!\\.)';
  var self = this;
  function clearStateChar() {
    if (stateChar) {
      // we had some state-tracking character
      // that wasn't consumed by this pass.
      switch (stateChar) {
        case '*':
          re += $d847e1b1c07f9415$var$star;
          hasMagic = true;
          break;
        case '?':
          re += $d847e1b1c07f9415$var$qmark;
          hasMagic = true;
          break;
        default:
          re += '\\' + stateChar;
          break;
      }
      self.debug('clearStateChar %j %j', stateChar, re);
      stateChar = false;
    }
  }
  for (
    var i = 0, len = pattern.length, c;
    i < len && (c = pattern.charAt(i));
    i++
  ) {
    this.debug('%s	%s %s %j', pattern, i, re, c);
    // skip over any that are escaped.
    if (escaping && $d847e1b1c07f9415$var$reSpecials[c]) {
      re += '\\' + c;
      escaping = false;
      continue;
    }
    switch (c) {
      case '/':
        // completely not allowed, even escaped.
        // Should already be path-split by now.
        return false;
      case '\\':
        clearStateChar();
        escaping = true;
        continue;
      // the various stateChar values
      // for the "extglob" stuff.
      case '?':
      case '*':
      case '+':
      case '@':
      case '!':
        this.debug('%s	%s %s %j <-- stateChar', pattern, i, re, c);
        // all of those are literals inside a class, except that
        // the glob [!a] means [^a] in regexp
        if (inClass) {
          this.debug('  in class');
          if (c === '!' && i === classStart + 1) c = '^';
          re += c;
          continue;
        }
        // if we already have a stateChar, then it means
        // that there was something like ** or +? in there.
        // Handle the stateChar, then proceed with this one.
        self.debug('call clearStateChar %j', stateChar);
        clearStateChar();
        stateChar = c;
        // if extglob is disabled, then +(asdf|foo) isn't a thing.
        // just clear the statechar *now*, rather than even diving into
        // the patternList stuff.
        if (options.noext) clearStateChar();
        continue;
      case '(':
        if (inClass) {
          re += '(';
          continue;
        }
        if (!stateChar) {
          re += '\\(';
          continue;
        }
        patternListStack.push({
          type: stateChar,
          start: i - 1,
          reStart: re.length,
          open: $d847e1b1c07f9415$var$plTypes[stateChar].open,
          close: $d847e1b1c07f9415$var$plTypes[stateChar].close,
        });
        // negation is (?:(?!js)[^/]*)
        re += stateChar === '!' ? '(?:(?!(?:' : '(?:';
        this.debug('plType %j %j', stateChar, re);
        stateChar = false;
        continue;
      case ')':
        if (inClass || !patternListStack.length) {
          re += '\\)';
          continue;
        }
        clearStateChar();
        hasMagic = true;
        var pl = patternListStack.pop();
        // negation is (?:(?!js)[^/]*)
        // The others are (?:<pattern>)<type>
        re += pl.close;
        if (pl.type === '!') negativeLists.push(pl);
        pl.reEnd = re.length;
        continue;
      case '|':
        if (inClass || !patternListStack.length || escaping) {
          re += '\\|';
          escaping = false;
          continue;
        }
        clearStateChar();
        re += '|';
        continue;
      // these are mostly the same in regexp and glob
      case '[':
        // swallow any state-tracking char before the [
        clearStateChar();
        if (inClass) {
          re += '\\' + c;
          continue;
        }
        inClass = true;
        classStart = i;
        reClassStart = re.length;
        re += c;
        continue;
      case ']':
        //  a right bracket shall lose its special
        //  meaning and represent itself in
        //  a bracket expression if it occurs
        //  first in the list.  -- POSIX.2 2.8.3.2
        if (i === classStart + 1 || !inClass) {
          re += '\\' + c;
          escaping = false;
          continue;
        }
        // handle the case where we left a class open.
        // "[z-a]" is valid, equivalent to "\[z-a\]"
        if (inClass) {
          // split where the last [ was, make sure we don't have
          // an invalid re. if so, re-walk the contents of the
          // would-be class to re-translate any characters that
          // were passed through as-is
          // TODO: It would probably be faster to determine this
          // without a try/catch and a new RegExp, but it's tricky
          // to do safely.  For now, this is safe and works.
          var cs = pattern.substring(classStart + 1, i);
          try {
            RegExp('[' + cs + ']');
          } catch (er) {
            // not a valid class!
            var sp = this.parse(cs, $d847e1b1c07f9415$var$SUBPARSE);
            re = re.substr(0, reClassStart) + '\\[' + sp[0] + '\\]';
            hasMagic = hasMagic || sp[1];
            inClass = false;
            continue;
          }
        }
        // finish up the class.
        hasMagic = true;
        inClass = false;
        re += c;
        continue;
      default:
        // swallow any state char that wasn't consumed
        clearStateChar();
        if (escaping)
          // no need
          escaping = false;
        else if ($d847e1b1c07f9415$var$reSpecials[c] && !(c === '^' && inClass))
          re += '\\';
        re += c;
    } // switch
  } // for
  // handle the case where we left a class open.
  // "[abc" is valid, equivalent to "\[abc"
  if (inClass) {
    // split where the last [ was, and escape it
    // this is a huge pita.  We now have to re-walk
    // the contents of the would-be class to re-translate
    // any characters that were passed through as-is
    cs = pattern.substr(classStart + 1);
    sp = this.parse(cs, $d847e1b1c07f9415$var$SUBPARSE);
    re = re.substr(0, reClassStart) + '\\[' + sp[0];
    hasMagic = hasMagic || sp[1];
  }
  // handle the case where we had a +( thing at the *end*
  // of the pattern.
  // each pattern list stack adds 3 chars, and we need to go through
  // and escape any | chars that were passed through as-is for the regexp.
  // Go through and escape them, taking care not to double-escape any
  // | chars that were already escaped.
  for (pl = patternListStack.pop(); pl; pl = patternListStack.pop()) {
    var tail = re.slice(pl.reStart + pl.open.length);
    this.debug('setting tail', re, pl);
    // maybe some even number of \, then maybe 1 \, followed by a |
    tail = tail.replace(/((?:\\{2}){0,64})(\\?)\|/g, function (_, $1, $2) {
      if (!$2)
        // the | isn't already escaped, so escape it.
        $2 = '\\';
      // need to escape all those slashes *again*, without escaping the
      // one that we need for escaping the | character.  As it works out,
      // escaping an even number of slashes can be done by simply repeating
      // it exactly after itself.  That's why this trick works.
      //
      // I am sorry that you have to see this.
      return $1 + $1 + $2 + '|';
    });
    this.debug('tail=%j\n   %s', tail, tail, pl, re);
    var t =
      pl.type === '*'
        ? $d847e1b1c07f9415$var$star
        : pl.type === '?'
        ? $d847e1b1c07f9415$var$qmark
        : '\\' + pl.type;
    hasMagic = true;
    re = re.slice(0, pl.reStart) + t + '\\(' + tail;
  }
  // handle trailing things that only matter at the very end.
  clearStateChar();
  if (escaping)
    // trailing \\
    re += '\\\\';
  // only need to apply the nodot start if the re starts with
  // something that could conceivably capture a dot
  var addPatternStart = false;
  switch (re.charAt(0)) {
    case '.':
    case '[':
    case '(':
      addPatternStart = true;
  }
  // Hack to work around lack of negative lookbehind in JS
  // A pattern like: *.!(x).!(y|z) needs to ensure that a name
  // like 'a.xyz.yz' doesn't match.  So, the first negative
  // lookahead, has to look ALL the way ahead, to the end of
  // the pattern.
  for (var n = negativeLists.length - 1; n > -1; n--) {
    var nl = negativeLists[n];
    var nlBefore = re.slice(0, nl.reStart);
    var nlFirst = re.slice(nl.reStart, nl.reEnd - 8);
    var nlLast = re.slice(nl.reEnd - 8, nl.reEnd);
    var nlAfter = re.slice(nl.reEnd);
    nlLast += nlAfter;
    // Handle nested stuff like *(*.js|!(*.json)), where open parens
    // mean that we should *not* include the ) in the bit that is considered
    // "after" the negated section.
    var openParensBefore = nlBefore.split('(').length - 1;
    var cleanAfter = nlAfter;
    for (i = 0; i < openParensBefore; i++)
      cleanAfter = cleanAfter.replace(/\)[+*?]?/, '');
    nlAfter = cleanAfter;
    var dollar = '';
    if (nlAfter === '' && isSub !== $d847e1b1c07f9415$var$SUBPARSE)
      dollar = '$';
    var newRe = nlBefore + nlFirst + nlAfter + dollar + nlLast;
    re = newRe;
  }
  // if the re is not "" at this point, then we need to make sure
  // it doesn't match against an empty path part.
  // Otherwise a/* will match a/, which it should not.
  if (re !== '' && hasMagic) re = '(?=.)' + re;
  if (addPatternStart) re = patternStart + re;
  // parsing just a piece of a larger pattern.
  if (isSub === $d847e1b1c07f9415$var$SUBPARSE) return [re, hasMagic];
  // skip the regexp for non-magical patterns
  // unescape anything in it, though, so that it'll be
  // an exact match against a file etc.
  if (!hasMagic) return $d847e1b1c07f9415$var$globUnescape(pattern);
  var flags = options.nocase ? 'i' : '';
  try {
    var regExp = new RegExp('^' + re + '$', flags);
  } catch (er) {
    // If it was an invalid regular expression, then it can't match
    // anything.  This trick looks for a character after the end of
    // the string, which is of course impossible, except in multi-line
    // mode, but it's not a /m regex.
    return new RegExp('$.');
  }
  regExp._glob = pattern;
  regExp._src = re;
  return regExp;
}
$d847e1b1c07f9415$var$minimatch.makeRe = function (pattern, options) {
  return new $d847e1b1c07f9415$var$Minimatch(pattern, options || {}).makeRe();
};
$d847e1b1c07f9415$var$Minimatch.prototype.makeRe = $d847e1b1c07f9415$var$makeRe;
function $d847e1b1c07f9415$var$makeRe() {
  if (this.regexp || this.regexp === false) return this.regexp;
  // at this point, this.set is a 2d array of partial
  // pattern strings, or "**".
  //
  // It's better to use .match().  This function shouldn't
  // be used, really, but it's pretty convenient sometimes,
  // when you just want to work with a regex.
  var set = this.set;
  if (!set.length) {
    this.regexp = false;
    return this.regexp;
  }
  var options = this.options;
  var twoStar = options.noglobstar
    ? $d847e1b1c07f9415$var$star
    : options.dot
    ? $d847e1b1c07f9415$var$twoStarDot
    : $d847e1b1c07f9415$var$twoStarNoDot;
  var flags = options.nocase ? 'i' : '';
  var re = set
    .map(function (pattern) {
      return pattern
        .map(function (p) {
          return p === $d847e1b1c07f9415$var$GLOBSTAR
            ? twoStar
            : typeof p === 'string'
            ? $d847e1b1c07f9415$var$regExpEscape(p)
            : p._src;
        })
        .join('\\/');
    })
    .join('|');
  // must match entire pattern
  // ending in a * or ** will make it less strict.
  re = '^(?:' + re + ')$';
  // can match anything, as long as it's not this.
  if (this.negate) re = '^(?!' + re + ').*$';
  try {
    this.regexp = new RegExp(re, flags);
  } catch (ex) {
    this.regexp = false;
  }
  return this.regexp;
}
$d847e1b1c07f9415$var$minimatch.match = function (list, pattern, options) {
  options = options || {};
  var mm = new $d847e1b1c07f9415$var$Minimatch(pattern, options);
  list = list.filter(function (f) {
    return mm.match(f);
  });
  if (mm.options.nonull && !list.length) list.push(pattern);
  return list;
};
$d847e1b1c07f9415$var$Minimatch.prototype.match = $d847e1b1c07f9415$var$match;
function $d847e1b1c07f9415$var$match(f, partial) {
  this.debug('match', f, this.pattern);
  // short-circuit in the case of busted things.
  // comments, etc.
  if (this.comment) return false;
  if (this.empty) return f === '';
  if (f === '/' && partial) return true;
  var options = this.options;
  // windows: need to use /, not \
  if ($d847e1b1c07f9415$var$path.sep !== '/')
    f = f.split($d847e1b1c07f9415$var$path.sep).join('/');
  // treat the test path as a set of pathparts.
  f = f.split($d847e1b1c07f9415$var$slashSplit);
  this.debug(this.pattern, 'split', f);
  // just ONE of the pattern sets in this.set needs to match
  // in order for it to be valid.  If negating, then just one
  // match means that we have failed.
  // Either way, return on the first hit.
  var set = this.set;
  this.debug(this.pattern, 'set', set);
  // Find the basename of the path by looking for the last non-empty segment
  var filename;
  var i;
  for (i = f.length - 1; i >= 0; i--) {
    filename = f[i];
    if (filename) break;
  }
  for (i = 0; i < set.length; i++) {
    var pattern = set[i];
    var file = f;
    if (options.matchBase && pattern.length === 1) file = [filename];
    var hit = this.matchOne(file, pattern, partial);
    if (hit) {
      if (options.flipNegate) return true;
      return !this.negate;
    }
  }
  // didn't get any hits.  this is success if it's a negative
  // pattern, failure otherwise.
  if (options.flipNegate) return false;
  return this.negate;
}
// set partial to true to test if, for example,
// "/a/b" matches the start of "/*/b/*/d"
// Partial means, if you run out of file before you run
// out of pattern, then that's fine, as long as all
// the parts match.
$d847e1b1c07f9415$var$Minimatch.prototype.matchOne = function (
  file,
  pattern,
  partial,
) {
  var options = this.options;
  this.debug('matchOne', {
    this: this,
    file: file,
    pattern: pattern,
  });
  this.debug('matchOne', file.length, pattern.length);
  for (
    var fi = 0, pi = 0, fl = file.length, pl = pattern.length;
    fi < fl && pi < pl;
    fi++, pi++
  ) {
    this.debug('matchOne loop');
    var p = pattern[pi];
    var f = file[fi];
    this.debug(pattern, p, f);
    // should be impossible.
    // some invalid regexp stuff in the set.
    if (p === false) return false;
    if (p === $d847e1b1c07f9415$var$GLOBSTAR) {
      this.debug('GLOBSTAR', [pattern, p, f]);
      // "**"
      // a/**/b/**/c would match the following:
      // a/b/x/y/z/c
      // a/x/y/z/b/c
      // a/b/x/b/x/c
      // a/b/c
      // To do this, take the rest of the pattern after
      // the **, and see if it would match the file remainder.
      // If so, return success.
      // If not, the ** "swallows" a segment, and try again.
      // This is recursively awful.
      //
      // a/**/b/**/c matching a/b/x/y/z/c
      // - a matches a
      // - doublestar
      //   - matchOne(b/x/y/z/c, b/**/c)
      //     - b matches b
      //     - doublestar
      //       - matchOne(x/y/z/c, c) -> no
      //       - matchOne(y/z/c, c) -> no
      //       - matchOne(z/c, c) -> no
      //       - matchOne(c, c) yes, hit
      var fr = fi;
      var pr = pi + 1;
      if (pr === pl) {
        this.debug('** at the end');
        // a ** at the end will just swallow the rest.
        // We have found a match.
        // however, it will not swallow /.x, unless
        // options.dot is set.
        // . and .. are *never* matched by **, for explosively
        // exponential reasons.
        for (; fi < fl; fi++) {
          if (
            file[fi] === '.' ||
            file[fi] === '..' ||
            (!options.dot && file[fi].charAt(0) === '.')
          )
            return false;
        }
        return true;
      }
      // ok, let's see if we can swallow whatever we can.
      while (fr < fl) {
        var swallowee = file[fr];
        this.debug('\nglobstar while', file, fr, pattern, pr, swallowee);
        // XXX remove this slice.  Just pass the start index.
        if (this.matchOne(file.slice(fr), pattern.slice(pr), partial)) {
          this.debug('globstar found match!', fr, fl, swallowee);
          // found a match.
          return true;
        } else {
          // can't swallow "." or ".." ever.
          // can only swallow ".foo" when explicitly asked.
          if (
            swallowee === '.' ||
            swallowee === '..' ||
            (!options.dot && swallowee.charAt(0) === '.')
          ) {
            this.debug('dot detected!', file, fr, pattern, pr);
            break;
          }
          // ** swallows a segment, and continue.
          this.debug('globstar swallow a segment, and continue');
          fr++;
        }
      }
      // no match was found.
      // However, in partial mode, we can't say this is necessarily over.
      // If there's more *pattern* left, then
      if (partial) {
        // ran out of file
        this.debug('\n>>> no match, partial?', file, fr, pattern, pr);
        if (fr === fl) return true;
      }
      return false;
    }
    // something other than **
    // non-magic patterns just have to match exactly
    // patterns with magic have been turned into regexps.
    var hit;
    if (typeof p === 'string') {
      if (options.nocase) hit = f.toLowerCase() === p.toLowerCase();
      else hit = f === p;
      this.debug('string match', p, f, hit);
    } else {
      hit = f.match(p);
      this.debug('pattern match', p, f, hit);
    }
    if (!hit) return false;
  }
  // Note: ending in / means that we'll get a final ""
  // at the end of the pattern.  This can only match a
  // corresponding "" at the end of the file.
  // If the file ends in /, then it can only match a
  // a pattern that ends in /, unless the pattern just
  // doesn't have any more for it. But, a/b/ should *not*
  // match "a/b/*", even though "" matches against the
  // [^/]*? pattern, except in partial mode, where it might
  // simply not be reached yet.
  // However, a/b/ should still satisfy a/*
  // now either we fell off the end of the pattern, or we're done.
  if (fi === fl && pi === pl)
    // ran out of pattern and filename at the same time.
    // an exact hit!
    return true;
  else if (fi === fl)
    // ran out of file, but still had pattern left.
    // this is ok if we're doing the match as part of
    // a glob fs traversal.
    return partial;
  else if (pi === pl) {
    // ran out of pattern, still have file left.
    // this is only acceptable if we're on the very last
    // empty segment of a file with a trailing slash.
    // a/* should match a/b/
    var emptyFileEnd = fi === fl - 1 && file[fi] === '';
    return emptyFileEnd;
  }
  // should be unreachable.
  throw new Error('wtf?');
};
// replace stuff like \* with *
function $d847e1b1c07f9415$var$globUnescape(s) {
  return s.replace(/\\(.)/g, '$1');
}
function $d847e1b1c07f9415$var$regExpEscape(s) {
  return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

var $4b3c730d07da3487$exports = {};
/**
 * Expose `pathToRegexp`.
 */ $4b3c730d07da3487$exports = $4b3c730d07da3487$var$pathToRegexp;
$4b3c730d07da3487$exports.parse = $4b3c730d07da3487$var$parse;
$4b3c730d07da3487$exports.compile = $4b3c730d07da3487$var$compile;
$4b3c730d07da3487$exports.tokensToFunction =
  $4b3c730d07da3487$var$tokensToFunction;
$4b3c730d07da3487$exports.tokensToRegExp = $4b3c730d07da3487$var$tokensToRegExp;
/**
 * Default configs.
 */ var $4b3c730d07da3487$var$DEFAULT_DELIMITER = '/';
var $4b3c730d07da3487$var$DEFAULT_DELIMITERS = './';
/**
 * The main path matching regexp utility.
 *
 * @type {RegExp}
 */ var $4b3c730d07da3487$var$PATH_REGEXP = new RegExp(
  [
    // Match escaped characters that would otherwise appear in future matches.
    // This allows the user to escape special characters that won't transform.
    '(\\\\.)',
    // Match Express-style parameters and un-named parameters with a prefix
    // and optional suffixes. Matches appear as:
    //
    // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?"]
    // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined]
    '(?:\\:(\\w+)(?:\\(((?:\\\\.|[^\\\\()])+)\\))?|\\(((?:\\\\.|[^\\\\()])+)\\))([+*?])?',
  ].join('|'),
  'g',
);
/**
 * Parse a string for the raw tokens.
 *
 * @param  {string}  str
 * @param  {Object=} options
 * @return {!Array}
 */ function $4b3c730d07da3487$var$parse(str, options) {
  var tokens = [];
  var key = 0;
  var index = 0;
  var path = '';
  var defaultDelimiter =
    (options && options.delimiter) || $4b3c730d07da3487$var$DEFAULT_DELIMITER;
  var delimiters =
    (options && options.delimiters) || $4b3c730d07da3487$var$DEFAULT_DELIMITERS;
  var pathEscaped = false;
  var res;
  while ((res = $4b3c730d07da3487$var$PATH_REGEXP.exec(str)) !== null) {
    var m = res[0];
    var escaped = res[1];
    var offset = res.index;
    path += str.slice(index, offset);
    index = offset + m.length;
    // Ignore already escaped sequences.
    if (escaped) {
      path += escaped[1];
      pathEscaped = true;
      continue;
    }
    var prev = '';
    var next = str[index];
    var name = res[2];
    var capture = res[3];
    var group = res[4];
    var modifier = res[5];
    if (!pathEscaped && path.length) {
      var k = path.length - 1;
      if (delimiters.indexOf(path[k]) > -1) {
        prev = path[k];
        path = path.slice(0, k);
      }
    }
    // Push the current path onto the tokens.
    if (path) {
      tokens.push(path);
      path = '';
      pathEscaped = false;
    }
    var partial = prev !== '' && next !== undefined && next !== prev;
    var repeat = modifier === '+' || modifier === '*';
    var optional = modifier === '?' || modifier === '*';
    var delimiter = prev || defaultDelimiter;
    var pattern = capture || group;
    tokens.push({
      name: name || key++,
      prefix: prev,
      delimiter: delimiter,
      optional: optional,
      repeat: repeat,
      partial: partial,
      pattern: pattern
        ? $4b3c730d07da3487$var$escapeGroup(pattern)
        : '[^' + $4b3c730d07da3487$var$escapeString(delimiter) + ']+?',
    });
  }
  // Push any remaining characters.
  if (path || index < str.length) tokens.push(path + str.substr(index));
  return tokens;
}
/**
 * Compile a string to a template function for the path.
 *
 * @param  {string}             str
 * @param  {Object=}            options
 * @return {!function(Object=, Object=)}
 */ function $4b3c730d07da3487$var$compile(str, options) {
  return $4b3c730d07da3487$var$tokensToFunction(
    $4b3c730d07da3487$var$parse(str, options),
  );
}
/**
 * Expose a method for transforming tokens into the path function.
 */ function $4b3c730d07da3487$var$tokensToFunction(tokens) {
  // Compile all the tokens into regexps.
  var matches = new Array(tokens.length);
  // Compile all the patterns before compilation.
  for (var i = 0; i < tokens.length; i++)
    if (typeof tokens[i] === 'object')
      matches[i] = new RegExp('^(?:' + tokens[i].pattern + ')$');
  return function (data, options) {
    var path = '';
    var encode = (options && options.encode) || encodeURIComponent;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (typeof token === 'string') {
        path += token;
        continue;
      }
      var value = data ? data[token.name] : undefined;
      var segment;
      if (Array.isArray(value)) {
        if (!token.repeat)
          throw new TypeError(
            'Expected "' + token.name + '" to not repeat, but got array',
          );
        if (value.length === 0) {
          if (token.optional) continue;
          throw new TypeError('Expected "' + token.name + '" to not be empty');
        }
        for (var j = 0; j < value.length; j++) {
          segment = encode(value[j], token);
          if (!matches[i].test(segment))
            throw new TypeError(
              'Expected all "' +
                token.name +
                '" to match "' +
                token.pattern +
                '"',
            );
          path += (j === 0 ? token.prefix : token.delimiter) + segment;
        }
        continue;
      }
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        segment = encode(String(value), token);
        if (!matches[i].test(segment))
          throw new TypeError(
            'Expected "' +
              token.name +
              '" to match "' +
              token.pattern +
              '", but got "' +
              segment +
              '"',
          );
        path += token.prefix + segment;
        continue;
      }
      if (token.optional) {
        // Prepend partial segment prefixes.
        if (token.partial) path += token.prefix;
        continue;
      }
      throw new TypeError(
        'Expected "' +
          token.name +
          '" to be ' +
          (token.repeat ? 'an array' : 'a string'),
      );
    }
    return path;
  };
}
/**
 * Escape a regular expression string.
 *
 * @param  {string} str
 * @return {string}
 */ function $4b3c730d07da3487$var$escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
}
/**
 * Escape the capturing group by escaping special characters and meaning.
 *
 * @param  {string} group
 * @return {string}
 */ function $4b3c730d07da3487$var$escapeGroup(group) {
  return group.replace(/([=!:$/()])/g, '\\$1');
}
/**
 * Get the flags for a regexp from the options.
 *
 * @param  {Object} options
 * @return {string}
 */ function $4b3c730d07da3487$var$flags(options) {
  return options && options.sensitive ? '' : 'i';
}
/**
 * Pull out keys from a regexp.
 *
 * @param  {!RegExp} path
 * @param  {Array=}  keys
 * @return {!RegExp}
 */ function $4b3c730d07da3487$var$regexpToRegexp(path, keys) {
  if (!keys) return path;
  // Use a negative lookahead to match only capturing groups.
  var groups = path.source.match(/\((?!\?)/g);
  if (groups)
    for (var i = 0; i < groups.length; i++)
      keys.push({
        name: i,
        prefix: null,
        delimiter: null,
        optional: false,
        repeat: false,
        partial: false,
        pattern: null,
      });
  return path;
}
/**
 * Transform an array into a regexp.
 *
 * @param  {!Array}  path
 * @param  {Array=}  keys
 * @param  {Object=} options
 * @return {!RegExp}
 */ function $4b3c730d07da3487$var$arrayToRegexp(path, keys, options) {
  var parts = [];
  for (var i = 0; i < path.length; i++)
    parts.push(
      $4b3c730d07da3487$var$pathToRegexp(path[i], keys, options).source,
    );
  return new RegExp(
    '(?:' + parts.join('|') + ')',
    $4b3c730d07da3487$var$flags(options),
  );
}
/**
 * Create a path regexp from string input.
 *
 * @param  {string}  path
 * @param  {Array=}  keys
 * @param  {Object=} options
 * @return {!RegExp}
 */ function $4b3c730d07da3487$var$stringToRegexp(path, keys, options) {
  return $4b3c730d07da3487$var$tokensToRegExp(
    $4b3c730d07da3487$var$parse(path, options),
    keys,
    options,
  );
}
/**
 * Expose a function for taking tokens and returning a RegExp.
 *
 * @param  {!Array}  tokens
 * @param  {Array=}  keys
 * @param  {Object=} options
 * @return {!RegExp}
 */ function $4b3c730d07da3487$var$tokensToRegExp(tokens, keys, options) {
  options = options || {};
  var strict = options.strict;
  var end = options.end !== false;
  var delimiter = $4b3c730d07da3487$var$escapeString(
    options.delimiter || $4b3c730d07da3487$var$DEFAULT_DELIMITER,
  );
  var delimiters =
    options.delimiters || $4b3c730d07da3487$var$DEFAULT_DELIMITERS;
  var endsWith = []
    .concat(options.endsWith || [])
    .map($4b3c730d07da3487$var$escapeString)
    .concat('$')
    .join('|');
  var route = '';
  var isEndDelimited = tokens.length === 0;
  // Iterate over the tokens and create our regexp string.
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    if (typeof token === 'string') {
      route += $4b3c730d07da3487$var$escapeString(token);
      isEndDelimited =
        i === tokens.length - 1 &&
        delimiters.indexOf(token[token.length - 1]) > -1;
    } else {
      var prefix = $4b3c730d07da3487$var$escapeString(token.prefix);
      var capture = token.repeat
        ? '(?:' +
          token.pattern +
          ')(?:' +
          prefix +
          '(?:' +
          token.pattern +
          '))*'
        : token.pattern;
      if (keys) keys.push(token);
      if (token.optional) {
        if (token.partial) route += prefix + '(' + capture + ')?';
        else route += '(?:' + prefix + '(' + capture + '))?';
      } else route += prefix + '(' + capture + ')';
    }
  }
  if (end) {
    if (!strict) route += '(?:' + delimiter + ')?';
    route += endsWith === '$' ? '$' : '(?=' + endsWith + ')';
  } else {
    if (!strict) route += '(?:' + delimiter + '(?=' + endsWith + '))?';
    if (!isEndDelimited) route += '(?=' + delimiter + '|' + endsWith + ')';
  }
  return new RegExp('^' + route, $4b3c730d07da3487$var$flags(options));
}
/**
 * Normalize the given path string, returning a regular expression.
 *
 * An empty array can be passed in for the keys, which will hold the
 * placeholder key descriptions. For example, using `/user/:id`, `keys` will
 * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
 *
 * @param  {(string|RegExp|Array)} path
 * @param  {Array=}                keys
 * @param  {Object=}               options
 * @return {!RegExp}
 */ function $4b3c730d07da3487$var$pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return $4b3c730d07da3487$var$regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return $4b3c730d07da3487$var$arrayToRegexp(
      /** @type {!Array} */ path,
      keys,
      options,
    );
  return $4b3c730d07da3487$var$stringToRegexp(
    /** @type {string} */ path,
    keys,
    options,
  );
}

/*!
 * mime-types
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ var $2f9b157989bc1b17$export$e4c823724462c3fd;
var $2f9b157989bc1b17$export$48d2c0a44ea41a2f;
var $2f9b157989bc1b17$export$8019223850b8bf78;
var $2f9b157989bc1b17$export$1b45514b112dd749;
var $2f9b157989bc1b17$export$cc3e2d3244e01b7f;
var $2f9b157989bc1b17$export$dfc7155ac0343b8;
var $2f9b157989bc1b17$export$b14ad400b1d09e0f;
('use strict');
var $5abc5beea94402fe$exports = {};
/*!
 * mime-db
 * Copyright(c) 2014 Jonathan Ong
 * MIT Licensed
 */ /**
 * Module exports.
 */
$5abc5beea94402fe$exports = parcelRequire('fQuRa');

var $2f9b157989bc1b17$require$extname = $dmXIQ$path.extname;
/**
 * Module variables.
 * @private
 */ var $2f9b157989bc1b17$var$EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
var $2f9b157989bc1b17$var$TEXT_TYPE_REGEXP = /^text\//i;
$2f9b157989bc1b17$export$e4c823724462c3fd = $2f9b157989bc1b17$var$charset;
$2f9b157989bc1b17$export$48d2c0a44ea41a2f = {
  lookup: $2f9b157989bc1b17$var$charset,
};
$2f9b157989bc1b17$export$8019223850b8bf78 = $2f9b157989bc1b17$var$contentType;
$2f9b157989bc1b17$export$1b45514b112dd749 = $2f9b157989bc1b17$var$extension;
$2f9b157989bc1b17$export$cc3e2d3244e01b7f = Object.create(null);
$2f9b157989bc1b17$export$dfc7155ac0343b8 = $2f9b157989bc1b17$var$lookup;
$2f9b157989bc1b17$export$b14ad400b1d09e0f = Object.create(null);
// Populate the extensions/types maps
$2f9b157989bc1b17$var$populateMaps(
  $2f9b157989bc1b17$export$cc3e2d3244e01b7f,
  $2f9b157989bc1b17$export$b14ad400b1d09e0f,
);
/**
 * Get the default charset for a MIME type.
 *
 * @param {string} type
 * @return {boolean|string}
 */ function $2f9b157989bc1b17$var$charset(type) {
  if (!type || typeof type !== 'string') return false;
  // TODO: use media-typer
  var match = $2f9b157989bc1b17$var$EXTRACT_TYPE_REGEXP.exec(type);
  var mime = match && $5abc5beea94402fe$exports[match[1].toLowerCase()];
  if (mime && mime.charset) return mime.charset;
  // default text/* to utf-8
  if (match && $2f9b157989bc1b17$var$TEXT_TYPE_REGEXP.test(match[1]))
    return 'UTF-8';
  return false;
}
/**
 * Create a full Content-Type header given a MIME type or extension.
 *
 * @param {string} str
 * @return {boolean|string}
 */ function $2f9b157989bc1b17$var$contentType(str) {
  // TODO: should this even be in this module?
  if (!str || typeof str !== 'string') return false;
  var mime =
    str.indexOf('/') === -1
      ? $2f9b157989bc1b17$export$dfc7155ac0343b8(str)
      : str;
  if (!mime) return false;
  // TODO: use content-type or other module
  if (mime.indexOf('charset') === -1) {
    var charset = $2f9b157989bc1b17$export$e4c823724462c3fd(mime);
    if (charset) mime += '; charset=' + charset.toLowerCase();
  }
  return mime;
}
/**
 * Get the default extension for a MIME type.
 *
 * @param {string} type
 * @return {boolean|string}
 */ function $2f9b157989bc1b17$var$extension(type) {
  if (!type || typeof type !== 'string') return false;
  // TODO: use media-typer
  var match = $2f9b157989bc1b17$var$EXTRACT_TYPE_REGEXP.exec(type);
  // get extensions
  var exts =
    match && $2f9b157989bc1b17$export$cc3e2d3244e01b7f[match[1].toLowerCase()];
  if (!exts || !exts.length) return false;
  return exts[0];
}
/**
 * Lookup the MIME type for a file path/extension.
 *
 * @param {string} path
 * @return {boolean|string}
 */ function $2f9b157989bc1b17$var$lookup(path) {
  if (!path || typeof path !== 'string') return false;
  // get the extension ("ext" or ".ext" or full path)
  var extension = $2f9b157989bc1b17$require$extname('x.' + path)
    .toLowerCase()
    .substr(1);
  if (!extension) return false;
  return $2f9b157989bc1b17$export$b14ad400b1d09e0f[extension] || false;
}
/**
 * Populate the extensions and types maps.
 * @private
 */ function $2f9b157989bc1b17$var$populateMaps(extensions, types) {
  // source preference (least -> most)
  var preference = ['nginx', 'apache', undefined, 'iana'];
  Object.keys($5abc5beea94402fe$exports).forEach(function forEachMimeType(
    type,
  ) {
    var mime = $5abc5beea94402fe$exports[type];
    var exts = mime.extensions;
    if (!exts || !exts.length) return;
    // mime -> extensions
    extensions[type] = exts;
    // extension -> mime
    for (var i = 0; i < exts.length; i++) {
      var extension = exts[i];
      if (types[extension]) {
        var from = preference.indexOf(
          $5abc5beea94402fe$exports[types[extension]].source,
        );
        var to = preference.indexOf(mime.source);
        if (
          types[extension] !== 'application/octet-stream' &&
          (from > to ||
            (from === to && types[extension].substr(0, 12) === 'application/'))
        )
          continue;
      }
      // set the extension -> mime
      types[extension] = type;
    }
  });
}

var $fdff5ecc5445b5d0$exports = {};
/*!
 * bytes
 * Copyright(c) 2012-2014 TJ Holowaychuk
 * Copyright(c) 2015 Jed Watson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $fdff5ecc5445b5d0$exports = $fdff5ecc5445b5d0$var$bytes;
$fdff5ecc5445b5d0$exports.format = $fdff5ecc5445b5d0$var$format;
$fdff5ecc5445b5d0$exports.parse = $fdff5ecc5445b5d0$var$parse;
/**
 * Module variables.
 * @private
 */ var $fdff5ecc5445b5d0$var$formatThousandsRegExp = /\B(?=(\d{3})+(?!\d))/g;
var $fdff5ecc5445b5d0$var$formatDecimalsRegExp = /(?:\.0*|(\.[^0]+)0+)$/;
var $fdff5ecc5445b5d0$var$map = {
  b: 1,
  kb: 1024,
  mb: 1048576,
  gb: 1073741824,
  tb: 1073741824 * 1024,
};
var $fdff5ecc5445b5d0$var$parseRegExp =
  /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb)$/i;
/**
 * Convert the given value in bytes into a string or parse to string to an integer in bytes.
 *
 * @param {string|number} value
 * @param {{
 *  case: [string],
 *  decimalPlaces: [number]
 *  fixedDecimals: [boolean]
 *  thousandsSeparator: [string]
 *  unitSeparator: [string]
 *  }} [options] bytes options.
 *
 * @returns {string|number|null}
 */ function $fdff5ecc5445b5d0$var$bytes(value, options) {
  if (typeof value === 'string') return $fdff5ecc5445b5d0$var$parse(value);
  if (typeof value === 'number')
    return $fdff5ecc5445b5d0$var$format(value, options);
  return null;
}
/**
 * Format the given value in bytes into a string.
 *
 * If the value is negative, it is kept as such. If it is a float,
 * it is rounded.
 *
 * @param {number} value
 * @param {object} [options]
 * @param {number} [options.decimalPlaces=2]
 * @param {number} [options.fixedDecimals=false]
 * @param {string} [options.thousandsSeparator=]
 * @param {string} [options.unit=]
 * @param {string} [options.unitSeparator=]
 *
 * @returns {string|null}
 * @public
 */ function $fdff5ecc5445b5d0$var$format(value, options) {
  if (!Number.isFinite(value)) return null;
  var mag = Math.abs(value);
  var thousandsSeparator = (options && options.thousandsSeparator) || '';
  var unitSeparator = (options && options.unitSeparator) || '';
  var decimalPlaces =
    options && options.decimalPlaces !== undefined ? options.decimalPlaces : 2;
  var fixedDecimals = Boolean(options && options.fixedDecimals);
  var unit = (options && options.unit) || '';
  if (!unit || !$fdff5ecc5445b5d0$var$map[unit.toLowerCase()]) {
    if (mag >= $fdff5ecc5445b5d0$var$map.tb) unit = 'TB';
    else if (mag >= $fdff5ecc5445b5d0$var$map.gb) unit = 'GB';
    else if (mag >= $fdff5ecc5445b5d0$var$map.mb) unit = 'MB';
    else if (mag >= $fdff5ecc5445b5d0$var$map.kb) unit = 'KB';
    else unit = 'B';
  }
  var val = value / $fdff5ecc5445b5d0$var$map[unit.toLowerCase()];
  var str = val.toFixed(decimalPlaces);
  if (!fixedDecimals)
    str = str.replace($fdff5ecc5445b5d0$var$formatDecimalsRegExp, '$1');
  if (thousandsSeparator)
    str = str.replace(
      $fdff5ecc5445b5d0$var$formatThousandsRegExp,
      thousandsSeparator,
    );
  return str + unitSeparator + unit;
}
/**
 * Parse the string value into an integer in bytes.
 *
 * If no unit is given, it is assumed the value is in bytes.
 *
 * @param {number|string} val
 *
 * @returns {number|null}
 * @public
 */ function $fdff5ecc5445b5d0$var$parse(val) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val !== 'string') return null;
  // Test if the string passed is valid
  var results = $fdff5ecc5445b5d0$var$parseRegExp.exec(val);
  var floatValue;
  var unit = 'b';
  if (!results) {
    // Nothing could be extracted from the given string
    floatValue = parseInt(val, 10);
    unit = 'b';
  } else {
    // Retrieve the value and the unit
    floatValue = parseFloat(results[1]);
    unit = results[4].toLowerCase();
  }
  return Math.floor($fdff5ecc5445b5d0$var$map[unit] * floatValue);
}

var $628addee3c0f8936$exports = {};
/*!
 * content-disposition
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 */ $628addee3c0f8936$exports = $628addee3c0f8936$var$contentDisposition;
$628addee3c0f8936$exports.parse = $628addee3c0f8936$var$parse;

var $628addee3c0f8936$require$basename = $dmXIQ$path.basename;
/**
 * RegExp to match non attr-char, *after* encodeURIComponent (i.e. not including "%")
 */ var $628addee3c0f8936$var$ENCODE_URL_ATTR_CHAR_REGEXP =
  /[\x00-\x20"'()*,/:;<=>?@[\\\]{}\x7f]/g; // eslint-disable-line no-control-regex
/**
 * RegExp to match percent encoding escape.
 */ var $628addee3c0f8936$var$HEX_ESCAPE_REGEXP = /%[0-9A-Fa-f]{2}/;
var $628addee3c0f8936$var$HEX_ESCAPE_REPLACE_REGEXP = /%([0-9A-Fa-f]{2})/g;
/**
 * RegExp to match non-latin1 characters.
 */ var $628addee3c0f8936$var$NON_LATIN1_REGEXP = /[^\x20-\x7e\xa0-\xff]/g;
/**
 * RegExp to match quoted-pair in RFC 2616
 *
 * quoted-pair = "\" CHAR
 * CHAR        = <any US-ASCII character (octets 0 - 127)>
 */ var $628addee3c0f8936$var$QESC_REGEXP = /\\([\u0000-\u007f])/g;
/**
 * RegExp to match chars that must be quoted-pair in RFC 2616
 */ var $628addee3c0f8936$var$QUOTE_REGEXP = /([\\"])/g;
/**
 * RegExp for various RFC 2616 grammar
 *
 * parameter     = token "=" ( token | quoted-string )
 * token         = 1*<any CHAR except CTLs or separators>
 * separators    = "(" | ")" | "<" | ">" | "@"
 *               | "," | ";" | ":" | "\" | <">
 *               | "/" | "[" | "]" | "?" | "="
 *               | "{" | "}" | SP | HT
 * quoted-string = ( <"> *(qdtext | quoted-pair ) <"> )
 * qdtext        = <any TEXT except <">>
 * quoted-pair   = "\" CHAR
 * CHAR          = <any US-ASCII character (octets 0 - 127)>
 * TEXT          = <any OCTET except CTLs, but including LWS>
 * LWS           = [CRLF] 1*( SP | HT )
 * CRLF          = CR LF
 * CR            = <US-ASCII CR, carriage return (13)>
 * LF            = <US-ASCII LF, linefeed (10)>
 * SP            = <US-ASCII SP, space (32)>
 * HT            = <US-ASCII HT, horizontal-tab (9)>
 * CTL           = <any US-ASCII control character (octets 0 - 31) and DEL (127)>
 * OCTET         = <any 8-bit sequence of data>
 */ var $628addee3c0f8936$var$PARAM_REGEXP =
  /;[\x09\x20]*([!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*=[\x09\x20]*("(?:[\x20!\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\x20-\x7e])*"|[!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*/g; // eslint-disable-line no-control-regex
var $628addee3c0f8936$var$TEXT_REGEXP = /^[\x20-\x7e\x80-\xff]+$/;
var $628addee3c0f8936$var$TOKEN_REGEXP = /^[!#$%&'*+.0-9A-Z^_`a-z|~-]+$/;
/**
 * RegExp for various RFC 5987 grammar
 *
 * ext-value     = charset  "'" [ language ] "'" value-chars
 * charset       = "UTF-8" / "ISO-8859-1" / mime-charset
 * mime-charset  = 1*mime-charsetc
 * mime-charsetc = ALPHA / DIGIT
 *               / "!" / "#" / "$" / "%" / "&"
 *               / "+" / "-" / "^" / "_" / "`"
 *               / "{" / "}" / "~"
 * language      = ( 2*3ALPHA [ extlang ] )
 *               / 4ALPHA
 *               / 5*8ALPHA
 * extlang       = *3( "-" 3ALPHA )
 * value-chars   = *( pct-encoded / attr-char )
 * pct-encoded   = "%" HEXDIG HEXDIG
 * attr-char     = ALPHA / DIGIT
 *               / "!" / "#" / "$" / "&" / "+" / "-" / "."
 *               / "^" / "_" / "`" / "|" / "~"
 */ var $628addee3c0f8936$var$EXT_VALUE_REGEXP =
  /^([A-Za-z0-9!#$%&+\-^_`{}~]+)'(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8}|)'((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9!#$&+.^_`|~-])+)$/;
/**
 * RegExp for various RFC 6266 grammar
 *
 * disposition-type = "inline" | "attachment" | disp-ext-type
 * disp-ext-type    = token
 * disposition-parm = filename-parm | disp-ext-parm
 * filename-parm    = "filename" "=" value
 *                  | "filename*" "=" ext-value
 * disp-ext-parm    = token "=" value
 *                  | ext-token "=" ext-value
 * ext-token        = <the characters in token, followed by "*">
 */ var $628addee3c0f8936$var$DISPOSITION_TYPE_REGEXP =
  /^([!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*(?:$|;)/; // eslint-disable-line no-control-regex
/**
 * Create an attachment Content-Disposition header.
 *
 * @param {string} [filename]
 * @param {object} [options]
 * @param {string} [options.type=attachment]
 * @param {string|boolean} [options.fallback=true]
 * @return {string}
 * @api public
 */ function $628addee3c0f8936$var$contentDisposition(filename, options) {
  var opts = options || {};
  // get type
  var type = opts.type || 'attachment';
  // get parameters
  var params = $628addee3c0f8936$var$createparams(filename, opts.fallback);
  // format into string
  return $628addee3c0f8936$var$format(
    new $628addee3c0f8936$var$ContentDisposition(type, params),
  );
}
/**
 * Create parameters object from filename and fallback.
 *
 * @param {string} [filename]
 * @param {string|boolean} [fallback=true]
 * @return {object}
 * @api private
 */ function $628addee3c0f8936$var$createparams(filename, fallback) {
  if (filename === undefined) return;
  var params = {};
  if (typeof filename !== 'string')
    throw new TypeError('filename must be a string');
  // fallback defaults to true
  if (fallback === undefined) fallback = true;
  if (typeof fallback !== 'string' && typeof fallback !== 'boolean')
    throw new TypeError('fallback must be a string or boolean');
  if (
    typeof fallback === 'string' &&
    $628addee3c0f8936$var$NON_LATIN1_REGEXP.test(fallback)
  )
    throw new TypeError('fallback must be ISO-8859-1 string');
  // restrict to file base name
  var name = $628addee3c0f8936$require$basename(filename);
  // determine if name is suitable for quoted string
  var isQuotedString = $628addee3c0f8936$var$TEXT_REGEXP.test(name);
  // generate fallback name
  var fallbackName =
    typeof fallback !== 'string'
      ? fallback && $628addee3c0f8936$var$getlatin1(name)
      : $628addee3c0f8936$require$basename(fallback);
  var hasFallback = typeof fallbackName === 'string' && fallbackName !== name;
  // set extended filename parameter
  if (
    hasFallback ||
    !isQuotedString ||
    $628addee3c0f8936$var$HEX_ESCAPE_REGEXP.test(name)
  )
    params['filename*'] = name;
  // set filename parameter
  if (isQuotedString || hasFallback)
    params.filename = hasFallback ? fallbackName : name;
  return params;
}
/**
 * Format object to Content-Disposition header.
 *
 * @param {object} obj
 * @param {string} obj.type
 * @param {object} [obj.parameters]
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$format(obj) {
  var parameters = obj.parameters;
  var type = obj.type;
  if (
    !type ||
    typeof type !== 'string' ||
    !$628addee3c0f8936$var$TOKEN_REGEXP.test(type)
  )
    throw new TypeError('invalid type');
  // start with normalized type
  var string = String(type).toLowerCase();
  // append parameters
  if (parameters && typeof parameters === 'object') {
    var param;
    var params = Object.keys(parameters).sort();
    for (var i = 0; i < params.length; i++) {
      param = params[i];
      var val =
        param.substr(-1) === '*'
          ? $628addee3c0f8936$var$ustring(parameters[param])
          : $628addee3c0f8936$var$qstring(parameters[param]);
      string += '; ' + param + '=' + val;
    }
  }
  return string;
}
/**
 * Decode a RFC 6987 field value (gracefully).
 *
 * @param {string} str
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$decodefield(str) {
  var match = $628addee3c0f8936$var$EXT_VALUE_REGEXP.exec(str);
  if (!match) throw new TypeError('invalid extended field value');
  var charset = match[1].toLowerCase();
  var encoded = match[2];
  var value;
  // to binary string
  var binary = encoded.replace(
    $628addee3c0f8936$var$HEX_ESCAPE_REPLACE_REGEXP,
    $628addee3c0f8936$var$pdecode,
  );
  switch (charset) {
    case 'iso-8859-1':
      value = $628addee3c0f8936$var$getlatin1(binary);
      break;
    case 'utf-8':
      value = new Buffer(binary, 'binary').toString('utf8');
      break;
    default:
      throw new TypeError('unsupported charset in extended field');
  }
  return value;
}
/**
 * Get ISO-8859-1 version of string.
 *
 * @param {string} val
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$getlatin1(val) {
  // simple Unicode -> ISO-8859-1 transformation
  return String(val).replace($628addee3c0f8936$var$NON_LATIN1_REGEXP, '?');
}
/**
 * Parse Content-Disposition header string.
 *
 * @param {string} string
 * @return {object}
 * @api private
 */ function $628addee3c0f8936$var$parse(string) {
  if (!string || typeof string !== 'string')
    throw new TypeError('argument string is required');
  var match = $628addee3c0f8936$var$DISPOSITION_TYPE_REGEXP.exec(string);
  if (!match) throw new TypeError('invalid type format');
  // normalize type
  var index = match[0].length;
  var type = match[1].toLowerCase();
  var key;
  var names = [];
  var params = {};
  var value;
  // calculate index to start at
  index = $628addee3c0f8936$var$PARAM_REGEXP.lastIndex =
    match[0].substr(-1) === ';' ? index - 1 : index;
  // match parameters
  while ((match = $628addee3c0f8936$var$PARAM_REGEXP.exec(string))) {
    if (match.index !== index) throw new TypeError('invalid parameter format');
    index += match[0].length;
    key = match[1].toLowerCase();
    value = match[2];
    if (names.indexOf(key) !== -1)
      throw new TypeError('invalid duplicate parameter');
    names.push(key);
    if (key.indexOf('*') + 1 === key.length) {
      // decode extended value
      key = key.slice(0, -1);
      value = $628addee3c0f8936$var$decodefield(value);
      // overwrite existing value
      params[key] = value;
      continue;
    }
    if (typeof params[key] === 'string') continue;
    if (value[0] === '"')
      // remove quotes and escapes
      value = value
        .substr(1, value.length - 2)
        .replace($628addee3c0f8936$var$QESC_REGEXP, '$1');
    params[key] = value;
  }
  if (index !== -1 && index !== string.length)
    throw new TypeError('invalid parameter format');
  return new $628addee3c0f8936$var$ContentDisposition(type, params);
}
/**
 * Percent decode a single character.
 *
 * @param {string} str
 * @param {string} hex
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$pdecode(str, hex) {
  return String.fromCharCode(parseInt(hex, 16));
}
/**
 * Percent encode a single character.
 *
 * @param {string} char
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$pencode(char) {
  var hex = String(char).charCodeAt(0).toString(16).toUpperCase();
  return hex.length === 1 ? '%0' + hex : '%' + hex;
}
/**
 * Quote a string for HTTP.
 *
 * @param {string} val
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$qstring(val) {
  var str = String(val);
  return '"' + str.replace($628addee3c0f8936$var$QUOTE_REGEXP, '\\$1') + '"';
}
/**
 * Encode a Unicode string for HTTP (RFC 5987).
 *
 * @param {string} val
 * @return {string}
 * @api private
 */ function $628addee3c0f8936$var$ustring(val) {
  var str = String(val);
  // percent encode as UTF-8
  var encoded = encodeURIComponent(str).replace(
    $628addee3c0f8936$var$ENCODE_URL_ATTR_CHAR_REGEXP,
    $628addee3c0f8936$var$pencode,
  );
  return "UTF-8''" + encoded;
}
/**
 * Class for parsed Content-Disposition header for v8 optimization
 */ function $628addee3c0f8936$var$ContentDisposition(type, parameters) {
  this.type = type;
  this.parameters = parameters;
}

var $2d2fdcef4a143ca2$exports = {};
('use strict');

$2d2fdcef4a143ca2$exports = function (thePath, potentialParent) {
  // For inside-directory checking, we want to allow trailing slashes, so normalize.
  thePath = $2d2fdcef4a143ca2$var$stripTrailingSep(thePath);
  potentialParent = $2d2fdcef4a143ca2$var$stripTrailingSep(potentialParent);
  // Node treats only Windows as case-insensitive in its path module; we follow those conventions.
  if (process.platform === 'win32') {
    thePath = thePath.toLowerCase();
    potentialParent = potentialParent.toLowerCase();
  }
  return (
    thePath.lastIndexOf(potentialParent, 0) === 0 &&
    (thePath[potentialParent.length] === $dmXIQ$path.sep ||
      thePath[potentialParent.length] === undefined)
  );
};
function $2d2fdcef4a143ca2$var$stripTrailingSep(thePath) {
  if (thePath[thePath.length - 1] === $dmXIQ$path.sep)
    return thePath.slice(0, -1);
  return thePath;
}

var $82178867fb5c36c1$exports = {};
/*!
 * range-parser
 * Copyright(c) 2012-2014 TJ Holowaychuk
 * Copyright(c) 2015-2016 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * Module exports.
 * @public
 */ $82178867fb5c36c1$exports = $82178867fb5c36c1$var$rangeParser;
/**
 * Parse "Range" header `str` relative to the given file `size`.
 *
 * @param {Number} size
 * @param {String} str
 * @param {Object} [options]
 * @return {Array}
 * @public
 */ function $82178867fb5c36c1$var$rangeParser(size, str, options) {
  var index = str.indexOf('=');
  if (index === -1) return -2;
  // split the range string
  var arr = str.slice(index + 1).split(',');
  var ranges = [];
  // add ranges type
  ranges.type = str.slice(0, index);
  // parse all ranges
  for (var i = 0; i < arr.length; i++) {
    var range = arr[i].split('-');
    var start = parseInt(range[0], 10);
    var end = parseInt(range[1], 10);
    // -nnn
    if (isNaN(start)) {
      start = size - end;
      end = size - 1;
      // nnn-
    } else if (isNaN(end)) end = size - 1;
    // limit last-byte-pos to current length
    if (end > size - 1) end = size - 1;
    // invalid or unsatisifiable
    if (isNaN(start) || isNaN(end) || start > end || start < 0) continue;
    // add range
    ranges.push({
      start: start,
      end: end,
    });
  }
  if (ranges.length < 1)
    // unsatisifiable
    return -1;
  return options && options.combine
    ? $82178867fb5c36c1$var$combineRanges(ranges)
    : ranges;
}
/**
 * Combine overlapping & adjacent ranges.
 * @private
 */ function $82178867fb5c36c1$var$combineRanges(ranges) {
  var ordered = ranges
    .map($82178867fb5c36c1$var$mapWithIndex)
    .sort($82178867fb5c36c1$var$sortByRangeStart);
  for (var j = 0, i = 1; i < ordered.length; i++) {
    var range = ordered[i];
    var current = ordered[j];
    if (range.start > current.end + 1)
      // next range
      ordered[++j] = range;
    else if (range.end > current.end) {
      // extend range
      current.end = range.end;
      current.index = Math.min(current.index, range.index);
    }
  }
  // trim ordered array
  ordered.length = j + 1;
  // generate combined range
  var combined = ordered
    .sort($82178867fb5c36c1$var$sortByRangeIndex)
    .map($82178867fb5c36c1$var$mapWithoutIndex);
  // copy ranges type
  combined.type = ranges.type;
  return combined;
}
/**
 * Map function to add index value to ranges.
 * @private
 */ function $82178867fb5c36c1$var$mapWithIndex(range, index) {
  return {
    start: range.start,
    end: range.end,
    index: index,
  };
}
/**
 * Map function to remove index value from ranges.
 * @private
 */ function $82178867fb5c36c1$var$mapWithoutIndex(range) {
  return {
    start: range.start,
    end: range.end,
  };
}
/**
 * Sort function to sort ranges by index.
 * @private
 */ function $82178867fb5c36c1$var$sortByRangeIndex(a, b) {
  return a.index - b.index;
}
/**
 * Sort function to sort ranges by start position.
 * @private
 */ function $82178867fb5c36c1$var$sortByRangeStart(a, b) {
  return a.start - b.start;
}

var $870c34b85aa551bd$exports = {};
(function () {
  function directory(it) {
    var encodeHTML =
      typeof _encodeHTML !== 'undefined'
        ? _encodeHTML
        : (function (doNotSkipEncoded) {
            var encodeHTMLRules = {
                '&': '&#38;',
                '<': '&#60;',
                '>': '&#62;',
                '"': '&#34;',
                "'": '&#39;',
                '/': '&#47;',
              },
              matchHTML = doNotSkipEncoded
                ? /[&<>"'\/]/g
                : /&(?!#?\w+;)|<|>|"|'|\//g;
            return function (code) {
              return code
                ? code.toString().replace(matchHTML, function (m) {
                    return encodeHTMLRules[m] || m;
                  })
                : '';
            };
          })();
    var out =
      '<!DOCTYPE html><html lang="en"> <head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <title>Files within ' +
      encodeHTML(it.directory) +
      "</title> <style>body { margin: 0; padding: 30px; background: #fff; font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Roboto\", \"Oxygen\", \"Ubuntu\", \"Cantarell\", \"Fira Sans\", \"Droid Sans\", \"Helvetica Neue\", sans-serif; -webkit-font-smoothing: antialiased;}main { max-width: 920px;}header { display: flex; justify-content: space-between; flex-wrap: wrap;}h1 { font-size: 18px; font-weight: 500; margin-top: 0; color: #000;}header h1 a { font-size: 18px; font-weight: 500; margin-top: 0; color: #000;}h1 i { font-style: normal;}ul { margin: 0 0 0 -2px; padding: 20px 0 0 0;}ul li { list-style: none; font-size: 14px; display: flex; justify-content: space-between;}a { text-decoration: none;}ul a { color: #000; padding: 10px 5px; margin: 0 -5px; white-space: nowrap; overflow: hidden; display: block; width: 100%; text-overflow: ellipsis;}header a { color: #0076FF; font-size: 11px; font-weight: 400; display: inline-block; line-height: 20px;}svg { height: 13px; vertical-align: text-bottom;}ul a::before { display: inline-block; vertical-align: middle; margin-right: 10px; width: 24px; text-align: center; line-height: 12px;}ul a.file::before { content: url(\"data:image/svg+xml;utf8,<svg width='15' height='19' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M10 8C8.34 8 7 6.66 7 5V1H3c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2V8h-4zM8 5c0 1.1.9 2 2 2h3.59L8 1.41V5zM3 0h5l7 7v9c0 1.66-1.34 3-3 3H3c-1.66 0-3-1.34-3-3V3c0-1.66 1.34-3 3-3z' fill='black'/></svg>\");}ul a:hover { text-decoration: underline;}ul a.folder::before { content: url(\"data:image/svg+xml;utf8,<svg width='20' height='16' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M18.784 3.87a1.565 1.565 0 0 0-.565-.356V2.426c0-.648-.523-1.171-1.15-1.171H8.996L7.908.25A.89.89 0 0 0 7.302 0H2.094C1.445 0 .944.523.944 1.171v2.3c-.21.085-.398.21-.565.356a1.348 1.348 0 0 0-.377 1.004l.398 9.83C.42 15.393 1.048 16 1.8 16h15.583c.753 0 1.36-.586 1.4-1.339l.398-9.83c.021-.313-.125-.69-.397-.962zM1.843 3.41V1.191c0-.146.104-.272.25-.272H7.26l1.234 1.088c.083.042.167.104.293.104h8.282c.125 0 .25.126.25.272V3.41H1.844zm15.54 11.712H1.78a.47.47 0 0 1-.481-.46l-.397-9.83c0-.147.041-.252.125-.356a.504.504 0 0 1 .377-.147H17.78c.125 0 .272.063.377.147.083.083.125.209.125.334l-.418 9.83c-.021.272-.23.482-.481.482z' fill='black'/></svg>\");}ul a.lambda::before { content: url(\"data:image/svg+xml; utf8,<svg width='15' height='19' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M3.5 14.4354H5.31622L7.30541 9.81311H7.43514L8.65315 13.0797C9.05676 14.1643 9.55405 14.5 10.7 14.5C11.0171 14.5 11.291 14.4677 11.5 14.4032V13.1572C11.3847 13.1766 11.2622 13.2024 11.1541 13.2024C10.6351 13.2024 10.3829 13.0281 10.1595 12.4664L8.02613 7.07586C7.21171 5.01646 6.54865 4.5 5.11441 4.5C4.83333 4.5 4.62432 4.53228 4.37207 4.59038V5.83635C4.56667 5.81052 4.66036 5.79761 4.77568 5.79761C5.64775 5.79761 5.9 6.0042 6.4045 7.19852L6.64234 7.77954L3.5 14.4354Z' fill='black'/><rect x='0.5' y='0.5' width='14' height='18' rx='2.5' stroke='black'/></svg>\");}ul a.file.gif::before,ul a.file.jpg::before,ul a.file.png::before,ul a.file.svg::before { content: url(\"data:image/svg+xml;utf8,<svg width='16' height='16' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg' fill='none' stroke='black' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'><rect x='6' y='6' width='68' height='68' rx='5' ry='5'/><circle cx='24' cy='24' r='8'/><path d='M73 49L59 34 37 52m16 20L27 42 7 58'/></svg>\");}::selection { background-color: #79FFE1; color: #000;}::-moz-selection { background-color: #79FFE1; color: #000;}@media (min-width: 768px) { ul {display: flex;flex-wrap: wrap; } ul li {width: 230px;padding-right: 20px; }}@media (min-width: 992px) { body {padding: 45px; } h1, header h1 a {font-size: 15px; } ul li {font-size: 13px;box-sizing: border-box;justify-content: flex-start; }}</style> </head> <body> <main> <header> <h1> <i>Index of&nbsp;</i> ";
    var arr1 = it.paths;
    if (arr1) {
      var value,
        index = -1,
        l1 = arr1.length - 1;
      while (index < l1) {
        value = arr1[(index += 1)];
        out +=
          ' <a href="/' +
          encodeHTML(value.url) +
          '">' +
          encodeHTML(value.name) +
          '</a> ';
      }
    }
    out += ' </h1> </header> <ul id="files"> ';
    var arr2 = it.files;
    if (arr2) {
      var value,
        index = -1,
        l2 = arr2.length - 1;
      while (index < l2) {
        value = arr2[(index += 1)];
        out +=
          ' <li> <a href="' +
          encodeHTML(value.relative) +
          '" title="' +
          encodeHTML(value.title) +
          '" class="' +
          encodeHTML(value.type) +
          ' ' +
          encodeHTML(value.ext) +
          '">' +
          encodeHTML(value.base) +
          '</a> </li> ';
      }
    }
    out += ' </ul></main> </body></html>';
    return out;
  }
  var itself = directory,
    _encodeHTML = (function (doNotSkipEncoded) {
      var encodeHTMLRules = {
          '&': '&#38;',
          '<': '&#60;',
          '>': '&#62;',
          '"': '&#34;',
          "'": '&#39;',
          '/': '&#47;',
        },
        matchHTML = doNotSkipEncoded ? /[&<>"'\/]/g : /&(?!#?\w+;)|<|>|"|'|\//g;
      return function (code) {
        return code
          ? code.toString().replace(matchHTML, function (m) {
              return encodeHTMLRules[m] || m;
            })
          : '';
      };
    })();
  if ((0, $870c34b85aa551bd$exports)) $870c34b85aa551bd$exports = itself;
  else if (typeof define === 'function')
    define(function () {
      return itself;
    });
  else {
    window.render = window.render || {};
    window.render['directory'] = itself;
  }
})();

var $08fb6c9d068d59cd$exports = {};
(function () {
  function error(it) {
    var out =
      '<!DOCTYPE html><head> <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"/> <style> body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif; cursor: default; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; } main, aside, section { display: flex; justify-content: center; align-items: center; flex-direction: column; } main { height: 100%; } aside { background: #000; flex-shrink: 1; padding: 30px 20px; } aside p { margin: 0; color: #999999; font-size: 14px; line-height: 24px; } aside a { color: #fff; text-decoration: none; } section span { font-size: 24px; font-weight: 500; display: block; border-bottom: 1px solid #EAEAEA; text-align: center; padding-bottom: 20px; width: 100px; } section p { font-size: 14px; font-weight: 400; } section span + p { margin: 20px 0 0 0; } @media (min-width: 768px) { section { height: 40px; flex-direction: row; } section span, section p { height: 100%; line-height: 40px; } section span { border-bottom: 0; border-right: 1px solid #EAEAEA; padding: 0 20px 0 0; width: auto; } section span + p { margin: 0; padding-left: 20px; } aside { padding: 50px 0; } aside p { max-width: 520px; text-align: center; } } </style></head><body> <main> <section> <span>' +
      it.statusCode +
      '</span> <p>' +
      it.message +
      '</p> </section> </main></body>';
    return out;
  }
  var itself = error,
    _encodeHTML = (function (doNotSkipEncoded) {
      var encodeHTMLRules = {
          '&': '&#38;',
          '<': '&#60;',
          '>': '&#62;',
          '"': '&#34;',
          "'": '&#39;',
          '/': '&#47;',
        },
        matchHTML = doNotSkipEncoded ? /[&<>"'\/]/g : /&(?!#?\w+;)|<|>|"|'|\//g;
      return function (code) {
        return code
          ? code.toString().replace(matchHTML, function (m) {
              return encodeHTMLRules[m] || m;
            })
          : '';
      };
    })();
  if ((0, $08fb6c9d068d59cd$exports)) $08fb6c9d068d59cd$exports = itself;
  else if (typeof define === 'function')
    define(function () {
      return itself;
    });
  else {
    window.render = window.render || {};
    window.render['error'] = itself;
  }
})();

const $116f4e94d746e22c$var$etags = new Map();
const $116f4e94d746e22c$var$calculateSha = (handlers, absolutePath) =>
  new Promise((resolve, reject) => {
    const hash = $116f4e94d746e22c$require$createHash('sha1');
    hash.update($dmXIQ$path.extname(absolutePath));
    hash.update('-');
    const rs = handlers.createReadStream(absolutePath);
    rs.on('error', reject);
    rs.on('data', buf => hash.update(buf));
    rs.on('end', () => {
      const sha = hash.digest('hex');
      resolve(sha);
    });
  });
const $116f4e94d746e22c$var$sourceMatches = (
  source,
  requestPath,
  allowSegments,
) => {
  const keys = [];
  const slashed = $2d40ff1219c6261c$exports(source);
  const resolvedPath = $dmXIQ$path.posix.resolve(requestPath);
  let results = null;
  if (allowSegments) {
    const normalized = slashed.replace('*', '(.*)');
    const expression = $4b3c730d07da3487$exports(normalized, keys);
    results = expression.exec(resolvedPath);
    if (!results)
      // clear keys so that they are not used
      // later with empty results. this may
      // happen if minimatch returns true
      keys.length = 0;
  }
  if (results || $d847e1b1c07f9415$exports(resolvedPath, slashed))
    return {
      keys: keys,
      results: results,
    };
  return null;
};
const $116f4e94d746e22c$var$toTarget = (source, destination, previousPath) => {
  const matches = $116f4e94d746e22c$var$sourceMatches(
    source,
    previousPath,
    true,
  );
  if (!matches) return null;
  const {keys: keys, results: results} = matches;
  const props = {};
  const {protocol: protocol} = $098e6ad56edac974$exports.parse(destination);
  const normalizedDest = protocol
    ? destination
    : $2d40ff1219c6261c$exports(destination);
  const toPath = $4b3c730d07da3487$exports.compile(normalizedDest);
  for (let index = 0; index < keys.length; index++) {
    const {name: name} = keys[index];
    props[name] = results[index + 1];
  }
  return toPath(props);
};
const $116f4e94d746e22c$var$applyRewrites = (
  requestPath,
  rewrites = [],
  repetitive,
) => {
  // We need to copy the array, since we're going to modify it.
  const rewritesCopy = rewrites.slice();
  // If the method was called again, the path was already rewritten
  // so we need to make sure to return it.
  const fallback = repetitive ? requestPath : null;
  if (rewritesCopy.length === 0) return fallback;
  for (let index = 0; index < rewritesCopy.length; index++) {
    const {source: source, destination: destination} = rewrites[index];
    const target = $116f4e94d746e22c$var$toTarget(
      source,
      destination,
      requestPath,
    );
    if (target) {
      // Remove rules that were already applied
      rewritesCopy.splice(index, 1);
      // Check if there are remaining ones to be applied
      return $116f4e94d746e22c$var$applyRewrites(
        $2d40ff1219c6261c$exports(target),
        rewritesCopy,
        true,
      );
    }
  }
  return fallback;
};
const $116f4e94d746e22c$var$ensureSlashStart = target =>
  target.startsWith('/') ? target : `/${target}`;
const $116f4e94d746e22c$var$shouldRedirect = (
  decodedPath,
  {redirects: redirects = [], trailingSlash: trailingSlash},
  cleanUrl,
) => {
  const slashing = typeof trailingSlash === 'boolean';
  const defaultType = 301;
  const matchHTML = /(\.html|\/index)$/g;
  if (redirects.length === 0 && !slashing && !cleanUrl) return null;
  // By stripping the HTML parts from the decoded
  // path *before* handling the trailing slash, we make
  // sure that only *one* redirect occurs if both
  // config options are used.
  if (cleanUrl && matchHTML.test(decodedPath)) {
    decodedPath = decodedPath.replace(matchHTML, '');
    if (decodedPath.indexOf('//') > -1)
      decodedPath = decodedPath.replace(/\/+/g, '/');
    return {
      target: $116f4e94d746e22c$var$ensureSlashStart(decodedPath),
      statusCode: defaultType,
    };
  }
  if (slashing) {
    const {ext: ext, name: name} = $dmXIQ$path.parse(decodedPath);
    const isTrailed = decodedPath.endsWith('/');
    const isDotfile = name.startsWith('.');
    let target = null;
    if (!trailingSlash && isTrailed) target = decodedPath.slice(0, -1);
    else if (trailingSlash && !isTrailed && !ext && !isDotfile)
      target = `${decodedPath}/`;
    if (decodedPath.indexOf('//') > -1)
      target = decodedPath.replace(/\/+/g, '/');
    if (target)
      return {
        target: $116f4e94d746e22c$var$ensureSlashStart(target),
        statusCode: defaultType,
      };
  }
  // This is currently the fastest way to
  // iterate over an array
  for (let index = 0; index < redirects.length; index++) {
    const {
      source: source,
      destination: destination,
      type: type,
    } = redirects[index];
    const target = $116f4e94d746e22c$var$toTarget(
      source,
      destination,
      decodedPath,
    );
    if (target)
      return {
        target: target,
        statusCode: type || defaultType,
      };
  }
  return null;
};
const $116f4e94d746e22c$var$appendHeaders = (target, source) => {
  for (let index = 0; index < source.length; index++) {
    const {key: key, value: value} = source[index];
    target[key] = value;
  }
};
const $116f4e94d746e22c$var$getHeaders = async (
  handlers,
  config,
  current,
  absolutePath,
  stats,
) => {
  const {headers: customHeaders = [], etag: etag = false} = config;
  const related = {};
  const {base: base} = $dmXIQ$path.parse(absolutePath);
  const relativePath = $dmXIQ$path.relative(current, absolutePath);
  if (customHeaders.length > 0)
    // By iterating over all headers and never stopping, developers
    // can specify multiple header sources in the config that
    // might match a single path.
    for (let index = 0; index < customHeaders.length; index++) {
      const {source: source, headers: headers} = customHeaders[index];
      if (
        $116f4e94d746e22c$var$sourceMatches(
          source,
          $2d40ff1219c6261c$exports(relativePath),
        )
      )
        $116f4e94d746e22c$var$appendHeaders(related, headers);
    }
  let defaultHeaders = {};
  if (stats) {
    defaultHeaders = {
      'Content-Length': stats.size,
      // Default to "inline", which always tries to render in the browser,
      // if that's not working, it will save the file. But to be clear: This
      // only happens if it cannot find a appropiate value.
      'Content-Disposition': $628addee3c0f8936$exports(base, {
        type: 'inline',
      }),
      'Accept-Ranges': 'bytes',
    };
    if (etag) {
      let [mtime, sha] = $116f4e94d746e22c$var$etags.get(absolutePath) || [];
      if (Number(mtime) !== Number(stats.mtime)) {
        sha = await $116f4e94d746e22c$var$calculateSha(handlers, absolutePath);
        $116f4e94d746e22c$var$etags.set(absolutePath, [stats.mtime, sha]);
      }
      defaultHeaders['ETag'] = `"${sha}"`;
    } else defaultHeaders['Last-Modified'] = stats.mtime.toUTCString();
    const contentType = $2f9b157989bc1b17$export$8019223850b8bf78(base);
    if (contentType) defaultHeaders['Content-Type'] = contentType;
  }
  const headers = Object.assign(defaultHeaders, related);
  for (const key in headers)
    if (headers.hasOwnProperty(key) && headers[key] === null)
      delete headers[key];
  return headers;
};
const $116f4e94d746e22c$var$applicable = (decodedPath, configEntry) => {
  if (typeof configEntry === 'boolean') return configEntry;
  if (Array.isArray(configEntry)) {
    for (let index = 0; index < configEntry.length; index++) {
      const source = configEntry[index];
      if ($116f4e94d746e22c$var$sourceMatches(source, decodedPath)) return true;
    }
    return false;
  }
  return true;
};
const $116f4e94d746e22c$var$getPossiblePaths = (relativePath, extension) =>
  [
    $dmXIQ$path.join(relativePath, `index${extension}`),
    relativePath.endsWith('/')
      ? relativePath.replace(/\/$/g, extension)
      : relativePath + extension,
  ].filter(item => $dmXIQ$path.basename(item) !== extension);
const $116f4e94d746e22c$var$findRelated = async (
  current,
  relativePath,
  rewrittenPath,
  originalStat,
) => {
  const possible = rewrittenPath
    ? [rewrittenPath]
    : $116f4e94d746e22c$var$getPossiblePaths(relativePath, '.html');
  let stats = null;
  for (let index = 0; index < possible.length; index++) {
    const related = possible[index];
    const absolutePath = $dmXIQ$path.join(current, related);
    try {
      stats = await originalStat(absolutePath);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
    if (stats)
      return {
        stats: stats,
        absolutePath: absolutePath,
      };
  }
  return null;
};
const $116f4e94d746e22c$var$canBeListed = (excluded, file) => {
  const slashed = $2d40ff1219c6261c$exports(file);
  let whether = true;
  for (let mark = 0; mark < excluded.length; mark++) {
    const source = excluded[mark];
    if ($116f4e94d746e22c$var$sourceMatches(source, slashed)) {
      whether = false;
      break;
    }
  }
  return whether;
};
const $116f4e94d746e22c$var$renderDirectory = async (
  current,
  acceptsJSON,
  handlers,
  methods,
  config,
  paths,
) => {
  const {
    directoryListing: directoryListing,
    trailingSlash: trailingSlash,
    unlisted: unlisted = [],
    renderSingle: renderSingle,
  } = config;
  const slashSuffix =
    typeof trailingSlash === 'boolean' ? (trailingSlash ? '/' : '') : '/';
  const {relativePath: relativePath, absolutePath: absolutePath} = paths;
  const excluded = ['.DS_Store', '.git', ...unlisted];
  if (
    !$116f4e94d746e22c$var$applicable(relativePath, directoryListing) &&
    !renderSingle
  )
    return {};
  let files = await handlers.readdir(absolutePath);
  const canRenderSingle = renderSingle && files.length === 1;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const filePath = $dmXIQ$path.resolve(absolutePath, file);
    const details = $dmXIQ$path.parse(filePath);
    // It's important to indicate that the `stat` call was
    // spawned by the directory listing, as Now is
    // simulating those calls and needs to special-case this.
    let stats = null;
    if (methods.lstat) stats = await handlers.lstat(filePath, true);
    else stats = await handlers.lstat(filePath);
    details.relative = $dmXIQ$path.join(relativePath, details.base);
    if (stats.isDirectory()) {
      details.base += slashSuffix;
      details.relative += slashSuffix;
      details.type = 'folder';
    } else {
      if (canRenderSingle)
        return {
          singleFile: true,
          absolutePath: filePath,
          stats: stats,
        };
      details.ext = details.ext.split('.')[1] || 'txt';
      details.type = 'file';
      details.size = $fdff5ecc5445b5d0$exports(stats.size, {
        unitSeparator: ' ',
        decimalPlaces: 0,
      });
    }
    details.title = details.base;
    if ($116f4e94d746e22c$var$canBeListed(excluded, file))
      files[index] = details;
    else delete files[index];
  }
  const toRoot = $dmXIQ$path.relative(current, absolutePath);
  const directory = $dmXIQ$path.join(
    $dmXIQ$path.basename(current),
    toRoot,
    slashSuffix,
  );
  const pathParts = directory.split($dmXIQ$path.sep).filter(Boolean);
  // Sort to list directories first, then sort alphabetically
  files = files
    .sort((a, b) => {
      const aIsDir = a.type === 'directory';
      const bIsDir = b.type === 'directory';
      /* istanbul ignore next */ if (aIsDir && !bIsDir) return -1;
      if ((bIsDir && !aIsDir) || a.base > b.base) return 1;
      /* istanbul ignore next */ if (a.base < b.base) return -1;
      /* istanbul ignore next */ return 0;
    })
    .filter(Boolean);
  // Add parent directory to the head of the sorted files array
  if (toRoot.length > 0) {
    const directoryPath = [...pathParts].slice(1);
    const relative = $dmXIQ$path.join('/', ...directoryPath, '..', slashSuffix);
    files.unshift({
      type: 'directory',
      base: '..',
      relative: relative,
      title: relative,
      ext: '',
    });
  }
  const subPaths = [];
  for (let index = 0; index < pathParts.length; index++) {
    const parents = [];
    const isLast = index === pathParts.length - 1;
    let before = 0;
    while (before <= index) {
      parents.push(pathParts[before]);
      before++;
    }
    parents.shift();
    subPaths.push({
      name: pathParts[index] + (isLast ? slashSuffix : '/'),
      url: index === 0 ? '' : parents.join('/') + slashSuffix,
    });
  }
  const spec = {
    files: files,
    directory: directory,
    paths: subPaths,
  };
  const output = acceptsJSON
    ? JSON.stringify(spec)
    : $870c34b85aa551bd$exports(spec);
  return {
    directory: output,
  };
};
const $116f4e94d746e22c$var$sendError = async (
  absolutePath,
  response,
  acceptsJSON,
  current,
  handlers,
  config,
  spec,
) => {
  const {
    err: original,
    message: message,
    code: code,
    statusCode: statusCode,
  } = spec;
  /* istanbul ignore next */ if (original && process.env.NODE_ENV !== 'test')
    console.error(original);
  response.statusCode = statusCode;
  if (acceptsJSON) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        error: {
          code: code,
          message: message,
        },
      }),
    );
    return;
  }
  let stats = null;
  const errorPage = $dmXIQ$path.join(current, `${statusCode}.html`);
  try {
    stats = await handlers.lstat(errorPage);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(err);
  }
  if (stats) {
    let stream = null;
    try {
      stream = await handlers.createReadStream(errorPage);
      const headers = await $116f4e94d746e22c$var$getHeaders(
        handlers,
        config,
        current,
        errorPage,
        stats,
      );
      response.writeHead(statusCode, headers);
      stream.pipe(response);
      return;
    } catch (err) {
      console.error(err);
    }
  }
  const headers = await $116f4e94d746e22c$var$getHeaders(
    handlers,
    config,
    current,
    absolutePath,
    null,
  );
  headers['Content-Type'] = 'text/html; charset=utf-8';
  response.writeHead(statusCode, headers);
  response.end(
    $08fb6c9d068d59cd$exports({
      statusCode: statusCode,
      message: message,
    }),
  );
};
const $116f4e94d746e22c$var$internalError = async (...args) => {
  const lastIndex = args.length - 1;
  const err = args[lastIndex];
  args[lastIndex] = {
    statusCode: 500,
    code: 'internal_server_error',
    message: 'A server error has occurred',
    err: err,
  };
  return $116f4e94d746e22c$var$sendError(...args);
};
const $116f4e94d746e22c$var$getHandlers = methods =>
  Object.assign(
    {
      lstat: $116f4e94d746e22c$require$promisify(
        $116f4e94d746e22c$require$lstat,
      ),
      realpath: $116f4e94d746e22c$require$promisify(
        $116f4e94d746e22c$require$realpath,
      ),
      createReadStream: $116f4e94d746e22c$require$createReadStream,
      readdir: $116f4e94d746e22c$require$promisify(
        $116f4e94d746e22c$require$readdir,
      ),
      sendError: $116f4e94d746e22c$var$sendError,
    },
    methods,
  );
$116f4e94d746e22c$exports = async (
  request,
  response,
  config = {},
  methods = {},
) => {
  const cwd = process.cwd();
  const current = config.public ? $dmXIQ$path.resolve(cwd, config.public) : cwd;
  const handlers = $116f4e94d746e22c$var$getHandlers(methods);
  let relativePath = null;
  let acceptsJSON = null;
  if (request.headers.accept)
    acceptsJSON = request.headers.accept.includes('application/json');
  try {
    relativePath = decodeURIComponent(
      $098e6ad56edac974$exports.parse(request.url).pathname,
    );
  } catch (err) {
    return $116f4e94d746e22c$var$sendError(
      '/',
      response,
      acceptsJSON,
      current,
      handlers,
      config,
      {
        statusCode: 400,
        code: 'bad_request',
        message: 'Bad Request',
      },
    );
  }
  let absolutePath = $dmXIQ$path.join(current, relativePath);
  // Prevent path traversal vulnerabilities. We could do this
  // by ourselves, but using the package covers all the edge cases.
  if (!$2d2fdcef4a143ca2$exports(absolutePath, current))
    return $116f4e94d746e22c$var$sendError(
      absolutePath,
      response,
      acceptsJSON,
      current,
      handlers,
      config,
      {
        statusCode: 400,
        code: 'bad_request',
        message: 'Bad Request',
      },
    );
  const cleanUrl = $116f4e94d746e22c$var$applicable(
    relativePath,
    config.cleanUrls,
  );
  const redirect = $116f4e94d746e22c$var$shouldRedirect(
    relativePath,
    config,
    cleanUrl,
  );
  if (redirect) {
    response.writeHead(redirect.statusCode, {
      Location: encodeURI(redirect.target),
    });
    response.end();
    return;
  }
  let stats = null;
  // It's extremely important that we're doing multiple stat calls. This one
  // right here could technically be removed, but then the program
  // would be slower. Because for directories, we always want to see if a related file
  // exists and then (after that), fetch the directory itself if no
  // related file was found. However (for files, of which most have extensions), we should
  // always stat right away.
  //
  // When simulating a file system without directory indexes, calculating whether a
  // directory exists requires loading all the file paths and then checking if
  // one of them includes the path of the directory. As that's a very
  // performance-expensive thing to do, we need to ensure it's not happening if not really necessary.
  if ($dmXIQ$path.extname(relativePath) !== '')
    try {
      stats = await handlers.lstat(absolutePath);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')
        return $116f4e94d746e22c$var$internalError(
          absolutePath,
          response,
          acceptsJSON,
          current,
          handlers,
          config,
          err,
        );
    }
  const rewrittenPath = $116f4e94d746e22c$var$applyRewrites(
    relativePath,
    config.rewrites,
  );
  if (!stats && (cleanUrl || rewrittenPath))
    try {
      const related = await $116f4e94d746e22c$var$findRelated(
        current,
        relativePath,
        rewrittenPath,
        handlers.lstat,
      );
      if (related) ({stats: stats, absolutePath: absolutePath} = related);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')
        return $116f4e94d746e22c$var$internalError(
          absolutePath,
          response,
          acceptsJSON,
          current,
          handlers,
          config,
          err,
        );
    }
  if (!stats)
    try {
      stats = await handlers.lstat(absolutePath);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')
        return $116f4e94d746e22c$var$internalError(
          absolutePath,
          response,
          acceptsJSON,
          current,
          handlers,
          config,
          err,
        );
    }
  if (stats && stats.isDirectory()) {
    let directory = null;
    let singleFile = null;
    try {
      const related = await $116f4e94d746e22c$var$renderDirectory(
        current,
        acceptsJSON,
        handlers,
        methods,
        config,
        {
          relativePath: relativePath,
          absolutePath: absolutePath,
        },
      );
      if (related.singleFile)
        ({
          stats: stats,
          absolutePath: absolutePath,
          singleFile: singleFile,
        } = related);
      else ({directory: directory} = related);
    } catch (err) {
      if (err.code !== 'ENOENT')
        return $116f4e94d746e22c$var$internalError(
          absolutePath,
          response,
          acceptsJSON,
          current,
          handlers,
          config,
          err,
        );
    }
    if (directory) {
      const contentType = acceptsJSON
        ? 'application/json; charset=utf-8'
        : 'text/html; charset=utf-8';
      response.statusCode = 200;
      response.setHeader('Content-Type', contentType);
      response.end(directory);
      return;
    }
    if (!singleFile)
      // The directory listing is disabled, so we want to
      // render a 404 error.
      stats = null;
  }
  const isSymLink = stats && stats.isSymbolicLink();
  // There are two scenarios in which we want to reply with
  // a 404 error: Either the path does not exist, or it is a
  // symlink while the `symlinks` option is disabled (which it is by default).
  if (!stats || (!config.symlinks && isSymLink))
    // allow for custom 404 handling
    return handlers.sendError(
      absolutePath,
      response,
      acceptsJSON,
      current,
      handlers,
      config,
      {
        statusCode: 404,
        code: 'not_found',
        message: 'The requested path could not be found',
      },
    );
  // If we figured out that the target is a symlink, we need to
  // resolve the symlink and run a new `stat` call just for the
  // target of that symlink.
  if (isSymLink) {
    absolutePath = await handlers.realpath(absolutePath);
    stats = await handlers.lstat(absolutePath);
  }
  const streamOpts = {};
  // TODO ? if-range
  if (request.headers.range && stats.size) {
    const range = $82178867fb5c36c1$exports(stats.size, request.headers.range);
    if (typeof range === 'object' && range.type === 'bytes') {
      const {start: start, end: end} = range[0];
      streamOpts.start = start;
      streamOpts.end = end;
      response.statusCode = 206;
    } else {
      response.statusCode = 416;
      response.setHeader('Content-Range', `bytes */${stats.size}`);
    }
  }
  // TODO ? multiple ranges
  let stream = null;
  try {
    stream = await handlers.createReadStream(absolutePath, streamOpts);
  } catch (err) {
    return $116f4e94d746e22c$var$internalError(
      absolutePath,
      response,
      acceptsJSON,
      current,
      handlers,
      config,
      err,
    );
  }
  const headers = await $116f4e94d746e22c$var$getHeaders(
    handlers,
    config,
    current,
    absolutePath,
    stats,
  );
  // eslint-disable-next-line no-undefined
  if (streamOpts.start !== undefined && streamOpts.end !== undefined) {
    headers[
      'Content-Range'
    ] = `bytes ${streamOpts.start}-${streamOpts.end}/${stats.size}`;
    headers['Content-Length'] = streamOpts.end - streamOpts.start + 1;
  }
  // We need to check for `headers.ETag` being truthy first, otherwise it will
  // match `undefined` being equal to `undefined`, which is true.
  //
  // Checking for `undefined` and `null` is also important, because `Range` can be `0`.
  //
  // eslint-disable-next-line no-eq-null
  if (
    request.headers.range == null &&
    headers.ETag &&
    headers.ETag === request.headers['if-none-match']
  ) {
    response.statusCode = 304;
    response.end();
    return;
  }
  response.writeHead(response.statusCode || 200, headers);
  stream.pipe(response);
};

var $1187a10c6610a8e2$exports = {};
('use strict');
var $1187a10c6610a8e2$var$__createBinding =
  ($1187a10c6610a8e2$exports && $1187a10c6610a8e2$exports.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        Object.defineProperty(o, k2, {
          enumerable: true,
          get: function () {
            return m[k];
          },
        });
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var $1187a10c6610a8e2$var$__exportStar =
  ($1187a10c6610a8e2$exports && $1187a10c6610a8e2$exports.__exportStar) ||
  function (m, exports1) {
    for (var p in m)
      if (p !== 'default' && !Object.prototype.hasOwnProperty.call(exports1, p))
        $1187a10c6610a8e2$var$__createBinding(exports1, m, p);
  };
Object.defineProperty($1187a10c6610a8e2$exports, '__esModule', {
  value: true,
});
$1187a10c6610a8e2$exports.createProxyMiddleware = void 0;
var $777aaad70a8a131c$exports = {};
('use strict');
Object.defineProperty($777aaad70a8a131c$exports, '__esModule', {
  value: true,
});
$777aaad70a8a131c$exports.HttpProxyMiddleware = void 0;
var $d9f6cbf005f2e99f$exports = {};
/*!
 * Caron dimonio, con occhi di bragia
 * loro accennando, tutte le raccoglie;
 * batte col remo qualunque s’adagia
 *
 * Charon the demon, with the eyes of glede,
 * Beckoning to them, collects them all together,
 * Beats with his oar whoever lags behind
 *
 *          Dante - The Divine Comedy (Canto III)
 */
$d9f6cbf005f2e99f$exports = parcelRequire('l3tNL');

var $34744099e9c3c26e$exports = {};
('use strict');
Object.defineProperty($34744099e9c3c26e$exports, '__esModule', {
  value: true,
});
$34744099e9c3c26e$exports.createConfig = void 0;
var $8d30fd8601ad87a1$exports = {};
('use strict');
$8d30fd8601ad87a1$exports = value => {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};

var $f9731ec128d117f1$exports = {};
('use strict');
Object.defineProperty($f9731ec128d117f1$exports, '__esModule', {
  value: true,
});
$f9731ec128d117f1$exports.ERRORS = void 0;
var $f9731ec128d117f1$var$ERRORS;
(function (ERRORS) {
  ERRORS['ERR_CONFIG_FACTORY_TARGET_MISSING'] =
    '[HPM] Missing "target" option. Example: {target: "http://www.example.org"}';
  ERRORS['ERR_CONTEXT_MATCHER_GENERIC'] =
    '[HPM] Invalid context. Expecting something like: "/api" or ["/api", "/ajax"]';
  ERRORS['ERR_CONTEXT_MATCHER_INVALID_ARRAY'] =
    '[HPM] Invalid context. Expecting something like: ["/api", "/ajax"] or ["/api/**", "!**.html"]';
  ERRORS['ERR_PATH_REWRITER_CONFIG'] =
    '[HPM] Invalid pathRewrite config. Expecting object with pathRewrite config or a rewrite function';
})(
  ($f9731ec128d117f1$var$ERRORS =
    $f9731ec128d117f1$exports.ERRORS ||
    ($f9731ec128d117f1$exports.ERRORS = {})),
);

var $bbac356002fc3db4$exports = {};
('use strict');
/* eslint-disable prefer-rest-params */ Object.defineProperty(
  $bbac356002fc3db4$exports,
  '__esModule',
  {
    value: true,
  },
);
$bbac356002fc3db4$exports.getArrow = $bbac356002fc3db4$exports.getInstance =
  void 0;

let $bbac356002fc3db4$var$loggerInstance;
const $bbac356002fc3db4$var$defaultProvider = {
  // tslint:disable: no-console
  log: console.log,
  debug: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
// log level 'weight'
var $bbac356002fc3db4$var$LEVELS;
(function (LEVELS) {
  LEVELS[(LEVELS['debug'] = 10)] = 'debug';
  LEVELS[(LEVELS['info'] = 20)] = 'info';
  LEVELS[(LEVELS['warn'] = 30)] = 'warn';
  LEVELS[(LEVELS['error'] = 50)] = 'error';
  LEVELS[(LEVELS['silent'] = 80)] = 'silent';
})($bbac356002fc3db4$var$LEVELS || ($bbac356002fc3db4$var$LEVELS = {}));
function $bbac356002fc3db4$var$getInstance() {
  if (!$bbac356002fc3db4$var$loggerInstance)
    $bbac356002fc3db4$var$loggerInstance = new $bbac356002fc3db4$var$Logger();
  return $bbac356002fc3db4$var$loggerInstance;
}
$bbac356002fc3db4$exports.getInstance = $bbac356002fc3db4$var$getInstance;
class $bbac356002fc3db4$var$Logger {
  constructor() {
    this.setLevel('info');
    this.setProvider(() => $bbac356002fc3db4$var$defaultProvider);
  }
  // log will log messages, regardless of logLevels
  log() {
    this.provider.log(this._interpolate.apply(null, arguments));
  }
  debug() {
    if (this._showLevel('debug'))
      this.provider.debug(this._interpolate.apply(null, arguments));
  }
  info() {
    if (this._showLevel('info'))
      this.provider.info(this._interpolate.apply(null, arguments));
  }
  warn() {
    if (this._showLevel('warn'))
      this.provider.warn(this._interpolate.apply(null, arguments));
  }
  error() {
    if (this._showLevel('error'))
      this.provider.error(this._interpolate.apply(null, arguments));
  }
  setLevel(v) {
    if (this.isValidLevel(v)) this.logLevel = v;
  }
  setProvider(fn) {
    if (fn && this.isValidProvider(fn))
      this.provider = fn($bbac356002fc3db4$var$defaultProvider);
  }
  isValidProvider(fnProvider) {
    const result = true;
    if (fnProvider && typeof fnProvider !== 'function')
      throw new Error('[HPM] Log provider config error. Expecting a function.');
    return result;
  }
  isValidLevel(levelName) {
    const validLevels = Object.keys($bbac356002fc3db4$var$LEVELS);
    const isValid = validLevels.includes(levelName);
    if (!isValid) throw new Error('[HPM] Log level error. Invalid logLevel.');
    return isValid;
  }
  /**
   * Decide to log or not to log, based on the log levels 'weight'
   * @param  {String}  showLevel [debug, info, warn, error, silent]
   * @return {Boolean}
   */ _showLevel(showLevel) {
    let result = false;
    const currentLogLevel = $bbac356002fc3db4$var$LEVELS[this.logLevel];
    if (
      currentLogLevel &&
      currentLogLevel <= $bbac356002fc3db4$var$LEVELS[showLevel]
    )
      result = true;
    return result;
  }
  // make sure logged messages and its data are return interpolated
  // make it possible for additional log data, such date/time or custom prefix.
  _interpolate(format, ...args) {
    const result = $dmXIQ$util.format(format, ...args);
    return result;
  }
}
/**
 * -> normal proxy
 * => router
 * ~> pathRewrite
 * ≈> router + pathRewrite
 *
 * @param  {String} originalPath
 * @param  {String} newPath
 * @param  {String} originalTarget
 * @param  {String} newTarget
 * @return {String}
 */ function $bbac356002fc3db4$var$getArrow(
  originalPath,
  newPath,
  originalTarget,
  newTarget,
) {
  const arrow = ['>'];
  const isNewTarget = originalTarget !== newTarget; // router
  const isNewPath = originalPath !== newPath; // pathRewrite
  if (isNewPath && !isNewTarget) arrow.unshift('~');
  else if (!isNewPath && isNewTarget) arrow.unshift('=');
  else if (isNewPath && isNewTarget) arrow.unshift('\u2248');
  else arrow.unshift('-');
  return arrow.join('');
}
$bbac356002fc3db4$exports.getArrow = $bbac356002fc3db4$var$getArrow;

const $34744099e9c3c26e$var$logger = $bbac356002fc3db4$exports.getInstance();
function $34744099e9c3c26e$var$createConfig(context, opts) {
  // structure of config object to be returned
  const config = {
    context: undefined,
    options: {},
  };
  // app.use('/api', proxy({target:'http://localhost:9000'}));
  if ($34744099e9c3c26e$var$isContextless(context, opts)) {
    config.context = '/';
    config.options = Object.assign(config.options, context);
    // app.use('/api', proxy('http://localhost:9000'));
    // app.use(proxy('http://localhost:9000/api'));
  } else if ($34744099e9c3c26e$var$isStringShortHand(context)) {
    const oUrl = $dmXIQ$url.parse(context);
    const target = [oUrl.protocol, '//', oUrl.host].join('');
    config.context = oUrl.pathname || '/';
    config.options = Object.assign(
      config.options,
      {
        target: target,
      },
      opts,
    );
    if (oUrl.protocol === 'ws:' || oUrl.protocol === 'wss:')
      config.options.ws = true;
    // app.use('/api', proxy({target:'http://localhost:9000'}));
  } else {
    config.context = context;
    config.options = Object.assign(config.options, opts);
  }
  $34744099e9c3c26e$var$configureLogger(config.options);
  if (!config.options.target && !config.options.router)
    throw new Error(
      $f9731ec128d117f1$exports.ERRORS.ERR_CONFIG_FACTORY_TARGET_MISSING,
    );
  return config;
}
$34744099e9c3c26e$exports.createConfig = $34744099e9c3c26e$var$createConfig;
/**
 * Checks if a String only target/config is provided.
 * This can be just the host or with the optional path.
 *
 * @example
 *      app.use('/api', proxy('http://localhost:9000'));
 *      app.use(proxy('http://localhost:9000/api'));
 *
 * @param  {String}  context [description]
 * @return {Boolean}         [description]
 */ function $34744099e9c3c26e$var$isStringShortHand(context) {
  if (typeof context === 'string') return !!$dmXIQ$url.parse(context).host;
}
/**
 * Checks if a Object only config is provided, without a context.
 * In this case the all paths will be proxied.
 *
 * @example
 *     app.use('/api', proxy({target:'http://localhost:9000'}));
 *
 * @param  {Object}  context [description]
 * @param  {*}       opts    [description]
 * @return {Boolean}         [description]
 */ function $34744099e9c3c26e$var$isContextless(context, opts) {
  return (
    $8d30fd8601ad87a1$exports(context) &&
    (opts == null || Object.keys(opts).length === 0)
  );
}
function $34744099e9c3c26e$var$configureLogger(options) {
  if (options.logLevel) $34744099e9c3c26e$var$logger.setLevel(options.logLevel);
  if (options.logProvider)
    $34744099e9c3c26e$var$logger.setProvider(options.logProvider);
}

var $c46addb07fb049eb$exports = {};
('use strict');
Object.defineProperty($c46addb07fb049eb$exports, '__esModule', {
  value: true,
});
$c46addb07fb049eb$exports.match = void 0;
var $fbfd7e3db3573eb8$exports = {};
/*!
 * is-glob <https://github.com/jonschlinkert/is-glob>
 *
 * Copyright (c) 2014-2017, Jon Schlinkert.
 * Released under the MIT License.
 */ var $9f574206a1c3e380$exports = {};
/*!
 * is-extglob <https://github.com/jonschlinkert/is-extglob>
 *
 * Copyright (c) 2014-2016, Jon Schlinkert.
 * Licensed under the MIT License.
 */ $9f574206a1c3e380$exports = function isExtglob(str) {
  if (typeof str !== 'string' || str === '') return false;
  var match;
  while ((match = /(\\).|([@?!+*]\(.*\))/g.exec(str))) {
    if (match[2]) return true;
    str = str.slice(match.index + match[0].length);
  }
  return false;
};

var $fbfd7e3db3573eb8$var$chars = {
  '{': '}',
  '(': ')',
  '[': ']',
};
var $fbfd7e3db3573eb8$var$strictCheck = function (str) {
  if (str[0] === '!') return true;
  var index = 0;
  var pipeIndex = -2;
  var closeSquareIndex = -2;
  var closeCurlyIndex = -2;
  var closeParenIndex = -2;
  var backSlashIndex = -2;
  while (index < str.length) {
    if (str[index] === '*') return true;
    if (str[index + 1] === '?' && /[\].+)]/.test(str[index])) return true;
    if (
      closeSquareIndex !== -1 &&
      str[index] === '[' &&
      str[index + 1] !== ']'
    ) {
      if (closeSquareIndex < index) closeSquareIndex = str.indexOf(']', index);
      if (closeSquareIndex > index) {
        if (backSlashIndex === -1 || backSlashIndex > closeSquareIndex)
          return true;
        backSlashIndex = str.indexOf('\\', index);
        if (backSlashIndex === -1 || backSlashIndex > closeSquareIndex)
          return true;
      }
    }
    if (
      closeCurlyIndex !== -1 &&
      str[index] === '{' &&
      str[index + 1] !== '}'
    ) {
      closeCurlyIndex = str.indexOf('}', index);
      if (closeCurlyIndex > index) {
        backSlashIndex = str.indexOf('\\', index);
        if (backSlashIndex === -1 || backSlashIndex > closeCurlyIndex)
          return true;
      }
    }
    if (
      closeParenIndex !== -1 &&
      str[index] === '(' &&
      str[index + 1] === '?' &&
      /[:!=]/.test(str[index + 2]) &&
      str[index + 3] !== ')'
    ) {
      closeParenIndex = str.indexOf(')', index);
      if (closeParenIndex > index) {
        backSlashIndex = str.indexOf('\\', index);
        if (backSlashIndex === -1 || backSlashIndex > closeParenIndex)
          return true;
      }
    }
    if (pipeIndex !== -1 && str[index] === '(' && str[index + 1] !== '|') {
      if (pipeIndex < index) pipeIndex = str.indexOf('|', index);
      if (pipeIndex !== -1 && str[pipeIndex + 1] !== ')') {
        closeParenIndex = str.indexOf(')', pipeIndex);
        if (closeParenIndex > pipeIndex) {
          backSlashIndex = str.indexOf('\\', pipeIndex);
          if (backSlashIndex === -1 || backSlashIndex > closeParenIndex)
            return true;
        }
      }
    }
    if (str[index] === '\\') {
      var open = str[index + 1];
      index += 2;
      var close = $fbfd7e3db3573eb8$var$chars[open];
      if (close) {
        var n = str.indexOf(close, index);
        if (n !== -1) index = n + 1;
      }
      if (str[index] === '!') return true;
    } else index++;
  }
  return false;
};
var $fbfd7e3db3573eb8$var$relaxedCheck = function (str) {
  if (str[0] === '!') return true;
  var index = 0;
  while (index < str.length) {
    if (/[*?{}()[\]]/.test(str[index])) return true;
    if (str[index] === '\\') {
      var open = str[index + 1];
      index += 2;
      var close = $fbfd7e3db3573eb8$var$chars[open];
      if (close) {
        var n = str.indexOf(close, index);
        if (n !== -1) index = n + 1;
      }
      if (str[index] === '!') return true;
    } else index++;
  }
  return false;
};
$fbfd7e3db3573eb8$exports = function isGlob(str, options) {
  if (typeof str !== 'string' || str === '') return false;
  if ($9f574206a1c3e380$exports(str)) return true;
  var check = $fbfd7e3db3573eb8$var$strictCheck;
  // optionally relax check
  if (options && options.strict === false)
    check = $fbfd7e3db3573eb8$var$relaxedCheck;
  return check(str);
};

var $1a9bcb9566a84ee7$exports = {};
('use strict');

var $aa8a71cee8fec249$exports = {};
('use strict');
var $a029327b5d06ba8d$exports = {};
('use strict');
var $1821b2ec65ef4d98$export$a287f47fed4544b8;
/**
 * Find a node of the given type
 */ var $1821b2ec65ef4d98$export$71aa6c912b956294;
/**
 * Find a node of the given type
 */ var $1821b2ec65ef4d98$export$fbadac39f36b1e16;
/**
 * Escape the given node with '\\' before node.value
 */ var $1821b2ec65ef4d98$export$92e39b1e2c1e6e56;
/**
 * Returns true if the given brace node should be enclosed in literal braces
 */ var $1821b2ec65ef4d98$export$ea0f721b77fd5acc;
/**
 * Returns true if a brace node is invalid.
 */ var $1821b2ec65ef4d98$export$25a78c310c11373f;
/**
 * Returns true if a node is an open or close node
 */ var $1821b2ec65ef4d98$export$582fc44003e67ec6;
/**
 * Reduce an array of text nodes.
 */ var $1821b2ec65ef4d98$export$533b26079ad0b4b;
/**
 * Flatten an array
 */ var $1821b2ec65ef4d98$export$bffa455ba8c619a6;
('use strict');
$1821b2ec65ef4d98$export$a287f47fed4544b8 = num => {
  if (typeof num === 'number') return Number.isInteger(num);
  if (typeof num === 'string' && num.trim() !== '')
    return Number.isInteger(Number(num));
  return false;
};
$1821b2ec65ef4d98$export$71aa6c912b956294 = (node, type) =>
  node.nodes.find(node => node.type === type);
$1821b2ec65ef4d98$export$fbadac39f36b1e16 = (min, max, step = 1, limit) => {
  if (limit === false) return false;
  if (
    !$1821b2ec65ef4d98$export$a287f47fed4544b8(min) ||
    !$1821b2ec65ef4d98$export$a287f47fed4544b8(max)
  )
    return false;
  return (Number(max) - Number(min)) / Number(step) >= limit;
};
$1821b2ec65ef4d98$export$92e39b1e2c1e6e56 = (block, n = 0, type) => {
  let node = block.nodes[n];
  if (!node) return;
  if (
    (type && node.type === type) ||
    node.type === 'open' ||
    node.type === 'close'
  ) {
    if (node.escaped !== true) {
      node.value = '\\' + node.value;
      node.escaped = true;
    }
  }
};
$1821b2ec65ef4d98$export$ea0f721b77fd5acc = node => {
  if (node.type !== 'brace') return false;
  if ((node.commas >> (0 + node.ranges)) >> 0 === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};
$1821b2ec65ef4d98$export$25a78c310c11373f = block => {
  if (block.type !== 'brace') return false;
  if (block.invalid === true || block.dollar) return true;
  if ((block.commas >> (0 + block.ranges)) >> 0 === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};
$1821b2ec65ef4d98$export$582fc44003e67ec6 = node => {
  if (node.type === 'open' || node.type === 'close') return true;
  return node.open === true || node.close === true;
};
$1821b2ec65ef4d98$export$533b26079ad0b4b = nodes =>
  nodes.reduce((acc, node) => {
    if (node.type === 'text') acc.push(node.value);
    if (node.type === 'range') node.type = 'text';
    return acc;
  }, []);
$1821b2ec65ef4d98$export$bffa455ba8c619a6 = (...args) => {
  const result = [];
  const flat = arr => {
    for (let i = 0; i < arr.length; i++) {
      let ele = arr[i];
      Array.isArray(ele)
        ? flat(ele, result)
        : ele !== void 0 && result.push(ele);
    }
    return result;
  };
  flat(args);
  return result;
};

$a029327b5d06ba8d$exports = (ast, options = {}) => {
  let stringify = (node, parent = {}) => {
    let invalidBlock =
      options.escapeInvalid &&
      $1821b2ec65ef4d98$export$25a78c310c11373f(parent);
    let invalidNode = node.invalid === true && options.escapeInvalid === true;
    let output = '';
    if (node.value) {
      if (
        (invalidBlock || invalidNode) &&
        $1821b2ec65ef4d98$export$582fc44003e67ec6(node)
      )
        return '\\' + node.value;
      return node.value;
    }
    if (node.value) return node.value;
    if (node.nodes) for (let child of node.nodes) output += stringify(child);
    return output;
  };
  return stringify(ast);
};

var $3e51fb4d64680808$exports = {};
('use strict');
var $fdedd8b9f143315a$exports = {};
/*!
 * fill-range <https://github.com/jonschlinkert/fill-range>
 *
 * Copyright (c) 2014-present, Jon Schlinkert.
 * Licensed under the MIT License.
 */ ('use strict');

var $667eebd4a1a1794c$exports = {};
/*!
 * to-regex-range <https://github.com/micromatch/to-regex-range>
 *
 * Copyright (c) 2015-present, Jon Schlinkert.
 * Released under the MIT License.
 */ ('use strict');
var $edb026303077abad$exports = {};
/*!
 * is-number <https://github.com/jonschlinkert/is-number>
 *
 * Copyright (c) 2014-present, Jon Schlinkert.
 * Released under the MIT License.
 */ ('use strict');
$edb026303077abad$exports = function (num) {
  if (typeof num === 'number') return num - num === 0;
  if (typeof num === 'string' && num.trim() !== '')
    return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);
  return false;
};

const $667eebd4a1a1794c$var$toRegexRange = (min, max, options) => {
  if ($edb026303077abad$exports(min) === false)
    throw new TypeError(
      'toRegexRange: expected the first argument to be a number',
    );
  if (max === void 0 || min === max) return String(min);
  if ($edb026303077abad$exports(max) === false)
    throw new TypeError(
      'toRegexRange: expected the second argument to be a number.',
    );
  let opts = {
    relaxZeros: true,
    ...options,
  };
  if (typeof opts.strictZeros === 'boolean')
    opts.relaxZeros = opts.strictZeros === false;
  let relax = String(opts.relaxZeros);
  let shorthand = String(opts.shorthand);
  let capture = String(opts.capture);
  let wrap = String(opts.wrap);
  let cacheKey = min + ':' + max + '=' + relax + shorthand + capture + wrap;
  if ($667eebd4a1a1794c$var$toRegexRange.cache.hasOwnProperty(cacheKey))
    return $667eebd4a1a1794c$var$toRegexRange.cache[cacheKey].result;
  let a = Math.min(min, max);
  let b = Math.max(min, max);
  if (Math.abs(a - b) === 1) {
    let result = min + '|' + max;
    if (opts.capture) return `(${result})`;
    if (opts.wrap === false) return result;
    return `(?:${result})`;
  }
  let isPadded =
    $667eebd4a1a1794c$var$hasPadding(min) ||
    $667eebd4a1a1794c$var$hasPadding(max);
  let state = {
    min: min,
    max: max,
    a: a,
    b: b,
  };
  let positives = [];
  let negatives = [];
  if (isPadded) {
    state.isPadded = isPadded;
    state.maxLen = String(state.max).length;
  }
  if (a < 0) {
    let newMin = b < 0 ? Math.abs(b) : 1;
    negatives = $667eebd4a1a1794c$var$splitToPatterns(
      newMin,
      Math.abs(a),
      state,
      opts,
    );
    a = state.a = 0;
  }
  if (b >= 0)
    positives = $667eebd4a1a1794c$var$splitToPatterns(a, b, state, opts);
  state.negatives = negatives;
  state.positives = positives;
  state.result = $667eebd4a1a1794c$var$collatePatterns(
    negatives,
    positives,
    opts,
  );
  if (opts.capture === true) state.result = `(${state.result})`;
  else if (opts.wrap !== false && positives.length + negatives.length > 1)
    state.result = `(?:${state.result})`;
  $667eebd4a1a1794c$var$toRegexRange.cache[cacheKey] = state;
  return state.result;
};
function $667eebd4a1a1794c$var$collatePatterns(neg, pos, options) {
  let onlyNegative =
    $667eebd4a1a1794c$var$filterPatterns(neg, pos, '-', false, options) || [];
  let onlyPositive =
    $667eebd4a1a1794c$var$filterPatterns(pos, neg, '', false, options) || [];
  let intersected =
    $667eebd4a1a1794c$var$filterPatterns(neg, pos, '-?', true, options) || [];
  let subpatterns = onlyNegative.concat(intersected).concat(onlyPositive);
  return subpatterns.join('|');
}
function $667eebd4a1a1794c$var$splitToRanges(min, max) {
  let nines = 1;
  let zeros = 1;
  let stop = $667eebd4a1a1794c$var$countNines(min, nines);
  let stops = new Set([max]);
  while (min <= stop && stop <= max) {
    stops.add(stop);
    nines += 1;
    stop = $667eebd4a1a1794c$var$countNines(min, nines);
  }
  stop = $667eebd4a1a1794c$var$countZeros(max + 1, zeros) - 1;
  while (min < stop && stop <= max) {
    stops.add(stop);
    zeros += 1;
    stop = $667eebd4a1a1794c$var$countZeros(max + 1, zeros) - 1;
  }
  stops = [...stops];
  stops.sort($667eebd4a1a1794c$var$compare);
  return stops;
}
/**
 * Convert a range to a regex pattern
 * @param {Number} `start`
 * @param {Number} `stop`
 * @return {String}
 */ function $667eebd4a1a1794c$var$rangeToPattern(start, stop, options) {
  if (start === stop)
    return {
      pattern: start,
      count: [],
      digits: 0,
    };
  let zipped = $667eebd4a1a1794c$var$zip(start, stop);
  let digits = zipped.length;
  let pattern = '';
  let count = 0;
  for (let i = 0; i < digits; i++) {
    let [startDigit, stopDigit] = zipped[i];
    if (startDigit === stopDigit) pattern += startDigit;
    else if (startDigit !== '0' || stopDigit !== '9')
      pattern += $667eebd4a1a1794c$var$toCharacterClass(
        startDigit,
        stopDigit,
        options,
      );
    else count++;
  }
  if (count) pattern += options.shorthand === true ? '\\d' : '[0-9]';
  return {
    pattern: pattern,
    count: [count],
    digits: digits,
  };
}
function $667eebd4a1a1794c$var$splitToPatterns(min, max, tok, options) {
  let ranges = $667eebd4a1a1794c$var$splitToRanges(min, max);
  let tokens = [];
  let start = min;
  let prev;
  for (let i = 0; i < ranges.length; i++) {
    let max = ranges[i];
    let obj = $667eebd4a1a1794c$var$rangeToPattern(
      String(start),
      String(max),
      options,
    );
    let zeros = '';
    if (!tok.isPadded && prev && prev.pattern === obj.pattern) {
      if (prev.count.length > 1) prev.count.pop();
      prev.count.push(obj.count[0]);
      prev.string =
        prev.pattern + $667eebd4a1a1794c$var$toQuantifier(prev.count);
      start = max + 1;
      continue;
    }
    if (tok.isPadded) zeros = $667eebd4a1a1794c$var$padZeros(max, tok, options);
    obj.string =
      zeros + obj.pattern + $667eebd4a1a1794c$var$toQuantifier(obj.count);
    tokens.push(obj);
    start = max + 1;
    prev = obj;
  }
  return tokens;
}
function $667eebd4a1a1794c$var$filterPatterns(
  arr,
  comparison,
  prefix,
  intersection,
  options,
) {
  let result = [];
  for (let ele of arr) {
    let {string: string} = ele;
    // only push if _both_ are negative...
    if (
      !intersection &&
      !$667eebd4a1a1794c$var$contains(comparison, 'string', string)
    )
      result.push(prefix + string);
    // or _both_ are positive
    if (
      intersection &&
      $667eebd4a1a1794c$var$contains(comparison, 'string', string)
    )
      result.push(prefix + string);
  }
  return result;
}
/**
 * Zip strings
 */ function $667eebd4a1a1794c$var$zip(a, b) {
  let arr = [];
  for (let i = 0; i < a.length; i++) arr.push([a[i], b[i]]);
  return arr;
}
function $667eebd4a1a1794c$var$compare(a, b) {
  return a > b ? 1 : b > a ? -1 : 0;
}
function $667eebd4a1a1794c$var$contains(arr, key, val) {
  return arr.some(ele => ele[key] === val);
}
function $667eebd4a1a1794c$var$countNines(min, len) {
  return Number(String(min).slice(0, -len) + '9'.repeat(len));
}
function $667eebd4a1a1794c$var$countZeros(integer, zeros) {
  return integer - (integer % Math.pow(10, zeros));
}
function $667eebd4a1a1794c$var$toQuantifier(digits) {
  let [start = 0, stop = ''] = digits;
  if (stop || start > 1) return `{${start + (stop ? ',' + stop : '')}}`;
  return '';
}
function $667eebd4a1a1794c$var$toCharacterClass(a, b, options) {
  return `[${a}${b - a === 1 ? '' : '-'}${b}]`;
}
function $667eebd4a1a1794c$var$hasPadding(str) {
  return /^-?(0+)\d/.test(str);
}
function $667eebd4a1a1794c$var$padZeros(value, tok, options) {
  if (!tok.isPadded) return value;
  let diff = Math.abs(tok.maxLen - String(value).length);
  let relax = options.relaxZeros !== false;
  switch (diff) {
    case 0:
      return '';
    case 1:
      return relax ? '0?' : '0';
    case 2:
      return relax ? '0{0,2}' : '00';
    default:
      return relax ? `0{0,${diff}}` : `0{${diff}}`;
  }
}
/**
 * Cache
 */ $667eebd4a1a1794c$var$toRegexRange.cache = {};
$667eebd4a1a1794c$var$toRegexRange.clearCache = () =>
  ($667eebd4a1a1794c$var$toRegexRange.cache = {});
/**
 * Expose `toRegexRange`
 */ $667eebd4a1a1794c$exports = $667eebd4a1a1794c$var$toRegexRange;

const $fdedd8b9f143315a$var$isObject = val =>
  val !== null && typeof val === 'object' && !Array.isArray(val);
const $fdedd8b9f143315a$var$transform = toNumber => {
  return value => (toNumber === true ? Number(value) : String(value));
};
const $fdedd8b9f143315a$var$isValidValue = value => {
  return (
    typeof value === 'number' || (typeof value === 'string' && value !== '')
  );
};
const $fdedd8b9f143315a$var$isNumber = num => Number.isInteger(+num);
const $fdedd8b9f143315a$var$zeros = input => {
  let value = `${input}`;
  let index = -1;
  if (value[0] === '-') value = value.slice(1);
  if (value === '0') return false;
  while (value[++index] === '0');
  return index > 0;
};
const $fdedd8b9f143315a$var$stringify = (start, end, options) => {
  if (typeof start === 'string' || typeof end === 'string') return true;
  return options.stringify === true;
};
const $fdedd8b9f143315a$var$pad = (input, maxLength, toNumber) => {
  if (maxLength > 0) {
    let dash = input[0] === '-' ? '-' : '';
    if (dash) input = input.slice(1);
    input = dash + input.padStart(dash ? maxLength - 1 : maxLength, '0');
  }
  if (toNumber === false) return String(input);
  return input;
};
const $fdedd8b9f143315a$var$toMaxLen = (input, maxLength) => {
  let negative = input[0] === '-' ? '-' : '';
  if (negative) {
    input = input.slice(1);
    maxLength--;
  }
  while (input.length < maxLength) input = '0' + input;
  return negative ? '-' + input : input;
};
const $fdedd8b9f143315a$var$toSequence = (parts, options) => {
  parts.negatives.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  parts.positives.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let prefix = options.capture ? '' : '?:';
  let positives = '';
  let negatives = '';
  let result;
  if (parts.positives.length) positives = parts.positives.join('|');
  if (parts.negatives.length)
    negatives = `-(${prefix}${parts.negatives.join('|')})`;
  if (positives && negatives) result = `${positives}|${negatives}`;
  else result = positives || negatives;
  if (options.wrap) return `(${prefix}${result})`;
  return result;
};
const $fdedd8b9f143315a$var$toRange = (a, b, isNumbers, options) => {
  if (isNumbers)
    return $667eebd4a1a1794c$exports(a, b, {
      wrap: false,
      ...options,
    });
  let start = String.fromCharCode(a);
  if (a === b) return start;
  let stop = String.fromCharCode(b);
  return `[${start}-${stop}]`;
};
const $fdedd8b9f143315a$var$toRegex = (start, end, options) => {
  if (Array.isArray(start)) {
    let wrap = options.wrap === true;
    let prefix = options.capture ? '' : '?:';
    return wrap ? `(${prefix}${start.join('|')})` : start.join('|');
  }
  return $667eebd4a1a1794c$exports(start, end, options);
};
const $fdedd8b9f143315a$var$rangeError = (...args) => {
  return new RangeError(
    'Invalid range arguments: ' + $dmXIQ$util.inspect(...args),
  );
};
const $fdedd8b9f143315a$var$invalidRange = (start, end, options) => {
  if (options.strictRanges === true)
    throw $fdedd8b9f143315a$var$rangeError([start, end]);
  return [];
};
const $fdedd8b9f143315a$var$invalidStep = (step, options) => {
  if (options.strictRanges === true)
    throw new TypeError(`Expected step "${step}" to be a number`);
  return [];
};
const $fdedd8b9f143315a$var$fillNumbers = (
  start,
  end,
  step = 1,
  options = {},
) => {
  let a = Number(start);
  let b = Number(end);
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    if (options.strictRanges === true)
      throw $fdedd8b9f143315a$var$rangeError([start, end]);
    return [];
  }
  // fix negative zero
  if (a === 0) a = 0;
  if (b === 0) b = 0;
  let descending = a > b;
  let startString = String(start);
  let endString = String(end);
  let stepString = String(step);
  step = Math.max(Math.abs(step), 1);
  let padded =
    $fdedd8b9f143315a$var$zeros(startString) ||
    $fdedd8b9f143315a$var$zeros(endString) ||
    $fdedd8b9f143315a$var$zeros(stepString);
  let maxLen = padded
    ? Math.max(startString.length, endString.length, stepString.length)
    : 0;
  let toNumber =
    padded === false &&
    $fdedd8b9f143315a$var$stringify(start, end, options) === false;
  let format = options.transform || $fdedd8b9f143315a$var$transform(toNumber);
  if (options.toRegex && step === 1)
    return $fdedd8b9f143315a$var$toRange(
      $fdedd8b9f143315a$var$toMaxLen(start, maxLen),
      $fdedd8b9f143315a$var$toMaxLen(end, maxLen),
      true,
      options,
    );
  let parts = {
    negatives: [],
    positives: [],
  };
  let push = num =>
    parts[num < 0 ? 'negatives' : 'positives'].push(Math.abs(num));
  let range = [];
  let index = 0;
  while (descending ? a >= b : a <= b) {
    if (options.toRegex === true && step > 1) push(a);
    else
      range.push($fdedd8b9f143315a$var$pad(format(a, index), maxLen, toNumber));
    a = descending ? a - step : a + step;
    index++;
  }
  if (options.toRegex === true)
    return step > 1
      ? $fdedd8b9f143315a$var$toSequence(parts, options)
      : $fdedd8b9f143315a$var$toRegex(range, null, {
          wrap: false,
          ...options,
        });
  return range;
};
const $fdedd8b9f143315a$var$fillLetters = (
  start,
  end,
  step = 1,
  options = {},
) => {
  if (
    (!$fdedd8b9f143315a$var$isNumber(start) && start.length > 1) ||
    (!$fdedd8b9f143315a$var$isNumber(end) && end.length > 1)
  )
    return $fdedd8b9f143315a$var$invalidRange(start, end, options);
  let format = options.transform || (val => String.fromCharCode(val));
  let a = `${start}`.charCodeAt(0);
  let b = `${end}`.charCodeAt(0);
  let descending = a > b;
  let min = Math.min(a, b);
  let max = Math.max(a, b);
  if (options.toRegex && step === 1)
    return $fdedd8b9f143315a$var$toRange(min, max, false, options);
  let range = [];
  let index = 0;
  while (descending ? a >= b : a <= b) {
    range.push(format(a, index));
    a = descending ? a - step : a + step;
    index++;
  }
  if (options.toRegex === true)
    return $fdedd8b9f143315a$var$toRegex(range, null, {
      wrap: false,
      options: options,
    });
  return range;
};
const $fdedd8b9f143315a$var$fill = (start, end, step, options = {}) => {
  if (end == null && $fdedd8b9f143315a$var$isValidValue(start)) return [start];
  if (
    !$fdedd8b9f143315a$var$isValidValue(start) ||
    !$fdedd8b9f143315a$var$isValidValue(end)
  )
    return $fdedd8b9f143315a$var$invalidRange(start, end, options);
  if (typeof step === 'function')
    return $fdedd8b9f143315a$var$fill(start, end, 1, {
      transform: step,
    });
  if ($fdedd8b9f143315a$var$isObject(step))
    return $fdedd8b9f143315a$var$fill(start, end, 0, step);
  let opts = {
    ...options,
  };
  if (opts.capture === true) opts.wrap = true;
  step = step || opts.step || 1;
  if (!$fdedd8b9f143315a$var$isNumber(step)) {
    if (step != null && !$fdedd8b9f143315a$var$isObject(step))
      return $fdedd8b9f143315a$var$invalidStep(step, opts);
    return $fdedd8b9f143315a$var$fill(start, end, 1, step);
  }
  if (
    $fdedd8b9f143315a$var$isNumber(start) &&
    $fdedd8b9f143315a$var$isNumber(end)
  )
    return $fdedd8b9f143315a$var$fillNumbers(start, end, step, opts);
  return $fdedd8b9f143315a$var$fillLetters(
    start,
    end,
    Math.max(Math.abs(step), 1),
    opts,
  );
};
$fdedd8b9f143315a$exports = $fdedd8b9f143315a$var$fill;

const $3e51fb4d64680808$var$compile = (ast, options = {}) => {
  let walk = (node, parent = {}) => {
    let invalidBlock = $1821b2ec65ef4d98$export$25a78c310c11373f(parent);
    let invalidNode = node.invalid === true && options.escapeInvalid === true;
    let invalid = invalidBlock === true || invalidNode === true;
    let prefix = options.escapeInvalid === true ? '\\' : '';
    let output = '';
    if (node.isOpen === true) return prefix + node.value;
    if (node.isClose === true) return prefix + node.value;
    if (node.type === 'open') return invalid ? prefix + node.value : '(';
    if (node.type === 'close') return invalid ? prefix + node.value : ')';
    if (node.type === 'comma')
      return node.prev.type === 'comma' ? '' : invalid ? node.value : '|';
    if (node.value) return node.value;
    if (node.nodes && node.ranges > 0) {
      let args = $1821b2ec65ef4d98$export$533b26079ad0b4b(node.nodes);
      let range = $fdedd8b9f143315a$exports(...args, {
        ...options,
        wrap: false,
        toRegex: true,
      });
      if (range.length !== 0)
        return args.length > 1 && range.length > 1 ? `(${range})` : range;
    }
    if (node.nodes) for (let child of node.nodes) output += walk(child, node);
    return output;
  };
  return walk(ast);
};
$3e51fb4d64680808$exports = $3e51fb4d64680808$var$compile;

var $bc7d4e7017ad63a7$exports = {};
('use strict');

const $bc7d4e7017ad63a7$var$append = (
  queue = '',
  stash = '',
  enclose = false,
) => {
  let result = [];
  queue = [].concat(queue);
  stash = [].concat(stash);
  if (!stash.length) return queue;
  if (!queue.length)
    return enclose
      ? $1821b2ec65ef4d98$export$bffa455ba8c619a6(stash).map(ele => `{${ele}}`)
      : stash;
  for (let item of queue) {
    if (Array.isArray(item))
      for (let value of item)
        result.push($bc7d4e7017ad63a7$var$append(value, stash, enclose));
    else
      for (let ele of stash) {
        if (enclose === true && typeof ele === 'string') ele = `{${ele}}`;
        result.push(
          Array.isArray(ele)
            ? $bc7d4e7017ad63a7$var$append(item, ele, enclose)
            : item + ele,
        );
      }
  }
  return $1821b2ec65ef4d98$export$bffa455ba8c619a6(result);
};
const $bc7d4e7017ad63a7$var$expand = (ast, options = {}) => {
  let rangeLimit = options.rangeLimit === void 0 ? 1000 : options.rangeLimit;
  let walk = (node, parent = {}) => {
    node.queue = [];
    let p = parent;
    let q = parent.queue;
    while (p.type !== 'brace' && p.type !== 'root' && p.parent) {
      p = p.parent;
      q = p.queue;
    }
    if (node.invalid || node.dollar) {
      q.push(
        $bc7d4e7017ad63a7$var$append(
          q.pop(),
          $a029327b5d06ba8d$exports(node, options),
        ),
      );
      return;
    }
    if (
      node.type === 'brace' &&
      node.invalid !== true &&
      node.nodes.length === 2
    ) {
      q.push($bc7d4e7017ad63a7$var$append(q.pop(), ['{}']));
      return;
    }
    if (node.nodes && node.ranges > 0) {
      let args = $1821b2ec65ef4d98$export$533b26079ad0b4b(node.nodes);
      if (
        $1821b2ec65ef4d98$export$fbadac39f36b1e16(
          ...args,
          options.step,
          rangeLimit,
        )
      )
        throw new RangeError(
          'expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.',
        );
      let range = $fdedd8b9f143315a$exports(...args, options);
      if (range.length === 0) range = $a029327b5d06ba8d$exports(node, options);
      q.push($bc7d4e7017ad63a7$var$append(q.pop(), range));
      node.nodes = [];
      return;
    }
    let enclose = $1821b2ec65ef4d98$export$ea0f721b77fd5acc(node);
    let queue = node.queue;
    let block = node;
    while (block.type !== 'brace' && block.type !== 'root' && block.parent) {
      block = block.parent;
      queue = block.queue;
    }
    for (let i = 0; i < node.nodes.length; i++) {
      let child = node.nodes[i];
      if (child.type === 'comma' && node.type === 'brace') {
        if (i === 1) queue.push('');
        queue.push('');
        continue;
      }
      if (child.type === 'close') {
        q.push($bc7d4e7017ad63a7$var$append(q.pop(), queue, enclose));
        continue;
      }
      if (child.value && child.type !== 'open') {
        queue.push($bc7d4e7017ad63a7$var$append(queue.pop(), child.value));
        continue;
      }
      if (child.nodes) walk(child, node);
    }
    return queue;
  };
  return $1821b2ec65ef4d98$export$bffa455ba8c619a6(walk(ast));
};
$bc7d4e7017ad63a7$exports = $bc7d4e7017ad63a7$var$expand;

var $78b835245807a48d$exports = {};
('use strict');

var $536a110f09fdb53c$exports = {};
('use strict');
$536a110f09fdb53c$exports = {
  MAX_LENGTH: 65536,
  // Digits
  CHAR_0: '0',
  /* 0 */ CHAR_9: '9',
  /* 9 */ // Alphabet chars.
  CHAR_UPPERCASE_A: 'A',
  /* A */ CHAR_LOWERCASE_A: 'a',
  /* a */ CHAR_UPPERCASE_Z: 'Z',
  /* Z */ CHAR_LOWERCASE_Z: 'z',
  /* z */ CHAR_LEFT_PARENTHESES: '(',
  /* ( */ CHAR_RIGHT_PARENTHESES: ')',
  /* ) */ CHAR_ASTERISK: '*',
  /* * */ // Non-alphabetic chars.
  CHAR_AMPERSAND: '&',
  /* & */ CHAR_AT: '@',
  /* @ */ CHAR_BACKSLASH: '\\',
  /* \ */ CHAR_BACKTICK: '`',
  /* ` */ CHAR_CARRIAGE_RETURN: '\r',
  /* \r */ CHAR_CIRCUMFLEX_ACCENT: '^',
  /* ^ */ CHAR_COLON: ':',
  /* : */ CHAR_COMMA: ',',
  /* , */ CHAR_DOLLAR: '$',
  /* . */ CHAR_DOT: '.',
  /* . */ CHAR_DOUBLE_QUOTE: '"',
  /* " */ CHAR_EQUAL: '=',
  /* = */ CHAR_EXCLAMATION_MARK: '!',
  /* ! */ CHAR_FORM_FEED: '\f',
  /* \f */ CHAR_FORWARD_SLASH: '/',
  /* / */ CHAR_HASH: '#',
  /* # */ CHAR_HYPHEN_MINUS: '-',
  /* - */ CHAR_LEFT_ANGLE_BRACKET: '<',
  /* < */ CHAR_LEFT_CURLY_BRACE: '{',
  /* { */ CHAR_LEFT_SQUARE_BRACKET: '[',
  /* [ */ CHAR_LINE_FEED: '\n',
  /* \n */ CHAR_NO_BREAK_SPACE: '\xa0',
  /* \u00A0 */ CHAR_PERCENT: '%',
  /* % */ CHAR_PLUS: '+',
  /* + */ CHAR_QUESTION_MARK: '?',
  /* ? */ CHAR_RIGHT_ANGLE_BRACKET: '>',
  /* > */ CHAR_RIGHT_CURLY_BRACE: '}',
  /* } */ CHAR_RIGHT_SQUARE_BRACKET: ']',
  /* ] */ CHAR_SEMICOLON: ';',
  /* ; */ CHAR_SINGLE_QUOTE: "'",
  /* ' */ CHAR_SPACE: ' ',
  /*   */ CHAR_TAB: '	',
  /* \t */ CHAR_UNDERSCORE: '_',
  /* _ */ CHAR_VERTICAL_LINE: '|',
  /* | */ CHAR_ZERO_WIDTH_NOBREAK_SPACE: '\uFEFF' /* \uFEFF */,
};

var $78b835245807a48d$require$MAX_LENGTH = $536a110f09fdb53c$exports.MAX_LENGTH;
var $78b835245807a48d$require$CHAR_BACKSLASH =
  $536a110f09fdb53c$exports.CHAR_BACKSLASH;
var $78b835245807a48d$require$CHAR_BACKTICK =
  $536a110f09fdb53c$exports.CHAR_BACKTICK;
var $78b835245807a48d$require$CHAR_COMMA = $536a110f09fdb53c$exports.CHAR_COMMA;
var $78b835245807a48d$require$CHAR_DOT = $536a110f09fdb53c$exports.CHAR_DOT;
var $78b835245807a48d$require$CHAR_LEFT_PARENTHESES =
  $536a110f09fdb53c$exports.CHAR_LEFT_PARENTHESES;
var $78b835245807a48d$require$CHAR_RIGHT_PARENTHESES =
  $536a110f09fdb53c$exports.CHAR_RIGHT_PARENTHESES;
var $78b835245807a48d$require$CHAR_LEFT_CURLY_BRACE =
  $536a110f09fdb53c$exports.CHAR_LEFT_CURLY_BRACE;
var $78b835245807a48d$require$CHAR_RIGHT_CURLY_BRACE =
  $536a110f09fdb53c$exports.CHAR_RIGHT_CURLY_BRACE;
var $78b835245807a48d$require$CHAR_LEFT_SQUARE_BRACKET =
  $536a110f09fdb53c$exports.CHAR_LEFT_SQUARE_BRACKET;
var $78b835245807a48d$require$CHAR_RIGHT_SQUARE_BRACKET =
  $536a110f09fdb53c$exports.CHAR_RIGHT_SQUARE_BRACKET;
var $78b835245807a48d$require$CHAR_DOUBLE_QUOTE =
  $536a110f09fdb53c$exports.CHAR_DOUBLE_QUOTE;
var $78b835245807a48d$require$CHAR_SINGLE_QUOTE =
  $536a110f09fdb53c$exports.CHAR_SINGLE_QUOTE;
var $78b835245807a48d$require$CHAR_NO_BREAK_SPACE =
  $536a110f09fdb53c$exports.CHAR_NO_BREAK_SPACE;
var $78b835245807a48d$require$CHAR_ZERO_WIDTH_NOBREAK_SPACE =
  $536a110f09fdb53c$exports.CHAR_ZERO_WIDTH_NOBREAK_SPACE;
/**
 * parse
 */ const $78b835245807a48d$var$parse = (input, options = {}) => {
  if (typeof input !== 'string') throw new TypeError('Expected a string');
  let opts = options || {};
  let max =
    typeof opts.maxLength === 'number'
      ? Math.min($78b835245807a48d$require$MAX_LENGTH, opts.maxLength)
      : $78b835245807a48d$require$MAX_LENGTH;
  if (input.length > max)
    throw new SyntaxError(
      `Input length (${input.length}), exceeds max characters (${max})`,
    );
  let ast = {
    type: 'root',
    input: input,
    nodes: [],
  };
  let stack = [ast];
  let block = ast;
  let prev = ast;
  let brackets = 0;
  let length = input.length;
  let index = 0;
  let depth = 0;
  let value;
  let memo = {};
  /**
   * Helpers
   */ const advance = () => input[index++];
  const push = node => {
    if (node.type === 'text' && prev.type === 'dot') prev.type = 'text';
    if (prev && prev.type === 'text' && node.type === 'text') {
      prev.value += node.value;
      return;
    }
    block.nodes.push(node);
    node.parent = block;
    node.prev = prev;
    prev = node;
    return node;
  };
  push({
    type: 'bos',
  });
  while (index < length) {
    block = stack[stack.length - 1];
    value = advance();
    /**
     * Invalid chars
     */ if (
      value === $78b835245807a48d$require$CHAR_ZERO_WIDTH_NOBREAK_SPACE ||
      value === $78b835245807a48d$require$CHAR_NO_BREAK_SPACE
    )
      continue;
    /**
     * Escaped chars
     */ if (value === $78b835245807a48d$require$CHAR_BACKSLASH) {
      push({
        type: 'text',
        value: (options.keepEscaping ? value : '') + advance(),
      });
      continue;
    }
    /**
     * Right square bracket (literal): ']'
     */ if (value === $78b835245807a48d$require$CHAR_RIGHT_SQUARE_BRACKET) {
      push({
        type: 'text',
        value: '\\' + value,
      });
      continue;
    }
    /**
     * Left square bracket: '['
     */ if (value === $78b835245807a48d$require$CHAR_LEFT_SQUARE_BRACKET) {
      brackets++;
      let closed = true;
      let next;
      while (index < length && (next = advance())) {
        value += next;
        if (next === $78b835245807a48d$require$CHAR_LEFT_SQUARE_BRACKET) {
          brackets++;
          continue;
        }
        if (next === $78b835245807a48d$require$CHAR_BACKSLASH) {
          value += advance();
          continue;
        }
        if (next === $78b835245807a48d$require$CHAR_RIGHT_SQUARE_BRACKET) {
          brackets--;
          if (brackets === 0) break;
        }
      }
      push({
        type: 'text',
        value: value,
      });
      continue;
    }
    /**
     * Parentheses
     */ if (value === $78b835245807a48d$require$CHAR_LEFT_PARENTHESES) {
      block = push({
        type: 'paren',
        nodes: [],
      });
      stack.push(block);
      push({
        type: 'text',
        value: value,
      });
      continue;
    }
    if (value === $78b835245807a48d$require$CHAR_RIGHT_PARENTHESES) {
      if (block.type !== 'paren') {
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      block = stack.pop();
      push({
        type: 'text',
        value: value,
      });
      block = stack[stack.length - 1];
      continue;
    }
    /**
     * Quotes: '|"|`
     */ if (
      value === $78b835245807a48d$require$CHAR_DOUBLE_QUOTE ||
      value === $78b835245807a48d$require$CHAR_SINGLE_QUOTE ||
      value === $78b835245807a48d$require$CHAR_BACKTICK
    ) {
      let open = value;
      let next;
      if (options.keepQuotes !== true) value = '';
      while (index < length && (next = advance())) {
        if (next === $78b835245807a48d$require$CHAR_BACKSLASH) {
          value += next + advance();
          continue;
        }
        if (next === open) {
          if (options.keepQuotes === true) value += next;
          break;
        }
        value += next;
      }
      push({
        type: 'text',
        value: value,
      });
      continue;
    }
    /**
     * Left curly brace: '{'
     */ if (value === $78b835245807a48d$require$CHAR_LEFT_CURLY_BRACE) {
      depth++;
      let dollar =
        (prev.value && prev.value.slice(-1) === '$') || block.dollar === true;
      let brace = {
        type: 'brace',
        open: true,
        close: false,
        dollar: dollar,
        depth: depth,
        commas: 0,
        ranges: 0,
        nodes: [],
      };
      block = push(brace);
      stack.push(block);
      push({
        type: 'open',
        value: value,
      });
      continue;
    }
    /**
     * Right curly brace: '}'
     */ if (value === $78b835245807a48d$require$CHAR_RIGHT_CURLY_BRACE) {
      if (block.type !== 'brace') {
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      let type = 'close';
      block = stack.pop();
      block.close = true;
      push({
        type: type,
        value: value,
      });
      depth--;
      block = stack[stack.length - 1];
      continue;
    }
    /**
     * Comma: ','
     */ if (value === $78b835245807a48d$require$CHAR_COMMA && depth > 0) {
      if (block.ranges > 0) {
        block.ranges = 0;
        let open = block.nodes.shift();
        block.nodes = [
          open,
          {
            type: 'text',
            value: $a029327b5d06ba8d$exports(block),
          },
        ];
      }
      push({
        type: 'comma',
        value: value,
      });
      block.commas++;
      continue;
    }
    /**
     * Dot: '.'
     */ if (
      value === $78b835245807a48d$require$CHAR_DOT &&
      depth > 0 &&
      block.commas === 0
    ) {
      let siblings = block.nodes;
      if (depth === 0 || siblings.length === 0) {
        push({
          type: 'text',
          value: value,
        });
        continue;
      }
      if (prev.type === 'dot') {
        block.range = [];
        prev.value += value;
        prev.type = 'range';
        if (block.nodes.length !== 3 && block.nodes.length !== 5) {
          block.invalid = true;
          block.ranges = 0;
          prev.type = 'text';
          continue;
        }
        block.ranges++;
        block.args = [];
        continue;
      }
      if (prev.type === 'range') {
        siblings.pop();
        let before = siblings[siblings.length - 1];
        before.value += prev.value + value;
        prev = before;
        block.ranges--;
        continue;
      }
      push({
        type: 'dot',
        value: value,
      });
      continue;
    }
    /**
     * Text
     */ push({
      type: 'text',
      value: value,
    });
  }
  // Mark imbalanced braces and brackets as invalid
  do {
    block = stack.pop();
    if (block.type !== 'root') {
      block.nodes.forEach(node => {
        if (!node.nodes) {
          if (node.type === 'open') node.isOpen = true;
          if (node.type === 'close') node.isClose = true;
          if (!node.nodes) node.type = 'text';
          node.invalid = true;
        }
      });
      // get the location of the block on parent.nodes (block's siblings)
      let parent = stack[stack.length - 1];
      let index = parent.nodes.indexOf(block);
      // replace the (invalid) block with it's nodes
      parent.nodes.splice(index, 1, ...block.nodes);
    }
  } while (stack.length > 0);
  push({
    type: 'eos',
  });
  return ast;
};
$78b835245807a48d$exports = $78b835245807a48d$var$parse;

/**
 * Expand the given pattern or create a regex-compatible string.
 *
 * ```js
 * const braces = require('braces');
 * console.log(braces('{a,b,c}', { compile: true })); //=> ['(a|b|c)']
 * console.log(braces('{a,b,c}')); //=> ['a', 'b', 'c']
 * ```
 * @param {String} `str`
 * @param {Object} `options`
 * @return {String}
 * @api public
 */ const $aa8a71cee8fec249$var$braces = (input, options = {}) => {
  let output = [];
  if (Array.isArray(input))
    for (let pattern of input) {
      let result = $aa8a71cee8fec249$var$braces.create(pattern, options);
      if (Array.isArray(result)) output.push(...result);
      else output.push(result);
    }
  else output = [].concat($aa8a71cee8fec249$var$braces.create(input, options));
  if (options && options.expand === true && options.nodupes === true)
    output = [...new Set(output)];
  return output;
};
/**
 * Parse the given `str` with the given `options`.
 *
 * ```js
 * // braces.parse(pattern, [, options]);
 * const ast = braces.parse('a/{b,c}/d');
 * console.log(ast);
 * ```
 * @param {String} pattern Brace pattern to parse
 * @param {Object} options
 * @return {Object} Returns an AST
 * @api public
 */ $aa8a71cee8fec249$var$braces.parse = (input, options = {}) =>
  $78b835245807a48d$exports(input, options);
/**
 * Creates a braces string from an AST, or an AST node.
 *
 * ```js
 * const braces = require('braces');
 * let ast = braces.parse('foo/{a,b}/bar');
 * console.log(stringify(ast.nodes[2])); //=> '{a,b}'
 * ```
 * @param {String} `input` Brace pattern or AST.
 * @param {Object} `options`
 * @return {Array} Returns an array of expanded values.
 * @api public
 */ $aa8a71cee8fec249$var$braces.stringify = (input, options = {}) => {
  if (typeof input === 'string')
    return $a029327b5d06ba8d$exports(
      $aa8a71cee8fec249$var$braces.parse(input, options),
      options,
    );
  return $a029327b5d06ba8d$exports(input, options);
};
/**
 * Compiles a brace pattern into a regex-compatible, optimized string.
 * This method is called by the main [braces](#braces) function by default.
 *
 * ```js
 * const braces = require('braces');
 * console.log(braces.compile('a/{b,c}/d'));
 * //=> ['a/(b|c)/d']
 * ```
 * @param {String} `input` Brace pattern or AST.
 * @param {Object} `options`
 * @return {Array} Returns an array of expanded values.
 * @api public
 */ $aa8a71cee8fec249$var$braces.compile = (input, options = {}) => {
  if (typeof input === 'string')
    input = $aa8a71cee8fec249$var$braces.parse(input, options);
  return $3e51fb4d64680808$exports(input, options);
};
/**
 * Expands a brace pattern into an array. This method is called by the
 * main [braces](#braces) function when `options.expand` is true. Before
 * using this method it's recommended that you read the [performance notes](#performance))
 * and advantages of using [.compile](#compile) instead.
 *
 * ```js
 * const braces = require('braces');
 * console.log(braces.expand('a/{b,c}/d'));
 * //=> ['a/b/d', 'a/c/d'];
 * ```
 * @param {String} `pattern` Brace pattern
 * @param {Object} `options`
 * @return {Array} Returns an array of expanded values.
 * @api public
 */ $aa8a71cee8fec249$var$braces.expand = (input, options = {}) => {
  if (typeof input === 'string')
    input = $aa8a71cee8fec249$var$braces.parse(input, options);
  let result = $bc7d4e7017ad63a7$exports(input, options);
  // filter out empty strings if specified
  if (options.noempty === true) result = result.filter(Boolean);
  // filter out duplicates if specified
  if (options.nodupes === true) result = [...new Set(result)];
  return result;
};
/**
 * Processes a brace pattern and returns either an expanded array
 * (if `options.expand` is true), a highly optimized regex-compatible string.
 * This method is called by the main [braces](#braces) function.
 *
 * ```js
 * const braces = require('braces');
 * console.log(braces.create('user-{200..300}/project-{a,b,c}-{1..10}'))
 * //=> 'user-(20[0-9]|2[1-9][0-9]|300)/project-(a|b|c)-([1-9]|10)'
 * ```
 * @param {String} `pattern` Brace pattern
 * @param {Object} `options`
 * @return {Array} Returns an array of expanded values.
 * @api public
 */ $aa8a71cee8fec249$var$braces.create = (input, options = {}) => {
  if (input === '' || input.length < 3) return [input];
  return options.expand !== true
    ? $aa8a71cee8fec249$var$braces.compile(input, options)
    : $aa8a71cee8fec249$var$braces.expand(input, options);
};
/**
 * Expose "braces"
 */ $aa8a71cee8fec249$exports = $aa8a71cee8fec249$var$braces;

var $ea57936d062aa9cc$exports = {};
('use strict');

$ea57936d062aa9cc$exports = parcelRequire('gO8ny');

var $fyIT7 = parcelRequire('fyIT7');
const $1a9bcb9566a84ee7$var$isEmptyString = val => val === '' || val === './';
/**
 * Returns an array of strings that match one or more glob patterns.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm(list, patterns[, options]);
 *
 * console.log(mm(['a.js', 'a.txt'], ['*.js']));
 * //=> [ 'a.js' ]
 * ```
 * @param {String|Array<string>} `list` List of strings to match.
 * @param {String|Array<string>} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `options` See available [options](#options)
 * @return {Array} Returns an array of matches
 * @summary false
 * @api public
 */ const $1a9bcb9566a84ee7$var$micromatch = (list, patterns, options) => {
  patterns = [].concat(patterns);
  list = [].concat(list);
  let omit = new Set();
  let keep = new Set();
  let items = new Set();
  let negatives = 0;
  let onResult = state => {
    items.add(state.output);
    if (options && options.onResult) options.onResult(state);
  };
  for (let i = 0; i < patterns.length; i++) {
    let isMatch = $ea57936d062aa9cc$exports(
      String(patterns[i]),
      {
        ...options,
        onResult: onResult,
      },
      true,
    );
    let negated = isMatch.state.negated || isMatch.state.negatedExtglob;
    if (negated) negatives++;
    for (let item of list) {
      let matched = isMatch(item, true);
      let match = negated ? !matched.isMatch : matched.isMatch;
      if (!match) continue;
      if (negated) omit.add(matched.output);
      else {
        omit.delete(matched.output);
        keep.add(matched.output);
      }
    }
  }
  let result = negatives === patterns.length ? [...items] : [...keep];
  let matches = result.filter(item => !omit.has(item));
  if (options && matches.length === 0) {
    if (options.failglob === true)
      throw new Error(`No matches found for "${patterns.join(', ')}"`);
    if (options.nonull === true || options.nullglob === true)
      return options.unescape
        ? patterns.map(p => p.replace(/\\/g, ''))
        : patterns;
  }
  return matches;
};
/**
 * Backwards compatibility
 */ $1a9bcb9566a84ee7$var$micromatch.match = $1a9bcb9566a84ee7$var$micromatch;
/**
 * Returns a matcher function from the given glob `pattern` and `options`.
 * The returned function takes a string to match as its only argument and returns
 * true if the string is a match.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.matcher(pattern[, options]);
 *
 * const isMatch = mm.matcher('*.!(*a)');
 * console.log(isMatch('a.a')); //=> false
 * console.log(isMatch('a.b')); //=> true
 * ```
 * @param {String} `pattern` Glob pattern
 * @param {Object} `options`
 * @return {Function} Returns a matcher function.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.matcher = (pattern, options) =>
  $ea57936d062aa9cc$exports(pattern, options);
/**
 * Returns true if **any** of the given glob `patterns` match the specified `string`.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.isMatch(string, patterns[, options]);
 *
 * console.log(mm.isMatch('a.a', ['b.*', '*.a'])); //=> true
 * console.log(mm.isMatch('a.a', 'b.*')); //=> false
 * ```
 * @param {String} `str` The string to test.
 * @param {String|Array} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `[options]` See available [options](#options).
 * @return {Boolean} Returns true if any patterns match `str`
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.isMatch = (str, patterns, options) =>
  $ea57936d062aa9cc$exports(patterns, options)(str);
/**
 * Backwards compatibility
 */ $1a9bcb9566a84ee7$var$micromatch.any =
  $1a9bcb9566a84ee7$var$micromatch.isMatch;
/**
 * Returns a list of strings that _**do not match any**_ of the given `patterns`.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.not(list, patterns[, options]);
 *
 * console.log(mm.not(['a.a', 'b.b', 'c.c'], '*.a'));
 * //=> ['b.b', 'c.c']
 * ```
 * @param {Array} `list` Array of strings to match.
 * @param {String|Array} `patterns` One or more glob pattern to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Array} Returns an array of strings that **do not match** the given patterns.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.not = (list, patterns, options = {}) => {
  patterns = [].concat(patterns).map(String);
  let result = new Set();
  let items = [];
  let onResult = state => {
    if (options.onResult) options.onResult(state);
    items.push(state.output);
  };
  let matches = new Set(
    $1a9bcb9566a84ee7$var$micromatch(list, patterns, {
      ...options,
      onResult: onResult,
    }),
  );
  for (let item of items) if (!matches.has(item)) result.add(item);
  return [...result];
};
/**
 * Returns true if the given `string` contains the given pattern. Similar
 * to [.isMatch](#isMatch) but the pattern can match any part of the string.
 *
 * ```js
 * var mm = require('micromatch');
 * // mm.contains(string, pattern[, options]);
 *
 * console.log(mm.contains('aa/bb/cc', '*b'));
 * //=> true
 * console.log(mm.contains('aa/bb/cc', '*d'));
 * //=> false
 * ```
 * @param {String} `str` The string to match.
 * @param {String|Array} `patterns` Glob pattern to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Boolean} Returns true if any of the patterns matches any part of `str`.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.contains = (str, pattern, options) => {
  if (typeof str !== 'string')
    throw new TypeError(`Expected a string: "${$dmXIQ$util.inspect(str)}"`);
  if (Array.isArray(pattern))
    return pattern.some(p =>
      $1a9bcb9566a84ee7$var$micromatch.contains(str, p, options),
    );
  if (typeof pattern === 'string') {
    if (
      $1a9bcb9566a84ee7$var$isEmptyString(str) ||
      $1a9bcb9566a84ee7$var$isEmptyString(pattern)
    )
      return false;
    if (
      str.includes(pattern) ||
      (str.startsWith('./') && str.slice(2).includes(pattern))
    )
      return true;
  }
  return $1a9bcb9566a84ee7$var$micromatch.isMatch(str, pattern, {
    ...options,
    contains: true,
  });
};
/**
 * Filter the keys of the given object with the given `glob` pattern
 * and `options`. Does not attempt to match nested keys. If you need this feature,
 * use [glob-object][] instead.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.matchKeys(object, patterns[, options]);
 *
 * const obj = { aa: 'a', ab: 'b', ac: 'c' };
 * console.log(mm.matchKeys(obj, '*b'));
 * //=> { ab: 'b' }
 * ```
 * @param {Object} `object` The object with keys to filter.
 * @param {String|Array} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Object} Returns an object with only keys that match the given patterns.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.matchKeys = (obj, patterns, options) => {
  if (!$fyIT7.isObject(obj))
    throw new TypeError('Expected the first argument to be an object');
  let keys = $1a9bcb9566a84ee7$var$micromatch(
    Object.keys(obj),
    patterns,
    options,
  );
  let res = {};
  for (let key of keys) res[key] = obj[key];
  return res;
};
/**
 * Returns true if some of the strings in the given `list` match any of the given glob `patterns`.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.some(list, patterns[, options]);
 *
 * console.log(mm.some(['foo.js', 'bar.js'], ['*.js', '!foo.js']));
 * // true
 * console.log(mm.some(['foo.js'], ['*.js', '!foo.js']));
 * // false
 * ```
 * @param {String|Array} `list` The string or array of strings to test. Returns as soon as the first match is found.
 * @param {String|Array} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Boolean} Returns true if any `patterns` matches any of the strings in `list`
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.some = (list, patterns, options) => {
  let items = [].concat(list);
  for (let pattern of [].concat(patterns)) {
    let isMatch = $ea57936d062aa9cc$exports(String(pattern), options);
    if (items.some(item => isMatch(item))) return true;
  }
  return false;
};
/**
 * Returns true if every string in the given `list` matches
 * any of the given glob `patterns`.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.every(list, patterns[, options]);
 *
 * console.log(mm.every('foo.js', ['foo.js']));
 * // true
 * console.log(mm.every(['foo.js', 'bar.js'], ['*.js']));
 * // true
 * console.log(mm.every(['foo.js', 'bar.js'], ['*.js', '!foo.js']));
 * // false
 * console.log(mm.every(['foo.js'], ['*.js', '!foo.js']));
 * // false
 * ```
 * @param {String|Array} `list` The string or array of strings to test.
 * @param {String|Array} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Boolean} Returns true if all `patterns` matches all of the strings in `list`
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.every = (list, patterns, options) => {
  let items = [].concat(list);
  for (let pattern of [].concat(patterns)) {
    let isMatch = $ea57936d062aa9cc$exports(String(pattern), options);
    if (!items.every(item => isMatch(item))) return false;
  }
  return true;
};
/**
 * Returns true if **all** of the given `patterns` match
 * the specified string.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.all(string, patterns[, options]);
 *
 * console.log(mm.all('foo.js', ['foo.js']));
 * // true
 *
 * console.log(mm.all('foo.js', ['*.js', '!foo.js']));
 * // false
 *
 * console.log(mm.all('foo.js', ['*.js', 'foo.js']));
 * // true
 *
 * console.log(mm.all('foo.js', ['*.js', 'f*', '*o*', '*o.js']));
 * // true
 * ```
 * @param {String|Array} `str` The string to test.
 * @param {String|Array} `patterns` One or more glob patterns to use for matching.
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Boolean} Returns true if any patterns match `str`
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.all = (str, patterns, options) => {
  if (typeof str !== 'string')
    throw new TypeError(`Expected a string: "${$dmXIQ$util.inspect(str)}"`);
  return []
    .concat(patterns)
    .every(p => $ea57936d062aa9cc$exports(p, options)(str));
};
/**
 * Returns an array of matches captured by `pattern` in `string, or `null` if the pattern did not match.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.capture(pattern, string[, options]);
 *
 * console.log(mm.capture('test/*.js', 'test/foo.js'));
 * //=> ['foo']
 * console.log(mm.capture('test/*.js', 'foo/bar.css'));
 * //=> null
 * ```
 * @param {String} `glob` Glob pattern to use for matching.
 * @param {String} `input` String to match
 * @param {Object} `options` See available [options](#options) for changing how matches are performed
 * @return {Array|null} Returns an array of captures if the input matches the glob pattern, otherwise `null`.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.capture = (glob, input, options) => {
  let posix = $fyIT7.isWindows(options);
  let regex = $ea57936d062aa9cc$exports.makeRe(String(glob), {
    ...options,
    capture: true,
  });
  let match = regex.exec(posix ? $fyIT7.toPosixSlashes(input) : input);
  if (match) return match.slice(1).map(v => (v === void 0 ? '' : v));
};
/**
 * Create a regular expression from the given glob `pattern`.
 *
 * ```js
 * const mm = require('micromatch');
 * // mm.makeRe(pattern[, options]);
 *
 * console.log(mm.makeRe('*.js'));
 * //=> /^(?:(\.[\\\/])?(?!\.)(?=.)[^\/]*?\.js)$/
 * ```
 * @param {String} `pattern` A glob pattern to convert to regex.
 * @param {Object} `options`
 * @return {RegExp} Returns a regex created from the given pattern.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.makeRe = (...args) =>
  $ea57936d062aa9cc$exports.makeRe(...args);
/**
 * Scan a glob pattern to separate the pattern into segments. Used
 * by the [split](#split) method.
 *
 * ```js
 * const mm = require('micromatch');
 * const state = mm.scan(pattern[, options]);
 * ```
 * @param {String} `pattern`
 * @param {Object} `options`
 * @return {Object} Returns an object with
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.scan = (...args) =>
  $ea57936d062aa9cc$exports.scan(...args);
/**
 * Parse a glob pattern to create the source string for a regular
 * expression.
 *
 * ```js
 * const mm = require('micromatch');
 * const state = mm.parse(pattern[, options]);
 * ```
 * @param {String} `glob`
 * @param {Object} `options`
 * @return {Object} Returns an object with useful properties and output to be used as regex source string.
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.parse = (patterns, options) => {
  let res = [];
  for (let pattern of [].concat(patterns || []))
    for (let str of $aa8a71cee8fec249$exports(String(pattern), options))
      res.push($ea57936d062aa9cc$exports.parse(str, options));
  return res;
};
/**
 * Process the given brace `pattern`.
 *
 * ```js
 * const { braces } = require('micromatch');
 * console.log(braces('foo/{a,b,c}/bar'));
 * //=> [ 'foo/(a|b|c)/bar' ]
 *
 * console.log(braces('foo/{a,b,c}/bar', { expand: true }));
 * //=> [ 'foo/a/bar', 'foo/b/bar', 'foo/c/bar' ]
 * ```
 * @param {String} `pattern` String with brace pattern to process.
 * @param {Object} `options` Any [options](#options) to change how expansion is performed. See the [braces][] library for all available options.
 * @return {Array}
 * @api public
 */ $1a9bcb9566a84ee7$var$micromatch.braces = (pattern, options) => {
  if (typeof pattern !== 'string') throw new TypeError('Expected a string');
  if ((options && options.nobrace === true) || !/\{.*\}/.test(pattern))
    return [pattern];
  return $aa8a71cee8fec249$exports(pattern, options);
};
/**
 * Expand braces
 */ $1a9bcb9566a84ee7$var$micromatch.braceExpand = (pattern, options) => {
  if (typeof pattern !== 'string') throw new TypeError('Expected a string');
  return $1a9bcb9566a84ee7$var$micromatch.braces(pattern, {
    ...options,
    expand: true,
  });
};
/**
 * Expose micromatch
 */ $1a9bcb9566a84ee7$exports = $1a9bcb9566a84ee7$var$micromatch;

function $c46addb07fb049eb$var$match(context, uri, req) {
  // single path
  if ($c46addb07fb049eb$var$isStringPath(context))
    return $c46addb07fb049eb$var$matchSingleStringPath(context, uri);
  // single glob path
  if ($c46addb07fb049eb$var$isGlobPath(context))
    return $c46addb07fb049eb$var$matchSingleGlobPath(context, uri);
  // multi path
  if (Array.isArray(context)) {
    if (context.every($c46addb07fb049eb$var$isStringPath))
      return $c46addb07fb049eb$var$matchMultiPath(context, uri);
    if (context.every($c46addb07fb049eb$var$isGlobPath))
      return $c46addb07fb049eb$var$matchMultiGlobPath(context, uri);
    throw new Error(
      $f9731ec128d117f1$exports.ERRORS.ERR_CONTEXT_MATCHER_INVALID_ARRAY,
    );
  }
  // custom matching
  if (typeof context === 'function') {
    const pathname = $c46addb07fb049eb$var$getUrlPathName(uri);
    return context(pathname, req);
  }
  throw new Error($f9731ec128d117f1$exports.ERRORS.ERR_CONTEXT_MATCHER_GENERIC);
}
$c46addb07fb049eb$exports.match = $c46addb07fb049eb$var$match;
/**
 * @param  {String} context '/api'
 * @param  {String} uri     'http://example.org/api/b/c/d.html'
 * @return {Boolean}
 */ function $c46addb07fb049eb$var$matchSingleStringPath(context, uri) {
  const pathname = $c46addb07fb049eb$var$getUrlPathName(uri);
  return pathname.indexOf(context) === 0;
}
function $c46addb07fb049eb$var$matchSingleGlobPath(pattern, uri) {
  const pathname = $c46addb07fb049eb$var$getUrlPathName(uri);
  const matches = $1a9bcb9566a84ee7$exports([pathname], pattern);
  return matches && matches.length > 0;
}
function $c46addb07fb049eb$var$matchMultiGlobPath(patternList, uri) {
  return $c46addb07fb049eb$var$matchSingleGlobPath(patternList, uri);
}
/**
 * @param  {String} contextList ['/api', '/ajax']
 * @param  {String} uri     'http://example.org/api/b/c/d.html'
 * @return {Boolean}
 */ function $c46addb07fb049eb$var$matchMultiPath(contextList, uri) {
  let isMultiPath = false;
  for (const context of contextList)
    if ($c46addb07fb049eb$var$matchSingleStringPath(context, uri)) {
      isMultiPath = true;
      break;
    }
  return isMultiPath;
}
/**
 * Parses URI and returns RFC 3986 path
 *
 * @param  {String} uri from req.url
 * @return {String}     RFC 3986 path
 */ function $c46addb07fb049eb$var$getUrlPathName(uri) {
  return uri && $dmXIQ$url.parse(uri).pathname;
}
function $c46addb07fb049eb$var$isStringPath(context) {
  return typeof context === 'string' && !$fbfd7e3db3573eb8$exports(context);
}
function $c46addb07fb049eb$var$isGlobPath(context) {
  return $fbfd7e3db3573eb8$exports(context);
}

var $3869e8aa689598e2$exports = {};
('use strict');
Object.defineProperty($3869e8aa689598e2$exports, '__esModule', {
  value: true,
});
$3869e8aa689598e2$exports.getHandlers = $3869e8aa689598e2$exports.init = void 0;

const $3869e8aa689598e2$var$logger = $bbac356002fc3db4$exports.getInstance();
function $3869e8aa689598e2$var$init(proxy, option) {
  const handlers = $3869e8aa689598e2$var$getHandlers(option);
  for (const eventName of Object.keys(handlers))
    proxy.on(eventName, handlers[eventName]);
  $3869e8aa689598e2$var$logger.debug(
    '[HPM] Subscribed to http-proxy events:',
    Object.keys(handlers),
  );
}
$3869e8aa689598e2$exports.init = $3869e8aa689598e2$var$init;
function $3869e8aa689598e2$var$getHandlers(options) {
  // https://github.com/nodejitsu/node-http-proxy#listening-for-proxy-events
  const proxyEventsMap = {
    error: 'onError',
    proxyReq: 'onProxyReq',
    proxyReqWs: 'onProxyReqWs',
    proxyRes: 'onProxyRes',
    open: 'onOpen',
    close: 'onClose',
  };
  const handlers = {};
  for (const [eventName, onEventName] of Object.entries(proxyEventsMap)) {
    // all handlers for the http-proxy events are prefixed with 'on'.
    // loop through options and try to find these handlers
    // and add them to the handlers object for subscription in init().
    const fnHandler = options ? options[onEventName] : null;
    if (typeof fnHandler === 'function') handlers[eventName] = fnHandler;
  }
  // add default error handler in absence of error handler
  if (typeof handlers.error !== 'function')
    handlers.error = $3869e8aa689598e2$var$defaultErrorHandler;
  // add default close handler in absence of close handler
  if (typeof handlers.close !== 'function')
    handlers.close = $3869e8aa689598e2$var$logClose;
  return handlers;
}
$3869e8aa689598e2$exports.getHandlers = $3869e8aa689598e2$var$getHandlers;
function $3869e8aa689598e2$var$defaultErrorHandler(err, req, res) {
  // Re-throw error. Not recoverable since req & res are empty.
  if (!req && !res) throw err; // "Error: Must provide a proper URL as target"
  const host = req.headers && req.headers.host;
  const code = err.code;
  if (res.writeHead && !res.headersSent) {
    if (/HPE_INVALID/.test(code)) res.writeHead(502);
    else
      switch (code) {
        case 'ECONNRESET':
        case 'ENOTFOUND':
        case 'ECONNREFUSED':
        case 'ETIMEDOUT':
          res.writeHead(504);
          break;
        default:
          res.writeHead(500);
      }
  }
  res.end(`Error occured while trying to proxy: ${host}${req.url}`);
}
function $3869e8aa689598e2$var$logClose(req, socket, head) {
  // view disconnected websocket connections
  $3869e8aa689598e2$var$logger.info('[HPM] Client disconnected');
}

var $9ad005b611e24154$exports = {};
('use strict');
Object.defineProperty($9ad005b611e24154$exports, '__esModule', {
  value: true,
});
$9ad005b611e24154$exports.createPathRewriter = void 0;

const $9ad005b611e24154$var$logger = $bbac356002fc3db4$exports.getInstance();
/**
 * Create rewrite function, to cache parsed rewrite rules.
 *
 * @param {Object} rewriteConfig
 * @return {Function} Function to rewrite paths; This function should accept `path` (request.url) as parameter
 */ function $9ad005b611e24154$var$createPathRewriter(rewriteConfig) {
  let rulesCache;
  if (!$9ad005b611e24154$var$isValidRewriteConfig(rewriteConfig)) return;
  if (typeof rewriteConfig === 'function') {
    const customRewriteFn = rewriteConfig;
    return customRewriteFn;
  } else {
    rulesCache = $9ad005b611e24154$var$parsePathRewriteRules(rewriteConfig);
    return rewritePath;
  }
  function rewritePath(path) {
    let result = path;
    for (const rule of rulesCache)
      if (rule.regex.test(path)) {
        result = result.replace(rule.regex, rule.value);
        $9ad005b611e24154$var$logger.debug(
          '[HPM] Rewriting path from "%s" to "%s"',
          path,
          result,
        );
        break;
      }
    return result;
  }
}
$9ad005b611e24154$exports.createPathRewriter =
  $9ad005b611e24154$var$createPathRewriter;
function $9ad005b611e24154$var$isValidRewriteConfig(rewriteConfig) {
  if (typeof rewriteConfig === 'function') return true;
  else if ($8d30fd8601ad87a1$exports(rewriteConfig))
    return Object.keys(rewriteConfig).length !== 0;
  else if (rewriteConfig === undefined || rewriteConfig === null) return false;
  else
    throw new Error($f9731ec128d117f1$exports.ERRORS.ERR_PATH_REWRITER_CONFIG);
}
function $9ad005b611e24154$var$parsePathRewriteRules(rewriteConfig) {
  const rules = [];
  if ($8d30fd8601ad87a1$exports(rewriteConfig))
    for (const [key] of Object.entries(rewriteConfig)) {
      rules.push({
        regex: new RegExp(key),
        value: rewriteConfig[key],
      });
      $9ad005b611e24154$var$logger.info(
        '[HPM] Proxy rewrite rule created: "%s" ~> "%s"',
        key,
        rewriteConfig[key],
      );
    }
  return rules;
}

var $a5959543bad815ae$exports = {};
('use strict');
Object.defineProperty($a5959543bad815ae$exports, '__esModule', {
  value: true,
});
$a5959543bad815ae$exports.getTarget = void 0;

const $a5959543bad815ae$var$logger = $bbac356002fc3db4$exports.getInstance();
async function $a5959543bad815ae$var$getTarget(req, config) {
  let newTarget;
  const router = config.router;
  if ($8d30fd8601ad87a1$exports(router))
    newTarget = $a5959543bad815ae$var$getTargetFromProxyTable(req, router);
  else if (typeof router === 'function') newTarget = await router(req);
  return newTarget;
}
$a5959543bad815ae$exports.getTarget = $a5959543bad815ae$var$getTarget;
function $a5959543bad815ae$var$getTargetFromProxyTable(req, table) {
  let result;
  const host = req.headers.host;
  const path = req.url;
  const hostAndPath = host + path;
  for (const [key] of Object.entries(table)) {
    if ($a5959543bad815ae$var$containsPath(key)) {
      if (hostAndPath.indexOf(key) > -1) {
        // match 'localhost:3000/api'
        result = table[key];
        $a5959543bad815ae$var$logger.debug(
          '[HPM] Router table match: "%s"',
          key,
        );
        break;
      }
    } else if (key === host) {
      // match 'localhost:3000'
      result = table[key];
      $a5959543bad815ae$var$logger.debug(
        '[HPM] Router table match: "%s"',
        host,
      );
      break;
    }
  }
  return result;
}
function $a5959543bad815ae$var$containsPath(v) {
  return v.indexOf('/') > -1;
}

class $777aaad70a8a131c$var$HttpProxyMiddleware {
  constructor(context, opts) {
    this.logger = $bbac356002fc3db4$exports.getInstance();
    this.wsInternalSubscribed = false;
    this.serverOnCloseSubscribed = false;
    // https://github.com/Microsoft/TypeScript/wiki/'this'-in-TypeScript#red-flags-for-this
    this.middleware = async (req, res, next) => {
      var _a, _b;
      if (this.shouldProxy(this.config.context, req))
        try {
          const activeProxyOptions = await this.prepareProxyRequest(req);
          this.proxy.web(req, res, activeProxyOptions);
        } catch (err) {
          next(err);
        }
      else next();
      /**
       * Get the server object to subscribe to server events;
       * 'upgrade' for websocket and 'close' for graceful shutdown
       *
       * NOTE:
       * req.socket: node >= 13
       * req.connection: node < 13 (Remove this when node 12/13 support is dropped)
       */ const server =
        (_b =
          (_a = req.socket) !== null && _a !== void 0 ? _a : req.connection) ===
          null || _b === void 0
          ? void 0
          : _b.server;
      if (server && !this.serverOnCloseSubscribed) {
        server.on('close', () => {
          this.logger.info(
            '[HPM] server close signal received: closing proxy server',
          );
          this.proxy.close();
        });
        this.serverOnCloseSubscribed = true;
      }
      if (this.proxyOptions.ws === true)
        // use initial request to access the server object to subscribe to http upgrade event
        this.catchUpgradeRequest(server);
    };
    this.catchUpgradeRequest = server => {
      if (!this.wsInternalSubscribed) {
        server.on('upgrade', this.handleUpgrade);
        // prevent duplicate upgrade handling;
        // in case external upgrade is also configured
        this.wsInternalSubscribed = true;
      }
    };
    this.handleUpgrade = async (req, socket, head) => {
      if (this.shouldProxy(this.config.context, req)) {
        const activeProxyOptions = await this.prepareProxyRequest(req);
        this.proxy.ws(req, socket, head, activeProxyOptions);
        this.logger.info('[HPM] Upgrading to WebSocket');
      }
    };
    /**
     * Determine whether request should be proxied.
     *
     * @private
     * @param  {String} context [description]
     * @param  {Object} req     [description]
     * @return {Boolean}
     */ this.shouldProxy = (context, req) => {
      const path = req.originalUrl || req.url;
      return $c46addb07fb049eb$exports.match(context, path, req);
    };
    /**
     * Apply option.router and option.pathRewrite
     * Order matters:
     *    Router uses original path for routing;
     *    NOT the modified path, after it has been rewritten by pathRewrite
     * @param {Object} req
     * @return {Object} proxy options
     */ this.prepareProxyRequest = async req => {
      // https://github.com/chimurai/http-proxy-middleware/issues/17
      // https://github.com/chimurai/http-proxy-middleware/issues/94
      req.url = req.originalUrl || req.url;
      // store uri before it gets rewritten for logging
      const originalPath = req.url;
      const newProxyOptions = Object.assign({}, this.proxyOptions);
      // Apply in order:
      // 1. option.router
      // 2. option.pathRewrite
      await this.applyRouter(req, newProxyOptions);
      await this.applyPathRewrite(req, this.pathRewriter);
      // debug logging for both http(s) and websockets
      if (this.proxyOptions.logLevel === 'debug') {
        const arrow = $bbac356002fc3db4$exports.getArrow(
          originalPath,
          req.url,
          this.proxyOptions.target,
          newProxyOptions.target,
        );
        this.logger.debug(
          '[HPM] %s %s %s %s',
          req.method,
          originalPath,
          arrow,
          newProxyOptions.target,
        );
      }
      return newProxyOptions;
    };
    // Modify option.target when router present.
    this.applyRouter = async (req, options) => {
      let newTarget;
      if (options.router) {
        newTarget = await $a5959543bad815ae$exports.getTarget(req, options);
        if (newTarget) {
          this.logger.debug(
            '[HPM] Router new target: %s -> "%s"',
            options.target,
            newTarget,
          );
          options.target = newTarget;
        }
      }
    };
    // rewrite path
    this.applyPathRewrite = async (req, pathRewriter) => {
      if (pathRewriter) {
        const path = await pathRewriter(req.url, req);
        if (typeof path === 'string') req.url = path;
        else
          this.logger.info(
            '[HPM] pathRewrite: No rewritten path found. (%s)',
            req.url,
          );
      }
    };
    this.logError = (err, req, res, target) => {
      var _a;
      const hostname =
        ((_a = req.headers) === null || _a === void 0 ? void 0 : _a.host) ||
        req.hostname ||
        req.host; // (websocket) || (node0.10 || node 4/5)
      const requestHref = `${hostname}${req.url}`;
      const targetHref = `${
        target === null || target === void 0 ? void 0 : target.href
      }`; // target is undefined when websocket errors
      const errorMessage =
        '[HPM] Error occurred while proxying request %s to %s [%s] (%s)';
      const errReference =
        'https://nodejs.org/api/errors.html#errors_common_system_errors'; // link to Node Common Systems Errors page
      this.logger.error(
        errorMessage,
        requestHref,
        targetHref,
        err.code || err,
        errReference,
      );
    };
    this.config = $34744099e9c3c26e$exports.createConfig(context, opts);
    this.proxyOptions = this.config.options;
    // create proxy
    this.proxy = $d9f6cbf005f2e99f$exports.createProxyServer({});
    this.logger.info(
      `[HPM] Proxy created: ${this.config.context}  -> ${this.proxyOptions.target}`,
    );
    this.pathRewriter = $9ad005b611e24154$exports.createPathRewriter(
      this.proxyOptions.pathRewrite,
    ); // returns undefined when "pathRewrite" is not provided
    // attach handler to http-proxy events
    $3869e8aa689598e2$exports.init(this.proxy, this.proxyOptions);
    // log errors for debug purpose
    this.proxy.on('error', this.logError);
    // https://github.com/chimurai/http-proxy-middleware/issues/19
    // expose function to upgrade externally
    this.middleware.upgrade = (req, socket, head) => {
      if (!this.wsInternalSubscribed) this.handleUpgrade(req, socket, head);
    };
  }
}
$777aaad70a8a131c$exports.HttpProxyMiddleware =
  $777aaad70a8a131c$var$HttpProxyMiddleware;

function $1187a10c6610a8e2$var$createProxyMiddleware(context, options) {
  const {middleware: middleware} =
    new $777aaad70a8a131c$exports.HttpProxyMiddleware(context, options);
  return middleware;
}
$1187a10c6610a8e2$exports.createProxyMiddleware =
  $1187a10c6610a8e2$var$createProxyMiddleware;

$1187a10c6610a8e2$var$__exportStar(
  parcelRequire('i1UlB'),
  $1187a10c6610a8e2$exports,
);

var $9adaf3fd5745e4a0$exports = {};
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file at
 * https://github.com/facebookincubator/create-react-app/blob/master/LICENSE
 *
 * Modified by Yuxi Evan You
 */

var $4deaf4da83270089$exports = {};

let $4deaf4da83270089$var$isColorSupported =
  !process.argv.includes('--no-color') &&
  (process.argv.includes('--color') ||
    process.platform === 'win32' ||
    ($dmXIQ$tty.isatty(1) && process.env.TERM !== 'dumb') ||
    false);
let $4deaf4da83270089$var$formatter =
  (open, close, replace = open) =>
  input => {
    let string = '' + input;
    let index = string.indexOf(close, open.length);
    return ~index
      ? open +
          $4deaf4da83270089$var$replaceClose(string, close, replace, index) +
          close
      : open + string + close;
  };
let $4deaf4da83270089$var$replaceClose = (string, close, replace, index) => {
  let start = string.substring(0, index) + replace;
  let end = string.substring(index + close.length);
  let nextIndex = end.indexOf(close);
  return ~nextIndex
    ? start + $4deaf4da83270089$var$replaceClose(end, close, replace, nextIndex)
    : start + end;
};
let $4deaf4da83270089$var$createColors = (
  enabled = $4deaf4da83270089$var$isColorSupported,
) => ({
  isColorSupported: enabled,
  reset: enabled ? s => `\x1b[0m${s}\x1b[0m` : String,
  bold: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[1m', '\x1b[22m', '\x1b[22m\x1b[1m')
    : String,
  dim: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[2m', '\x1b[22m', '\x1b[22m\x1b[2m')
    : String,
  italic: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[3m', '\x1b[23m')
    : String,
  underline: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[4m', '\x1b[24m')
    : String,
  inverse: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[7m', '\x1b[27m')
    : String,
  hidden: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[8m', '\x1b[28m')
    : String,
  strikethrough: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[9m', '\x1b[29m')
    : String,
  black: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[30m', '\x1b[39m')
    : String,
  red: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[31m', '\x1b[39m')
    : String,
  green: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[32m', '\x1b[39m')
    : String,
  yellow: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[33m', '\x1b[39m')
    : String,
  blue: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[34m', '\x1b[39m')
    : String,
  magenta: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[35m', '\x1b[39m')
    : String,
  cyan: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[36m', '\x1b[39m')
    : String,
  white: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[37m', '\x1b[39m')
    : String,
  gray: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[90m', '\x1b[39m')
    : String,
  bgBlack: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[40m', '\x1b[49m')
    : String,
  bgRed: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[41m', '\x1b[49m')
    : String,
  bgGreen: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[42m', '\x1b[49m')
    : String,
  bgYellow: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[43m', '\x1b[49m')
    : String,
  bgBlue: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[44m', '\x1b[49m')
    : String,
  bgMagenta: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[45m', '\x1b[49m')
    : String,
  bgCyan: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[46m', '\x1b[49m')
    : String,
  bgWhite: enabled
    ? $4deaf4da83270089$var$formatter('\x1b[47m', '\x1b[49m')
    : String,
});
$4deaf4da83270089$exports = $4deaf4da83270089$var$createColors();
$4deaf4da83270089$exports.createColors = $4deaf4da83270089$var$createColors;

var $81fe5d89c91cd67a$exports = {};

var $511d66a60f9f9006$export$ee7a15c61bfdeb11;
var $511d66a60f9f9006$export$98e6a39c04603d36;
$511d66a60f9f9006$export$ee7a15c61bfdeb11 = function (xs) {
  return xs
    .map(function (s) {
      if (s && typeof s === 'object') return s.op.replace(/(.)/g, '\\$1');
      else if (/["\s]/.test(s) && !/'/.test(s))
        return "'" + s.replace(/(['\\])/g, '\\$1') + "'";
      else if (/["'\s]/.test(s))
        return '"' + s.replace(/(["\\$`!])/g, '\\$1') + '"';
      else
        return String(s).replace(
          /([A-Za-z]:)?([#!"$&'()*,:;<=>?@\[\\\]^`{|}])/g,
          '$1\\$2',
        );
    })
    .join(' ');
};
// '<(' is process substitution operator and
// can be parsed the same as control operator
var $511d66a60f9f9006$var$CONTROL =
  '(?:' +
  [
    '\\|\\|',
    '\\&\\&',
    ';;',
    '\\|\\&',
    '\\<\\(',
    '>>',
    '>\\&',
    '[&;()|<>]',
  ].join('|') +
  ')';
var $511d66a60f9f9006$var$META = '|&;()<> \\t';
var $511d66a60f9f9006$var$BAREWORD =
  '(\\\\[\'"' +
  $511d66a60f9f9006$var$META +
  ']|[^\\s\'"' +
  $511d66a60f9f9006$var$META +
  '])+';
var $511d66a60f9f9006$var$SINGLE_QUOTE = '"((\\\\"|[^"])*?)"';
var $511d66a60f9f9006$var$DOUBLE_QUOTE = "'((\\\\'|[^'])*?)'";
var $511d66a60f9f9006$var$TOKEN = '';
for (
  var $511d66a60f9f9006$var$i = 0;
  $511d66a60f9f9006$var$i < 4;
  $511d66a60f9f9006$var$i++
)
  $511d66a60f9f9006$var$TOKEN += (Math.pow(16, 8) * Math.random()).toString(16);
$511d66a60f9f9006$export$98e6a39c04603d36 = function (s, env, opts) {
  var mapped = $511d66a60f9f9006$var$parse(s, env, opts);
  if (typeof env !== 'function') return mapped;
  return mapped.reduce(function (acc, s) {
    if (typeof s === 'object') return acc.concat(s);
    var xs = s.split(
      RegExp(
        '(' +
          $511d66a60f9f9006$var$TOKEN +
          '.*?' +
          $511d66a60f9f9006$var$TOKEN +
          ')',
        'g',
      ),
    );
    if (xs.length === 1) return acc.concat(xs[0]);
    return acc.concat(
      xs.filter(Boolean).map(function (x) {
        if (RegExp('^' + $511d66a60f9f9006$var$TOKEN).test(x))
          return JSON.parse(x.split($511d66a60f9f9006$var$TOKEN)[1]);
        else return x;
      }),
    );
  }, []);
};
function $511d66a60f9f9006$var$parse(s, env, opts) {
  var chunker = new RegExp(
    [
      '(' + $511d66a60f9f9006$var$CONTROL + ')',
      '(' +
        $511d66a60f9f9006$var$BAREWORD +
        '|' +
        $511d66a60f9f9006$var$SINGLE_QUOTE +
        '|' +
        $511d66a60f9f9006$var$DOUBLE_QUOTE +
        ')*',
    ].join('|'),
    'g',
  );
  var match = s.match(chunker).filter(Boolean);
  var commented = false;
  if (!match) return [];
  if (!env) env = {};
  if (!opts) opts = {};
  return match
    .map(function (s, j) {
      if (commented) return;
      if (RegExp('^' + $511d66a60f9f9006$var$CONTROL + '$').test(s))
        return {
          op: s,
        };
      // Hand-written scanner/parser for Bash quoting rules:
      //
      //  1. inside single quotes, all characters are printed literally.
      //  2. inside double quotes, all characters are printed literally
      //     except variables prefixed by '$' and backslashes followed by
      //     either a double quote or another backslash.
      //  3. outside of any quotes, backslashes are treated as escape
      //     characters and not printed (unless they are themselves escaped)
      //  4. quote context can switch mid-token if there is no whitespace
      //     between the two quote contexts (e.g. all'one'"token" parses as
      //     "allonetoken")
      var SQ = "'";
      var DQ = '"';
      var DS = '$';
      var BS = opts.escape || '\\';
      var quote = false;
      var esc = false;
      var out = '';
      var isGlob = false;
      for (var i = 0, len = s.length; i < len; i++) {
        var c = s.charAt(i);
        isGlob = isGlob || (!quote && (c === '*' || c === '?'));
        if (esc) {
          out += c;
          esc = false;
        } else if (quote) {
          if (c === quote) quote = false;
          else if (quote == SQ) out += c;
          else {
            if (c === BS) {
              i += 1;
              c = s.charAt(i);
              if (c === DQ || c === BS || c === DS) out += c;
              else out += BS + c;
            } else if (c === DS) out += parseEnvVar();
            else out += c;
          }
        } else if (c === DQ || c === SQ) quote = c;
        else if (RegExp('^' + $511d66a60f9f9006$var$CONTROL + '$').test(c))
          return {
            op: s,
          };
        else if (RegExp('^#$').test(c)) {
          commented = true;
          if (out.length)
            return [
              out,
              {
                comment: s.slice(i + 1) + match.slice(j + 1).join(' '),
              },
            ];
          return [
            {
              comment: s.slice(i + 1) + match.slice(j + 1).join(' '),
            },
          ];
        } else if (c === BS) esc = true;
        else if (c === DS) out += parseEnvVar();
        else out += c;
      }
      if (isGlob)
        return {
          op: 'glob',
          pattern: out,
        };
      return out;
      function parseEnvVar() {
        i += 1;
        var varend, varname;
        //debugger
        if (s.charAt(i) === '{') {
          i += 1;
          if (s.charAt(i) === '}')
            throw new Error('Bad substitution: ' + s.substr(i - 2, 3));
          varend = s.indexOf('}', i);
          if (varend < 0) throw new Error('Bad substitution: ' + s.substr(i));
          varname = s.substr(i, varend - i);
          i = varend;
        } else if (/[*@#?$!_\-]/.test(s.charAt(i))) {
          varname = s.charAt(i);
          i += 1;
        } else {
          varend = s.substr(i).match(/[^\w\d_]/);
          if (!varend) {
            varname = s.substr(i);
            i = s.length;
          } else {
            varname = s.substr(i, varend.index);
            i += varend.index - 1;
          }
        }
        return getVar(null, '', varname);
      }
    }) // finalize parsed aruments
    .reduce(function (prev, arg) {
      if (arg === undefined) return prev;
      return prev.concat(arg);
    }, []);
  function getVar(_, pre, key) {
    var r = typeof env === 'function' ? env(key) : env[key];
    if (r === undefined && key != '') r = '';
    else if (r === undefined) r = '$';
    if (typeof r === 'object')
      return (
        pre +
        $511d66a60f9f9006$var$TOKEN +
        JSON.stringify(r) +
        $511d66a60f9f9006$var$TOKEN
      );
    else return pre + r;
  }
}

var $1b8a59990d325d85$exports = {};
$1b8a59990d325d85$exports = {
  '/Applications/Atom.app/Contents/MacOS/Atom': 'atom',
  '/Applications/Atom Beta.app/Contents/MacOS/Atom Beta':
    '/Applications/Atom Beta.app/Contents/MacOS/Atom Beta',
  '/Applications/Brackets.app/Contents/MacOS/Brackets': 'brackets',
  '/Applications/Sublime Text.app/Contents/MacOS/Sublime Text':
    '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
  '/Applications/Sublime Text.app/Contents/MacOS/sublime_text':
    '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
  '/Applications/Sublime Text 2.app/Contents/MacOS/Sublime Text 2':
    '/Applications/Sublime Text 2.app/Contents/SharedSupport/bin/subl',
  '/Applications/Sublime Text Dev.app/Contents/MacOS/Sublime Text':
    '/Applications/Sublime Text Dev.app/Contents/SharedSupport/bin/subl',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron': 'code',
  '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron':
    'code-insiders',
  '/Applications/AppCode.app/Contents/MacOS/appcode':
    '/Applications/AppCode.app/Contents/MacOS/appcode',
  '/Applications/CLion.app/Contents/MacOS/clion':
    '/Applications/CLion.app/Contents/MacOS/clion',
  '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea':
    '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea',
  '/Applications/PhpStorm.app/Contents/MacOS/phpstorm':
    '/Applications/PhpStorm.app/Contents/MacOS/phpstorm',
  '/Applications/PyCharm.app/Contents/MacOS/pycharm':
    '/Applications/PyCharm.app/Contents/MacOS/pycharm',
  '/Applications/PyCharm CE.app/Contents/MacOS/pycharm':
    '/Applications/PyCharm CE.app/Contents/MacOS/pycharm',
  '/Applications/RubyMine.app/Contents/MacOS/rubymine':
    '/Applications/RubyMine.app/Contents/MacOS/rubymine',
  '/Applications/WebStorm.app/Contents/MacOS/webstorm':
    '/Applications/WebStorm.app/Contents/MacOS/webstorm',
};

var $378b7c9a9034cfb2$exports = {};
$378b7c9a9034cfb2$exports = {
  atom: 'atom',
  Brackets: 'brackets',
  code: 'code',
  emacs: 'emacs',
  'idea.sh': 'idea',
  'phpstorm.sh': 'phpstorm',
  'pycharm.sh': 'pycharm',
  'rubymine.sh': 'rubymine',
  sublime_text: 'subl',
  vim: 'vim',
  'webstorm.sh': 'webstorm',
};

var $9e92800d5e240889$exports = {};
$9e92800d5e240889$exports = [
  'Brackets.exe',
  'Code.exe',
  'atom.exe',
  'sublime_text.exe',
  'notepad++.exe',
  'clion.exe',
  'clion64.exe',
  'idea.exe',
  'idea64.exe',
  'phpstorm.exe',
  'phpstorm64.exe',
  'pycharm.exe',
  'pycharm64.exe',
  'rubymine.exe',
  'rubymine64.exe',
  'webstorm.exe',
  'webstorm64.exe',
];

$81fe5d89c91cd67a$exports = function guessEditor(specifiedEditor) {
  if (specifiedEditor)
    return $511d66a60f9f9006$export$98e6a39c04603d36(specifiedEditor);
  // We can find out which editor is currently running by:
  // `ps x` on macOS and Linux
  // `Get-Process` on Windows
  try {
    if (process.platform === 'darwin') {
      const output = $dmXIQ$child_process.execSync('ps x').toString();
      const processNames = Object.keys($1b8a59990d325d85$exports);
      for (let i = 0; i < processNames.length; i++) {
        const processName = processNames[i];
        if (output.indexOf(processName) !== -1)
          return [$1b8a59990d325d85$exports[processName]];
      }
    } else if (process.platform === 'win32') {
      const output = $dmXIQ$child_process
        .execSync('powershell -Command "Get-Process | Select-Object Path"', {
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        .toString();
      const runningProcesses = output.split('\r\n');
      for (let i = 0; i < runningProcesses.length; i++) {
        // `Get-Process` sometimes returns empty lines
        if (!runningProcesses[i]) continue;
        const fullProcessPath = runningProcesses[i].trim();
        const shortProcessName = $dmXIQ$path.basename(fullProcessPath);
        if ($9e92800d5e240889$exports.indexOf(shortProcessName) !== -1)
          return [fullProcessPath];
      }
    } else if (process.platform === 'linux') {
      // --no-heading No header line
      // x List all processes owned by you
      // -o comm Need only names column
      const output = $dmXIQ$child_process
        .execSync('ps x --no-heading -o comm --sort=comm')
        .toString();
      const processNames = Object.keys($378b7c9a9034cfb2$exports);
      for (let i = 0; i < processNames.length; i++) {
        const processName = processNames[i];
        if (output.indexOf(processName) !== -1)
          return [$378b7c9a9034cfb2$exports[processName]];
      }
    }
  } catch (error) {
    // Ignore...
  }
  // Last resort, use old skool env vars
  if (process.env.VISUAL) return [process.env.VISUAL];
  else if (process.env.EDITOR) return [process.env.EDITOR];
  return [null];
};

var $5ba07716d13409fa$exports = {};

// normalize file/line numbers into command line args for specific editors
$5ba07716d13409fa$exports = function getArgumentsForPosition(
  editor,
  fileName,
  lineNumber,
  columnNumber = 1,
) {
  const editorBasename = $dmXIQ$path
    .basename(editor)
    .replace(/\.(exe|cmd|bat)$/i, '');
  switch (editorBasename) {
    case 'atom':
    case 'Atom':
    case 'Atom Beta':
    case 'subl':
    case 'sublime':
    case 'sublime_text':
    case 'wstorm':
    case 'charm':
      return [`${fileName}:${lineNumber}:${columnNumber}`];
    case 'notepad++':
      return ['-n' + lineNumber, fileName];
    case 'vim':
    case 'mvim':
      return [`+call cursor(${lineNumber}, ${columnNumber})`, fileName];
    case 'joe':
      return ['+' + `${lineNumber}`, fileName];
    case 'emacs':
    case 'emacsclient':
      return [`+${lineNumber}:${columnNumber}`, fileName];
    case 'rmate':
    case 'mate':
    case 'mine':
      return ['--line', lineNumber, fileName];
    case 'code':
    case 'code-insiders':
    case 'Code':
      return ['-r', '-g', `${fileName}:${lineNumber}:${columnNumber}`];
    case 'appcode':
    case 'clion':
    case 'clion64':
    case 'idea':
    case 'idea64':
    case 'phpstorm':
    case 'phpstorm64':
    case 'pycharm':
    case 'pycharm64':
    case 'rubymine':
    case 'rubymine64':
    case 'webstorm':
    case 'webstorm64':
      return ['--line', lineNumber, fileName];
  }
  // For all others, drop the lineNumber until we have
  // a mapping above, since providing the lineNumber incorrectly
  // can result in errors or confusing behavior.
  return [fileName];
};

function $9adaf3fd5745e4a0$var$wrapErrorCallback(cb) {
  return (fileName, errorMessage) => {
    console.log();
    console.log(
      $4deaf4da83270089$exports.red(
        'Could not open ' + $dmXIQ$path.basename(fileName) + ' in the editor.',
      ),
    );
    if (errorMessage) {
      if (errorMessage[errorMessage.length - 1] !== '.') errorMessage += '.';
      console.log(
        $4deaf4da83270089$exports.red(
          'The editor process exited with an error: ' + errorMessage,
        ),
      );
    }
    console.log();
    if (cb) cb(fileName, errorMessage);
  };
}
function $9adaf3fd5745e4a0$var$isTerminalEditor(editor) {
  switch (editor) {
    case 'vim':
    case 'emacs':
    case 'nano':
      return true;
  }
  return false;
}
const $9adaf3fd5745e4a0$var$positionRE = /:(\d+)(:(\d+))?$/;
function $9adaf3fd5745e4a0$var$parseFile(file) {
  const fileName = file.replace($9adaf3fd5745e4a0$var$positionRE, '');
  const match = file.match($9adaf3fd5745e4a0$var$positionRE);
  const lineNumber = match && match[1];
  const columnNumber = match && match[3];
  return {
    fileName: fileName,
    lineNumber: lineNumber,
    columnNumber: columnNumber,
  };
}
let $9adaf3fd5745e4a0$var$_childProcess = null;
function $9adaf3fd5745e4a0$var$launchEditor(
  file,
  specifiedEditor,
  onErrorCallback,
) {
  const parsed = $9adaf3fd5745e4a0$var$parseFile(file);
  let {fileName: fileName} = parsed;
  const {lineNumber: lineNumber, columnNumber: columnNumber} = parsed;
  if (!$dmXIQ$fs.existsSync(fileName)) return;
  if (typeof specifiedEditor === 'function') {
    onErrorCallback = specifiedEditor;
    specifiedEditor = undefined;
  }
  onErrorCallback = $9adaf3fd5745e4a0$var$wrapErrorCallback(onErrorCallback);
  const [editor, ...args] = $81fe5d89c91cd67a$exports(specifiedEditor);
  if (!editor) {
    onErrorCallback(fileName, null);
    return;
  }
  if (
    process.platform === 'linux' &&
    fileName.startsWith('/mnt/') &&
    /Microsoft/i.test($dmXIQ$os.release())
  )
    // Assume WSL / "Bash on Ubuntu on Windows" is being used, and
    // that the file exists on the Windows file system.
    // `os.release()` is "4.4.0-43-Microsoft" in the current release
    // build of WSL, see: https://github.com/Microsoft/BashOnWindows/issues/423#issuecomment-221627364
    // When a Windows editor is specified, interop functionality can
    // handle the path translation, but only if a relative path is used.
    fileName = $dmXIQ$path.relative('', fileName);
  if (lineNumber) {
    const extraArgs = $5ba07716d13409fa$exports(
      editor,
      fileName,
      lineNumber,
      columnNumber,
    );
    args.push.apply(args, extraArgs);
  } else args.push(fileName);
  if (
    $9adaf3fd5745e4a0$var$_childProcess &&
    $9adaf3fd5745e4a0$var$isTerminalEditor(editor)
  )
    // There's an existing editor process already and it's attached
    // to the terminal, so go kill it. Otherwise two separate editor
    // instances attach to the stdin/stdout which gets confusing.
    $9adaf3fd5745e4a0$var$_childProcess.kill('SIGKILL');
  if (process.platform === 'win32')
    // On Windows, launch the editor in a shell because spawn can only
    // launch .exe files.
    $9adaf3fd5745e4a0$var$_childProcess = $dmXIQ$child_process.spawn(
      'cmd.exe',
      ['/C', editor].concat(args),
      {
        stdio: 'inherit',
      },
    );
  else
    $9adaf3fd5745e4a0$var$_childProcess = $dmXIQ$child_process.spawn(
      editor,
      args,
      {
        stdio: 'inherit',
      },
    );
  $9adaf3fd5745e4a0$var$_childProcess.on('exit', function (errorCode) {
    $9adaf3fd5745e4a0$var$_childProcess = null;
    if (errorCode) onErrorCallback(fileName, '(code ' + errorCode + ')');
  });
  $9adaf3fd5745e4a0$var$_childProcess.on('error', function (error) {
    onErrorCallback(fileName, error.message);
  });
}
$9adaf3fd5745e4a0$exports = $9adaf3fd5745e4a0$var$launchEditor;

var $cc74c506b8456793$exports = {};
/*!
 * fresh
 * Copyright(c) 2012 TJ Holowaychuk
 * Copyright(c) 2016-2017 Douglas Christopher Wilson
 * MIT Licensed
 */ ('use strict');
/**
 * RegExp to check for no-cache token in Cache-Control.
 * @private
 */ var $cc74c506b8456793$var$CACHE_CONTROL_NO_CACHE_REGEXP =
  /(?:^|,)\s*?no-cache\s*?(?:,|$)/;
/**
 * Module exports.
 * @public
 */ $cc74c506b8456793$exports = $cc74c506b8456793$var$fresh;
/**
 * Check freshness of the response using request and response headers.
 *
 * @param {Object} reqHeaders
 * @param {Object} resHeaders
 * @return {Boolean}
 * @public
 */ function $cc74c506b8456793$var$fresh(reqHeaders, resHeaders) {
  // fields
  var modifiedSince = reqHeaders['if-modified-since'];
  var noneMatch = reqHeaders['if-none-match'];
  // unconditional request
  if (!modifiedSince && !noneMatch) return false;
  // Always return stale when Cache-Control: no-cache
  // to support end-to-end reload requests
  // https://tools.ietf.org/html/rfc2616#section-14.9.4
  var cacheControl = reqHeaders['cache-control'];
  if (
    cacheControl &&
    $cc74c506b8456793$var$CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl)
  )
    return false;
  // if-none-match
  if (noneMatch && noneMatch !== '*') {
    var etag = resHeaders['etag'];
    if (!etag) return false;
    var etagStale = true;
    var matches = $cc74c506b8456793$var$parseTokenList(noneMatch);
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
        etagStale = false;
        break;
      }
    }
    if (etagStale) return false;
  }
  // if-modified-since
  if (modifiedSince) {
    var lastModified = resHeaders['last-modified'];
    var modifiedStale =
      !lastModified ||
      !(
        $cc74c506b8456793$var$parseHttpDate(lastModified) <=
        $cc74c506b8456793$var$parseHttpDate(modifiedSince)
      );
    if (modifiedStale) return false;
  }
  return true;
}
/**
 * Parse an HTTP Date into a number.
 *
 * @param {string} date
 * @private
 */ function $cc74c506b8456793$var$parseHttpDate(date) {
  var timestamp = date && Date.parse(date);
  // istanbul ignore next: guard against date.js Date.parse patching
  return typeof timestamp === 'number' ? timestamp : NaN;
}
/**
 * Parse a HTTP token list.
 *
 * @param {string} str
 * @private
 */ function $cc74c506b8456793$var$parseTokenList(str) {
  var end = 0;
  var list = [];
  var start = 0;
  // gather tokens
  for (var i = 0, len = str.length; i < len; i++)
    switch (str.charCodeAt(i)) {
      case 0x20:
        /*   */ if (start === end) start = end = i + 1;
        break;
      case 0x2c:
        /* , */ list.push(str.substring(start, end));
        start = end = i + 1;
        break;
      default:
        end = i + 1;
        break;
    }
  // final token
  list.push(str.substring(start, end));
  return list;
}

var $b3757033280ef47e$var$$parcel$__dirname = $dmXIQ$path.resolve(
  __dirname,
  '../src',
);
function $b3757033280ef47e$export$1c94a12dbc96ed70(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, HEAD, PUT, PATCH, POST, DELETE',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Content-Type',
  );
  res.setHeader('Cache-Control', 'max-age=0, must-revalidate');
}
const $b3757033280ef47e$var$SLASH_REGEX = /\//g;
const $b3757033280ef47e$export$48c584f74c55688f = '/__parcel_source_root';
const $b3757033280ef47e$var$EDITOR_ENDPOINT = '/__parcel_launch_editor';
const $b3757033280ef47e$var$TEMPLATE_404 = (0,
$parcel$interopDefault($dmXIQ$fs)).readFileSync(
  (0, $parcel$interopDefault($dmXIQ$path)).join(
    $b3757033280ef47e$var$$parcel$__dirname,
    'templates/404.html',
  ),
  'utf8',
);
const $b3757033280ef47e$var$TEMPLATE_500 = (0,
$parcel$interopDefault($dmXIQ$fs)).readFileSync(
  (0, $parcel$interopDefault($dmXIQ$path)).join(
    $b3757033280ef47e$var$$parcel$__dirname,
    'templates/500.html',
  ),
  'utf8',
);
class $b3757033280ef47e$export$2e2bcd8739ae039 {
  constructor(options) {
    this.options = options;
    try {
      this.rootPath = new (0, $dmXIQ$url.URL)(options.publicUrl).pathname;
    } catch (e) {
      this.rootPath = options.publicUrl;
    }
    this.pending = true;
    this.pendingRequests = [];
    this.middleware = [];
    this.bundleGraph = null;
    this.requestBundle = null;
    this.errors = null;
  }
  buildStart() {
    this.pending = true;
  }
  buildSuccess(bundleGraph, requestBundle) {
    this.bundleGraph = bundleGraph;
    this.requestBundle = requestBundle;
    this.errors = null;
    this.pending = false;
    if (this.pendingRequests.length > 0) {
      let pendingRequests = this.pendingRequests;
      this.pendingRequests = [];
      for (let [req, res] of pendingRequests) this.respond(req, res);
    }
  }
  async buildError(options, diagnostics) {
    this.pending = false;
    this.errors = await Promise.all(
      diagnostics.map(async d => {
        let ansiDiagnostic = await (0, $dmXIQ$parcelutils.prettyDiagnostic)(
          d,
          options,
        );
        var _d_documentationURL;
        return {
          message: (0, $dmXIQ$parcelutils.ansiHtml)(ansiDiagnostic.message),
          stack: ansiDiagnostic.stack
            ? (0, $dmXIQ$parcelutils.ansiHtml)(ansiDiagnostic.stack)
            : null,
          frames: ansiDiagnostic.frames.map(f => ({
            location: f.location,
            code: (0, $dmXIQ$parcelutils.ansiHtml)(f.code),
          })),
          hints: ansiDiagnostic.hints.map(hint =>
            (0, $dmXIQ$parcelutils.ansiHtml)(hint),
          ),
          documentation:
            (_d_documentationURL = d.documentationURL) !== null &&
            _d_documentationURL !== void 0
              ? _d_documentationURL
              : '',
        };
      }),
    );
  }
  respond(req, res) {
    if (this.middleware.some(handler => handler(req, res))) return;
    let {pathname: pathname, search: search} = (0,
    $parcel$interopDefault($dmXIQ$url)).parse(req.originalUrl || req.url);
    if (pathname == null) pathname = '/';
    if (pathname.startsWith($b3757033280ef47e$var$EDITOR_ENDPOINT) && search) {
      let query = new (0, $dmXIQ$url.URLSearchParams)(search);
      let file = query.get('file');
      if (file) {
        // File location might start with /__parcel_source_root if it came from a source map.
        if (file.startsWith($b3757033280ef47e$export$48c584f74c55688f))
          file = file.slice(
            $b3757033280ef47e$export$48c584f74c55688f.length + 1,
          );
        (0, /*@__PURE__*/ $parcel$interopDefault($9adaf3fd5745e4a0$exports))(
          file,
        );
      }
      res.end();
    } else if (this.errors) return this.send500(req, res);
    else if ((0, $parcel$interopDefault($dmXIQ$path)).extname(pathname) === '')
      // If the URL doesn't start with the public path, or the URL doesn't
      // have a file extension, send the main HTML bundle.
      return this.sendIndex(req, res);
    else if (pathname.startsWith($b3757033280ef47e$export$48c584f74c55688f)) {
      req.url = pathname.slice(
        $b3757033280ef47e$export$48c584f74c55688f.length,
      );
      return this.serve(
        this.options.inputFS,
        this.options.projectRoot,
        req,
        res,
        () => this.send404(req, res),
      );
    } else if (pathname.startsWith(this.rootPath)) {
      // Otherwise, serve the file from the dist folder
      req.url =
        this.rootPath === '/' ? pathname : pathname.slice(this.rootPath.length);
      if (req.url[0] !== '/') req.url = '/' + req.url;
      return this.serveBundle(req, res, () => this.sendIndex(req, res));
    } else return this.send404(req, res);
  }
  sendIndex(req, res) {
    if (this.bundleGraph) {
      // If the main asset is an HTML file, serve it
      let htmlBundleFilePaths = this.bundleGraph
        .getBundles()
        .filter(
          bundle =>
            (0, $parcel$interopDefault($dmXIQ$path)).posix.extname(
              bundle.name,
            ) === '.html',
        )
        .map(bundle => {
          return `/${(0, $dmXIQ$parcelutils.relativePath)(
            this.options.distDir,
            bundle.filePath,
            false,
          )}`;
        });
      let indexFilePath = null;
      let {pathname: reqURL} = (0, $parcel$interopDefault($dmXIQ$url)).parse(
        req.originalUrl || req.url,
      );
      if (!reqURL) reqURL = '/';
      if (htmlBundleFilePaths.length === 1)
        indexFilePath = htmlBundleFilePaths[0];
      else {
        let bestMatch = null;
        for (let bundle of htmlBundleFilePaths) {
          let bundleDir = (0,
          $parcel$interopDefault($dmXIQ$path)).posix.dirname(bundle);
          let bundleDirSubdir = bundleDir === '/' ? bundleDir : bundleDir + '/';
          let withoutExtension = (0,
          $parcel$interopDefault($dmXIQ$path)).posix.basename(
            bundle,
            (0, $parcel$interopDefault($dmXIQ$path)).posix.extname(bundle),
          );
          let matchesIsIndex = null;
          if (
            withoutExtension === 'index' &&
            (reqURL.startsWith(bundleDirSubdir) || reqURL === bundleDir)
          )
            // bundle is /bar/index.html and (/bar or something inside of /bar/** was requested was requested)
            matchesIsIndex = true;
          else if (
            reqURL ==
            (0, $parcel$interopDefault($dmXIQ$path)).posix.join(
              bundleDir,
              withoutExtension,
            )
          )
            // bundle is /bar/foo.html and /bar/foo was requested
            matchesIsIndex = false;
          if (matchesIsIndex != null) {
            var _bundle_match;
            var _bundle_match_length;
            let depth =
              (_bundle_match_length =
                (_bundle_match = bundle.match(
                  $b3757033280ef47e$var$SLASH_REGEX,
                )) === null || _bundle_match === void 0
                  ? void 0
                  : _bundle_match.length) !== null &&
              _bundle_match_length !== void 0
                ? _bundle_match_length
                : 0;
            if (
              bestMatch == null || // This one is more specific (deeper)
              bestMatch.depth < depth || // This one is just as deep, but the bundle name matches and not just index.html
              (bestMatch.depth === depth && bestMatch.isIndex)
            )
              bestMatch = {
                bundle: bundle,
                depth: depth,
                isIndex: matchesIsIndex,
              };
          }
        }
        var _bestMatch_bundle;
        indexFilePath =
          (_bestMatch_bundle =
            bestMatch === null || bestMatch === void 0
              ? void 0
              : bestMatch['bundle']) !== null && _bestMatch_bundle !== void 0
            ? _bestMatch_bundle
            : htmlBundleFilePaths[0];
      }
      if (indexFilePath) {
        req.url = indexFilePath;
        this.serveBundle(req, res, () => this.send404(req, res));
      } else this.send404(req, res);
    } else this.send404(req, res);
  }
  async serveBundle(req, res, next) {
    let bundleGraph = this.bundleGraph;
    if (bundleGraph) {
      let {pathname: pathname} = (0, $parcel$interopDefault($dmXIQ$url)).parse(
        req.url,
      );
      if (!pathname) {
        this.send500(req, res);
        return;
      }
      let requestedPath = (0, $parcel$interopDefault($dmXIQ$path)).normalize(
        pathname.slice(1),
      );
      let bundle = bundleGraph
        .getBundles()
        .find(
          b =>
            (0, $parcel$interopDefault($dmXIQ$path)).relative(
              this.options.distDir,
              b.filePath,
            ) === requestedPath,
        );
      if (!bundle) {
        this.serveDist(req, res, next);
        return;
      }
      (0, $parcel$interopDefault($dmXIQ$assert))(this.requestBundle != null);
      try {
        await this.requestBundle(bundle);
      } catch (err) {
        this.send500(req, res);
        return;
      }
      this.serveDist(req, res, next);
    } else this.send404(req, res);
  }
  serveDist(req, res, next) {
    return this.serve(
      this.options.outputFS,
      this.options.distDir,
      req,
      res,
      next,
    );
  }
  async serve(fs, root, req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // method not allowed
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }
    try {
      var filePath =
        (0, $parcel$interopDefault($dmXIQ$url)).parse(req.url).pathname || '';
      filePath = decodeURIComponent(filePath);
    } catch (err) {
      return this.sendError(res, 400);
    }
    filePath = (0, $parcel$interopDefault($dmXIQ$path)).normalize(
      '.' + (0, $parcel$interopDefault($dmXIQ$path)).sep + filePath,
    );
    // malicious path
    if (
      filePath.includes(
        (0, $parcel$interopDefault($dmXIQ$path)).sep +
          '..' +
          (0, $parcel$interopDefault($dmXIQ$path)).sep,
      )
    )
      return this.sendError(res, 403);
    // join / normalize from the root dir
    if (!(0, $parcel$interopDefault($dmXIQ$path)).isAbsolute(filePath))
      filePath = (0, $parcel$interopDefault($dmXIQ$path)).normalize(
        (0, $parcel$interopDefault($dmXIQ$path)).join(root, filePath),
      );
    try {
      var stat = await fs.stat(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') return next(req, res);
      return this.sendError(res, 500);
    }
    // Fall back to next handler if not a file
    if (!stat || !stat.isFile()) return next(req, res);
    if (
      (0, /*@__PURE__*/ $parcel$interopDefault($cc74c506b8456793$exports))(
        req.headers,
        {
          'last-modified': stat.mtime.toUTCString(),
        },
      )
    ) {
      res.statusCode = 304;
      res.end();
      return;
    }
    return (0, /*@__PURE__*/ $parcel$interopDefault($116f4e94d746e22c$exports))(
      req,
      res,
      {
        public: root,
        cleanUrls: false,
      },
      {
        lstat: path => fs.stat(path),
        realpath: path => fs.realpath(path),
        createReadStream: (path, options) => fs.createReadStream(path, options),
        readdir: path => fs.readdir(path),
      },
    );
  }
  sendError(res, statusCode) {
    res.statusCode = statusCode;
    res.end();
  }
  send404(req, res) {
    res.statusCode = 404;
    res.end($b3757033280ef47e$var$TEMPLATE_404);
  }
  send500(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(500);
    if (this.errors)
      return res.end(
        (0,
        /*@__PURE__*/ $parcel$interopDefault($902cd20c67b03e91$exports)).render(
          $b3757033280ef47e$var$TEMPLATE_500,
          {
            errors: this.errors,
            hmrOptions: this.options.hmrOptions,
          },
        ),
      );
  }
  logAccessIfVerbose(req) {
    this.options.logger.verbose({
      message: `Request: ${req.headers.host}${req.originalUrl || req.url}`,
    });
  }
  /**
   * Load proxy table from package.json and apply them.
   */ async applyProxyTable(app) {
    // avoid skipping project root
    const fileInRoot = (0, $parcel$interopDefault($dmXIQ$path)).join(
      this.options.projectRoot,
      'index',
    );
    const configFilePath = await (0, $dmXIQ$parcelutils.resolveConfig)(
      this.options.inputFS,
      fileInRoot,
      [
        '.proxyrc.cjs',
        '.proxyrc.mjs',
        '.proxyrc.js',
        '.proxyrc',
        '.proxyrc.json',
      ],
      this.options.projectRoot,
    );
    if (!configFilePath) return this;
    const filename = (0, $parcel$interopDefault($dmXIQ$path)).basename(
      configFilePath,
    );
    if (
      filename === '.proxyrc.js' ||
      filename === '.proxyrc.cjs' ||
      filename === '.proxyrc.mjs'
    ) {
      // $FlowFixMe
      // let cfg = (await import(configFilePath)).default;
      let cfg = await this.options.packageManager.require(
        configFilePath,
        fileInRoot,
      );
      if (
        // $FlowFixMe
        Object.prototype.toString.call(cfg) === '[object Module]'
      )
        cfg = cfg.default;
      if (typeof cfg !== 'function') {
        this.options.logger.warn({
          message: `Proxy configuration file '${filename}' should export a function. Skipping...`,
        });
        return this;
      }
      cfg(app);
    } else if (filename === '.proxyrc' || filename === '.proxyrc.json') {
      let conf = await (0, $dmXIQ$parcelutils.readConfig)(
        this.options.inputFS,
        configFilePath,
      );
      if (!conf) return this;
      let cfg = conf.config;
      if (typeof cfg !== 'object') {
        this.options.logger.warn({
          message:
            "Proxy table in '.proxyrc' should be of object type. Skipping...",
        });
        return this;
      }
      for (const [context, options] of Object.entries(cfg)) // each key is interpreted as context, and value as middleware options
        app.use(
          (0, $1187a10c6610a8e2$exports.createProxyMiddleware)(
            context,
            options,
          ),
        );
    }
    return this;
  }
  async start() {
    const finalHandler = (req, res) => {
      this.logAccessIfVerbose(req);
      // Wait for the parcelInstance to finish bundling if needed
      if (this.pending) this.pendingRequests.push([req, res]);
      else this.respond(req, res);
    };
    const app = (0,
    /*@__PURE__*/ $parcel$interopDefault($c969ebc216babcb0$exports))();
    app.use((req, res, next) => {
      $b3757033280ef47e$export$1c94a12dbc96ed70(res);
      next();
    });
    await this.applyProxyTable(app);
    app.use(finalHandler);
    let {server: server, stop: stop} = await (0,
    $dmXIQ$parcelutils.createHTTPServer)({
      cacheDir: this.options.cacheDir,
      https: this.options.https,
      inputFS: this.options.inputFS,
      listener: app,
      outputFS: this.options.outputFS,
      host: this.options.host,
    });
    this.stopServer = stop;
    server.listen(this.options.port, this.options.host);
    return new Promise((resolve, reject) => {
      server.once('error', err => {
        this.options.logger.error({
          message: (0, $e2337524fa4d3e41$export$2e2bcd8739ae039)(
            err,
            this.options.port,
          ),
        });
        reject(err);
      });
      server.once('listening', () => {
        resolve(server);
      });
    });
  }
  async stop() {
    (0, $parcel$interopDefault($dmXIQ$assert))(this.stopServer != null);
    await this.stopServer();
    this.stopServer = null;
  }
}

var $072abbf85809ad5d$exports = {};
('use strict');
function $072abbf85809ad5d$var$nullthrows(x, message) {
  if (x != null) return x;
  var error = new Error(
    message !== undefined ? message : 'Got unexpected ' + x,
  );
  error.framesToPop = 1; // Skip nullthrows's own stack frame.
  throw error;
}
$072abbf85809ad5d$exports = $072abbf85809ad5d$var$nullthrows;
$072abbf85809ad5d$exports.default = $072abbf85809ad5d$var$nullthrows;
Object.defineProperty($072abbf85809ad5d$exports, '__esModule', {
  value: true,
});

var $ef48ac872575535b$exports = {};

$parcel$export(
  $ef48ac872575535b$exports,
  'charset',
  () => $ef48ac872575535b$export$e4c823724462c3fd,
  v => ($ef48ac872575535b$export$e4c823724462c3fd = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'charsets',
  () => $ef48ac872575535b$export$48d2c0a44ea41a2f,
  v => ($ef48ac872575535b$export$48d2c0a44ea41a2f = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'contentType',
  () => $ef48ac872575535b$export$8019223850b8bf78,
  v => ($ef48ac872575535b$export$8019223850b8bf78 = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'extension',
  () => $ef48ac872575535b$export$1b45514b112dd749,
  v => ($ef48ac872575535b$export$1b45514b112dd749 = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'extensions',
  () => $ef48ac872575535b$export$cc3e2d3244e01b7f,
  v => ($ef48ac872575535b$export$cc3e2d3244e01b7f = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'lookup',
  () => $ef48ac872575535b$export$dfc7155ac0343b8,
  v => ($ef48ac872575535b$export$dfc7155ac0343b8 = v),
);
$parcel$export(
  $ef48ac872575535b$exports,
  'types',
  () => $ef48ac872575535b$export$b14ad400b1d09e0f,
  v => ($ef48ac872575535b$export$b14ad400b1d09e0f = v),
);
/*!
 * mime-types
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ var $ef48ac872575535b$export$e4c823724462c3fd;
var $ef48ac872575535b$export$48d2c0a44ea41a2f;
var $ef48ac872575535b$export$8019223850b8bf78;
var $ef48ac872575535b$export$1b45514b112dd749;
var $ef48ac872575535b$export$cc3e2d3244e01b7f;
var $ef48ac872575535b$export$dfc7155ac0343b8;
var $ef48ac872575535b$export$b14ad400b1d09e0f;
('use strict');
var $2dcf772848bb127c$exports = {};
/*!
 * mime-db
 * Copyright(c) 2014 Jonathan Ong
 * MIT Licensed
 */ /**
 * Module exports.
 */
$2dcf772848bb127c$exports = parcelRequire('gpqFG');

var $ef48ac872575535b$require$extname = $dmXIQ$path.extname;
/**
 * Module variables.
 * @private
 */ var $ef48ac872575535b$var$EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/;
var $ef48ac872575535b$var$TEXT_TYPE_REGEXP = /^text\//i;
$ef48ac872575535b$export$e4c823724462c3fd = $ef48ac872575535b$var$charset;
$ef48ac872575535b$export$48d2c0a44ea41a2f = {
  lookup: $ef48ac872575535b$var$charset,
};
$ef48ac872575535b$export$8019223850b8bf78 = $ef48ac872575535b$var$contentType;
$ef48ac872575535b$export$1b45514b112dd749 = $ef48ac872575535b$var$extension;
$ef48ac872575535b$export$cc3e2d3244e01b7f = Object.create(null);
$ef48ac872575535b$export$dfc7155ac0343b8 = $ef48ac872575535b$var$lookup;
$ef48ac872575535b$export$b14ad400b1d09e0f = Object.create(null);
// Populate the extensions/types maps
$ef48ac872575535b$var$populateMaps(
  $ef48ac872575535b$export$cc3e2d3244e01b7f,
  $ef48ac872575535b$export$b14ad400b1d09e0f,
);
/**
 * Get the default charset for a MIME type.
 *
 * @param {string} type
 * @return {boolean|string}
 */ function $ef48ac872575535b$var$charset(type) {
  if (!type || typeof type !== 'string') return false;
  // TODO: use media-typer
  var match = $ef48ac872575535b$var$EXTRACT_TYPE_REGEXP.exec(type);
  var mime = match && $2dcf772848bb127c$exports[match[1].toLowerCase()];
  if (mime && mime.charset) return mime.charset;
  // default text/* to utf-8
  if (match && $ef48ac872575535b$var$TEXT_TYPE_REGEXP.test(match[1]))
    return 'UTF-8';
  return false;
}
/**
 * Create a full Content-Type header given a MIME type or extension.
 *
 * @param {string} str
 * @return {boolean|string}
 */ function $ef48ac872575535b$var$contentType(str) {
  // TODO: should this even be in this module?
  if (!str || typeof str !== 'string') return false;
  var mime =
    str.indexOf('/') === -1
      ? $ef48ac872575535b$export$dfc7155ac0343b8(str)
      : str;
  if (!mime) return false;
  // TODO: use content-type or other module
  if (mime.indexOf('charset') === -1) {
    var charset = $ef48ac872575535b$export$e4c823724462c3fd(mime);
    if (charset) mime += '; charset=' + charset.toLowerCase();
  }
  return mime;
}
/**
 * Get the default extension for a MIME type.
 *
 * @param {string} type
 * @return {boolean|string}
 */ function $ef48ac872575535b$var$extension(type) {
  if (!type || typeof type !== 'string') return false;
  // TODO: use media-typer
  var match = $ef48ac872575535b$var$EXTRACT_TYPE_REGEXP.exec(type);
  // get extensions
  var exts =
    match && $ef48ac872575535b$export$cc3e2d3244e01b7f[match[1].toLowerCase()];
  if (!exts || !exts.length) return false;
  return exts[0];
}
/**
 * Lookup the MIME type for a file path/extension.
 *
 * @param {string} path
 * @return {boolean|string}
 */ function $ef48ac872575535b$var$lookup(path) {
  if (!path || typeof path !== 'string') return false;
  // get the extension ("ext" or ".ext" or full path)
  var extension = $ef48ac872575535b$require$extname('x.' + path)
    .toLowerCase()
    .substr(1);
  if (!extension) return false;
  return $ef48ac872575535b$export$b14ad400b1d09e0f[extension] || false;
}
/**
 * Populate the extensions and types maps.
 * @private
 */ function $ef48ac872575535b$var$populateMaps(extensions, types) {
  // source preference (least -> most)
  var preference = ['nginx', 'apache', undefined, 'iana'];
  Object.keys($2dcf772848bb127c$exports).forEach(function forEachMimeType(
    type,
  ) {
    var mime = $2dcf772848bb127c$exports[type];
    var exts = mime.extensions;
    if (!exts || !exts.length) return;
    // mime -> extensions
    extensions[type] = exts;
    // extension -> mime
    for (var i = 0; i < exts.length; i++) {
      var extension = exts[i];
      if (types[extension]) {
        var from = preference.indexOf(
          $2dcf772848bb127c$exports[types[extension]].source,
        );
        var to = preference.indexOf(mime.source);
        if (
          types[extension] !== 'application/octet-stream' &&
          (from > to ||
            (from === to && types[extension].substr(0, 12) === 'application/'))
        )
          continue;
      }
      // set the extension -> mime
      types[extension] = type;
    }
  });
}

var $2726b9117a59a124$exports = {};
('use strict');

var $iKo1y = parcelRequire('iKo1y');

$iKo1y.createWebSocketStream = parcelRequire('jW2m9');

$iKo1y.Server = parcelRequire('8Pgpp');

$iKo1y.Receiver = parcelRequire('9Puct');

$iKo1y.Sender = parcelRequire('f0Djp');
$2726b9117a59a124$exports = $iKo1y;

const $fa03334b86d7a256$var$FS_CONCURRENCY = 64;
const $fa03334b86d7a256$var$HMR_ENDPOINT = '/__parcel_hmr';
class $fa03334b86d7a256$export$2e2bcd8739ae039 {
  unresolvedError = null;
  bundleGraph = null;
  constructor(options) {
    this.options = options;
  }
  async start() {
    var _this_options_addMiddleware, _this_options;
    let server = this.options.devServer;
    if (!server) {
      let result = await (0, $dmXIQ$parcelutils.createHTTPServer)({
        listener: (req, res) => {
          (0, $b3757033280ef47e$export$1c94a12dbc96ed70)(res);
          if (!this.handle(req, res)) {
            res.statusCode = 404;
            res.end();
          }
        },
      });
      server = result.server;
      server.listen(this.options.port, this.options.host);
      this.stopServer = result.stop;
    } else
      (_this_options_addMiddleware = (_this_options = this.options)
        .addMiddleware) === null || _this_options_addMiddleware === void 0
        ? void 0
        : _this_options_addMiddleware.call(_this_options, (req, res) =>
            this.handle(req, res),
          );
    this.wss = new (0,
    /*@__PURE__*/ $parcel$interopDefault($2726b9117a59a124$exports)).Server({
      server: server,
    });
    this.wss.on('connection', ws => {
      if (this.unresolvedError) ws.send(JSON.stringify(this.unresolvedError));
    });
    // $FlowFixMe[incompatible-exact]
    this.wss.on('error', err => this.handleSocketError(err));
  }
  handle(req, res) {
    let {pathname: pathname} = (0, $parcel$interopDefault($dmXIQ$url)).parse(
      req.originalUrl || req.url,
    );
    if (
      pathname != null &&
      pathname.startsWith($fa03334b86d7a256$var$HMR_ENDPOINT)
    ) {
      let id = pathname.slice($fa03334b86d7a256$var$HMR_ENDPOINT.length + 1);
      let bundleGraph = (0,
      /*@__PURE__*/ $parcel$interopDefault($072abbf85809ad5d$exports))(
        this.bundleGraph,
      );
      let asset = bundleGraph.getAssetById(id);
      this.getHotAssetContents(asset).then(output => {
        res.setHeader(
          'Content-Type',
          (0,
          /*@__PURE__*/ $parcel$interopDefault(
            $ef48ac872575535b$exports,
          )).contentType(asset.type),
        );
        res.end(output);
      });
      return true;
    }
    return false;
  }
  async stop() {
    if (this.stopServer != null) {
      await this.stopServer();
      this.stopServer = null;
    }
    this.wss.close();
  }
  async emitError(options, diagnostics) {
    let renderedDiagnostics = await Promise.all(
      diagnostics.map(d =>
        (0, $dmXIQ$parcelutils.prettyDiagnostic)(d, options),
      ),
    );
    // store the most recent error so we can notify new connections
    // and so we can broadcast when the error is resolved
    this.unresolvedError = {
      type: 'error',
      diagnostics: {
        ansi: renderedDiagnostics,
        html: renderedDiagnostics.map((d, i) => {
          var _diagnostics_i_documentationURL;
          return {
            message: (0, $dmXIQ$parcelutils.ansiHtml)(d.message),
            stack: (0, $dmXIQ$parcelutils.ansiHtml)(d.stack),
            frames: d.frames.map(f => ({
              location: f.location,
              code: (0, $dmXIQ$parcelutils.ansiHtml)(f.code),
            })),
            hints: d.hints.map(hint => (0, $dmXIQ$parcelutils.ansiHtml)(hint)),
            documentation:
              (_diagnostics_i_documentationURL =
                diagnostics[i].documentationURL) !== null &&
              _diagnostics_i_documentationURL !== void 0
                ? _diagnostics_i_documentationURL
                : '',
          };
        }),
      },
    };
    this.broadcast(this.unresolvedError);
  }
  async emitUpdate(event) {
    this.unresolvedError = null;
    this.bundleGraph = event.bundleGraph;
    let changedAssets = new Set(event.changedAssets.values());
    if (changedAssets.size === 0) return;
    let queue = new (0, $dmXIQ$parcelutils.PromiseQueue)({
      maxConcurrent: $fa03334b86d7a256$var$FS_CONCURRENCY,
    });
    for (let asset of changedAssets) {
      if (asset.type !== 'js' && asset.type !== 'css') {
        // If all of the incoming dependencies of the asset actually resolve to a JS asset
        // rather than the original, we can mark the runtimes as changed instead. URL runtimes
        // have a cache busting query param added with HMR enabled which will trigger a reload.
        let runtimes = new Set();
        let incomingDeps = event.bundleGraph.getIncomingDependencies(asset);
        let isOnlyReferencedByRuntimes = incomingDeps.every(dep => {
          let resolved = event.bundleGraph.getResolvedAsset(dep);
          let isRuntime =
            (resolved === null || resolved === void 0
              ? void 0
              : resolved.type) === 'js' && resolved !== asset;
          if (resolved && isRuntime) runtimes.add(resolved);
          return isRuntime;
        });
        if (isOnlyReferencedByRuntimes) {
          for (let runtime of runtimes) changedAssets.add(runtime);
          continue;
        }
      }
      queue.add(async () => {
        let dependencies = event.bundleGraph.getDependencies(asset);
        let depsByBundle = {};
        for (let bundle of event.bundleGraph.getBundlesWithAsset(asset)) {
          let deps = {};
          for (let dep of dependencies) {
            let resolved = event.bundleGraph.getResolvedAsset(dep, bundle);
            if (resolved)
              deps[$fa03334b86d7a256$var$getSpecifier(dep)] =
                event.bundleGraph.getAssetPublicId(resolved);
          }
          depsByBundle[bundle.id] = deps;
        }
        return {
          id: event.bundleGraph.getAssetPublicId(asset),
          url: this.getSourceURL(asset),
          type: asset.type,
          // No need to send the contents of non-JS assets to the client.
          output:
            asset.type === 'js' ? await this.getHotAssetContents(asset) : '',
          envHash: asset.env.id,
          outputFormat: asset.env.outputFormat,
          depsByBundle: depsByBundle,
        };
      });
    }
    let assets = await queue.run();
    this.broadcast({
      type: 'update',
      assets: assets,
    });
  }
  async getHotAssetContents(asset) {
    let output = await asset.getCode();
    let bundleGraph = (0,
    /*@__PURE__*/ $parcel$interopDefault($072abbf85809ad5d$exports))(
      this.bundleGraph,
    );
    if (asset.type === 'js') {
      let publicId = bundleGraph.getAssetPublicId(asset);
      output = `parcelHotUpdate['${publicId}'] = function (require, module, exports) {${output}}`;
    }
    let sourcemap = await asset.getMap();
    if (sourcemap) {
      let sourcemapStringified = await sourcemap.stringify({
        format: 'inline',
        sourceRoot: (0, $b3757033280ef47e$export$48c584f74c55688f) + '/',
        // $FlowFixMe
        fs: asset.fs,
      });
      (0, $parcel$interopDefault($dmXIQ$assert))(
        typeof sourcemapStringified === 'string',
      );
      output += `\n//# sourceMappingURL=${sourcemapStringified}`;
      output += `\n//# sourceURL=${encodeURI(this.getSourceURL(asset))}\n`;
    }
    return output;
  }
  getSourceURL(asset) {
    let origin = '';
    if (!this.options.devServer)
      origin = `http://${this.options.host || 'localhost'}:${
        this.options.port
      }`;
    return origin + $fa03334b86d7a256$var$HMR_ENDPOINT + '/' + asset.id;
  }
  handleSocketError(err) {
    if (err.code === 'ECONNRESET')
      // This gets triggered on page refresh, ignore this
      return;
    this.options.logger.warn({
      origin: '@parcel/reporter-dev-server',
      message: `[${err.code}]: ${err.message}`,
      stack: err.stack,
    });
  }
  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) ws.send(json);
  }
}
function $fa03334b86d7a256$var$getSpecifier(dep) {
  if (typeof dep.meta.placeholder === 'string') return dep.meta.placeholder;
  return dep.specifier;
}

let $8979d6fa383c8759$var$servers = new Map();
let $8979d6fa383c8759$var$hmrServers = new Map();
var $8979d6fa383c8759$export$2e2bcd8739ae039 = new (0,
$dmXIQ$parcelplugin.Reporter)({
  async report({event: event, options: options, logger: logger}) {
    let {serveOptions: serveOptions, hmrOptions: hmrOptions} = options;
    let server = serveOptions
      ? $8979d6fa383c8759$var$servers.get(serveOptions.port)
      : undefined;
    let hmrPort =
      (hmrOptions && hmrOptions.port) || (serveOptions && serveOptions.port);
    let hmrServer = hmrPort
      ? $8979d6fa383c8759$var$hmrServers.get(hmrPort)
      : undefined;
    switch (event.type) {
      case 'watchStart': {
        if (serveOptions) {
          // If there's already a server when watching has just started, something
          // is wrong.
          if (server)
            return logger.warn({
              message: 'Trying to create the devserver but it already exists.',
            });
          var _serveOptions_publicUrl;
          let serverOptions = {
            ...serveOptions,
            projectRoot: options.projectRoot,
            cacheDir: options.cacheDir,
            // Override the target's publicUrl as that is likely meant for production.
            // This could be configurable in the future.
            publicUrl:
              (_serveOptions_publicUrl = serveOptions.publicUrl) !== null &&
              _serveOptions_publicUrl !== void 0
                ? _serveOptions_publicUrl
                : '/',
            inputFS: options.inputFS,
            outputFS: options.outputFS,
            packageManager: options.packageManager,
            logger: logger,
            hmrOptions: hmrOptions,
          };
          server = new (0, $b3757033280ef47e$export$2e2bcd8739ae039)(
            serverOptions,
          );
          $8979d6fa383c8759$var$servers.set(serveOptions.port, server);
          const devServer = await server.start();
          if (hmrOptions && hmrOptions.port === serveOptions.port) {
            let hmrServerOptions = {
              port: serveOptions.port,
              host: hmrOptions.host,
              devServer: devServer,
              addMiddleware: handler => {
                server === null || server === void 0
                  ? void 0
                  : server.middleware.push(handler);
              },
              logger: logger,
            };
            hmrServer = new (0, $fa03334b86d7a256$export$2e2bcd8739ae039)(
              hmrServerOptions,
            );
            $8979d6fa383c8759$var$hmrServers.set(serveOptions.port, hmrServer);
            await hmrServer.start();
            return;
          }
        }
        let port =
          hmrOptions === null || hmrOptions === void 0
            ? void 0
            : hmrOptions.port;
        if (typeof port === 'number') {
          let hmrServerOptions = {
            port: port,
            host:
              hmrOptions === null || hmrOptions === void 0
                ? void 0
                : hmrOptions.host,
            logger: logger,
          };
          hmrServer = new (0, $fa03334b86d7a256$export$2e2bcd8739ae039)(
            hmrServerOptions,
          );
          $8979d6fa383c8759$var$hmrServers.set(port, hmrServer);
          await hmrServer.start();
        }
        break;
      }
      case 'watchEnd':
        if (serveOptions) {
          if (!server)
            return logger.warn({
              message:
                'Could not shutdown devserver because it does not exist.',
            });
          await server.stop();
          $8979d6fa383c8759$var$servers.delete(server.options.port);
        }
        if (hmrOptions && hmrServer) {
          await hmrServer.stop();
          // $FlowFixMe[prop-missing]
          $8979d6fa383c8759$var$hmrServers.delete(hmrServer.wss.options.port);
        }
        break;
      case 'buildStart':
        if (server) server.buildStart();
        break;
      case 'buildProgress':
        if (
          event.phase === 'bundled' &&
          hmrServer && // Only send HMR updates before packaging if the built in dev server is used to ensure that
          // no stale bundles are served. Otherwise emit it for 'buildSuccess'.
          options.serveOptions !== false
        )
          await hmrServer.emitUpdate(event);
        break;
      case 'buildSuccess':
        if (serveOptions) {
          if (!server)
            return logger.warn({
              message:
                'Could not send success event to devserver because it does not exist.',
            });
          server.buildSuccess(event.bundleGraph, event.requestBundle);
        }
        if (hmrServer && options.serveOptions === false)
          await hmrServer.emitUpdate(event);
        break;
      case 'buildFailure':
        // On buildFailure watchStart sometimes has not been called yet
        // do not throw an additional warning here
        if (server) await server.buildError(options, event.diagnostics);
        if (hmrServer) await hmrServer.emitError(options, event.diagnostics);
        break;
    }
  },
});

//# sourceMappingURL=ServerReporter.js.map
