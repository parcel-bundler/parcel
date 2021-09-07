import {foo} from './other'
import {FOO, USER} from './index'
import("./async");

foo();
console.log(FOO + USER);
