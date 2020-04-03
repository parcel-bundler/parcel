// @flow
// import polyfills from '@parcel/node-libs-browser';
// $FlowFixMe this is untyped
// import {builtinModules} from 'module';
const builtinModules = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

const empty = '/_empty.js'; //require.resolve('./_empty.js');

// $FlowFixMe
let builtins: {[string]: any, ...} = Object.create(null);
// use definite (current) list of Node builtins
for (let key of builtinModules) {
  builtins[key] = empty;
}

// load the polyfill where available
// for (let key in polyfills) {
//   builtins[key] = polyfills[key] || empty;
// }

export default builtins;
