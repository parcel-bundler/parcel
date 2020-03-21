import a from "./sync.js";
console.log(a);

import("./async").then(v => console.log(v.default));
