const value = require('./value');
value.cjs = value.cjs + ' mutated';


output = [value.cjs, value.esm, value];
