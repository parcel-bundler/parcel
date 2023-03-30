const value = require('./value');
value.cjs = value.cjs + ' mutated';
value.esm = value.esm + ' mutated';


output = [value.cjs, value.esm, value];
