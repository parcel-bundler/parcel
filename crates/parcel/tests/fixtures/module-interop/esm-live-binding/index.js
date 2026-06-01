import { count, increment } from './dep.js';
var before = count;
increment();
increment();
var after = count;
output = [before, after];
