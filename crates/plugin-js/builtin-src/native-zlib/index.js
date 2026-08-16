'use strict';

// Node-compatible object/callback/stream facade over the Rust byte codecs.
// Compression is one-shot at the native boundary. Transform streams buffer
// their input and invoke the codec from `_flush`, which keeps the familiar JS
// stream API without retaining pako's codec implementation.
var native = require('builtin:zlib-native');
var Buffer = require('buffer').Buffer;
var Transform = require('stream').Transform;
var util = require('util');

var constants = Object.freeze({
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  DEFLATE: 1,
  INFLATE: 2,
  GZIP: 3,
  GUNZIP: 4,
  DEFLATERAW: 5,
  INFLATERAW: 6,
  UNZIP: 7,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1
});

var codes = {
  Z_OK: constants.Z_OK,
  Z_STREAM_END: constants.Z_STREAM_END,
  Z_NEED_DICT: constants.Z_NEED_DICT,
  Z_ERRNO: constants.Z_ERRNO,
  Z_STREAM_ERROR: constants.Z_STREAM_ERROR,
  Z_DATA_ERROR: constants.Z_DATA_ERROR,
  Z_MEM_ERROR: constants.Z_MEM_ERROR,
  Z_BUF_ERROR: constants.Z_BUF_ERROR,
  Z_VERSION_ERROR: constants.Z_VERSION_ERROR
};
Object.keys(codes).forEach(function (name) { codes[codes[name]] = name; });
Object.freeze(codes);

function toBufferInput(input) {
  if (typeof input === 'string') return Buffer.from(input);
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('The input argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer');
}

function invoke(name, input, options) {
  try {
    return Buffer.from(native[name](toBufferInput(input), options || {}));
  } catch (error) {
    if (!error.code && (name === 'inflate' || name === 'inflateRaw' || name === 'gunzip' || name === 'unzip')) {
      error.errno = constants.Z_DATA_ERROR;
      error.code = 'Z_DATA_ERROR';
    }
    throw error;
  }
}

function sync(name) {
  return function (input, options) { return invoke(name, input, options); };
}

function async(name) {
  return function (input, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (typeof callback !== 'function') throw new TypeError('The callback argument must be of type function');
    process.nextTick(function () {
      try { callback(null, invoke(name, input, options)); }
      catch (error) { callback(error); }
    });
  };
}

function Zlib(options, operation) {
  Transform.call(this, options);
  this._opts = options || {};
  this._operation = operation;
  this._chunks = [];
  this._length = 0;
  this._closed = false;
}
util.inherits(Zlib, Transform);

Zlib.prototype._transform = function (chunk, encoding, callback) {
  try {
    chunk = toBufferInput(chunk);
    this._chunks.push(chunk);
    this._length += chunk.length;
    callback();
  } catch (error) { callback(error); }
};

Zlib.prototype._flush = function (callback) {
  try {
    var input = Buffer.concat(this._chunks, this._length);
    this._chunks = [];
    this._length = 0;
    this.push(invoke(this._operation, input, this._opts));
    callback();
  } catch (error) { callback(error); }
};

Zlib.prototype.close = function (callback) {
  if (!this._closed) {
    this._closed = true;
    this.emit('close');
  }
  if (callback) process.nextTick(callback);
};

Zlib.prototype.reset = function () {
  this._chunks = [];
  this._length = 0;
};

Zlib.prototype.flush = function (kind, callback) {
  if (typeof kind === 'function') callback = kind;
  // The Rust codec is one-shot, so there is no safe partial byte sequence to
  // emit here. Completion still follows the runtime's next-tick behavior.
  if (callback) process.nextTick(callback);
};

Zlib.prototype.params = function (level, strategy, callback) {
  if (level < constants.Z_MIN_LEVEL || level > constants.Z_MAX_LEVEL) throw new RangeError('Invalid compression level: ' + level);
  if (strategy !== constants.Z_DEFAULT_STRATEGY) throw new TypeError('Only the default compression strategy is supported');
  this._opts.level = level;
  this._opts.strategy = strategy;
  if (callback) process.nextTick(callback);
};

function makeConstructor(name, operation) {
  var Constructor = function (options) {
    if (!(this instanceof Constructor)) return new Constructor(options);
    Zlib.call(this, options, operation);
  };
  Object.defineProperty(Constructor, 'name', {value: name});
  util.inherits(Constructor, Zlib);
  return Constructor;
}

var Deflate = makeConstructor('Deflate', 'deflate');
var Inflate = makeConstructor('Inflate', 'inflate');
var Gzip = makeConstructor('Gzip', 'gzip');
var Gunzip = makeConstructor('Gunzip', 'gunzip');
var DeflateRaw = makeConstructor('DeflateRaw', 'deflateRaw');
var InflateRaw = makeConstructor('InflateRaw', 'inflateRaw');
var Unzip = makeConstructor('Unzip', 'unzip');

exports.Deflate = Deflate;
exports.Inflate = Inflate;
exports.Gzip = Gzip;
exports.Gunzip = Gunzip;
exports.DeflateRaw = DeflateRaw;
exports.InflateRaw = InflateRaw;
exports.Unzip = Unzip;
exports.createDeflate = function (options) { return new Deflate(options); };
exports.createInflate = function (options) { return new Inflate(options); };
exports.createGzip = function (options) { return new Gzip(options); };
exports.createGunzip = function (options) { return new Gunzip(options); };
exports.createDeflateRaw = function (options) { return new DeflateRaw(options); };
exports.createInflateRaw = function (options) { return new InflateRaw(options); };
exports.createUnzip = function (options) { return new Unzip(options); };
exports.deflateSync = sync('deflate');
exports.inflateSync = sync('inflate');
exports.gzipSync = sync('gzip');
exports.gunzipSync = sync('gunzip');
exports.deflateRawSync = sync('deflateRaw');
exports.inflateRawSync = sync('inflateRaw');
exports.unzipSync = sync('unzip');
exports.deflate = async('deflate');
exports.inflate = async('inflate');
exports.gzip = async('gzip');
exports.gunzip = async('gunzip');
exports.deflateRaw = async('deflateRaw');
exports.inflateRaw = async('inflateRaw');
exports.unzip = async('unzip');
exports.constants = constants;
exports.codes = codes;
Object.keys(constants).forEach(function (name) {
  Object.defineProperty(exports, name, {enumerable: true, value: constants[name]});
});
