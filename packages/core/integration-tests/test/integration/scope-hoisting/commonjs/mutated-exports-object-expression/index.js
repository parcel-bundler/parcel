const v = require("./value");

let x = ((v.foo = 3), v[["f", "o", "o"].join("")]);

output = [v, v.foo, x];
