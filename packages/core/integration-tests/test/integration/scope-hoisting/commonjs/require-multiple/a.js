var before = 'before', 
  b = require('./b'), 
  middle = 'middle', 
  c = require('./c'), 
  after = 'after';

output = `${before} ${b.foo()} ${middle} ${c.bar()} ${after}`;
