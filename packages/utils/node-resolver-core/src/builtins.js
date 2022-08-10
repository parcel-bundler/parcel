// @flow strict-local
// $FlowFixMe this is untyped
import {builtinModules} from 'module';

export const empty: string = require.resolve('./_empty.js');

let builtins: {[string]: {|name: string, range: ?string|}, ...} =
  // $FlowFixMe
  Object.create(null);
// use definite (current) list of Node builtins
for (let key of builtinModules) {
  builtins[key] = {name: empty, range: null};
}

builtins.assert = {name: 'assert/', range: '^2.0.0'};
builtins.buffer = {name: 'buffer/', range: '^5.5.0'};
builtins.console = {name: 'console-browserify', range: '^1.2.0'};
builtins.constants = {name: 'constants-browserify', range: '^1.0.0'};
builtins.crypto = {name: 'crypto-browserify', range: '^3.12.0'};
builtins.domain = {name: 'domain-browser', range: '^3.5.0'};
builtins.events = {name: 'events/', range: '^3.1.0'};
builtins.http = {name: 'stream-http', range: '^3.1.0'};
builtins.https = {name: 'https-browserify', range: '^1.0.0'};
builtins.os = {name: 'os-browserify/browser.js', range: '^0.3.0'};
builtins.path = {name: 'path-browserify', range: '^1.0.0'};
builtins.process = {name: 'process/browser.js', range: '^0.11.10'};
builtins.punycode = {name: 'punycode/', range: '^1.4.1'};
builtins.querystring = {name: 'querystring-es3/', range: '^0.2.1'};
builtins.stream = {name: 'stream-browserify', range: '^3.0.0'};
builtins.string_decoder = {name: 'string_decoder/', range: '^1.3.0'};
builtins.sys = {name: 'util/util.js', range: '^0.12.3'};
builtins.timers = {name: 'timers-browserify', range: '^2.0.11'};
builtins.tty = {name: 'tty-browserify', range: '^0.0.1'};
builtins.url = {name: 'url/', range: '^0.11.0'};
builtins.util = {name: 'util/util.js', range: '^0.12.3'};
builtins.vm = {name: 'vm-browserify', range: '^1.1.2'};
builtins.zlib = {name: 'browserify-zlib', range: '^0.2.0'};

export default builtins;
