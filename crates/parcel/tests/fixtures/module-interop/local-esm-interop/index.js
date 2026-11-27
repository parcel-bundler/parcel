import only from './only-esm.js';
import shared from './shared.js';
import * as ns from './namespace.js';
import * as escaped from './escaped.js';
import {renamed} from './barrel.js';
import {viaRequire} from './cjs.js';
sideEffect([only, shared, viaRequire, String(ns.__esModule), ns.default, String([escaped][0].__esModule), renamed].join(':'));
