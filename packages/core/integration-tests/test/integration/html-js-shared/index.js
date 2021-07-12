console.log(require("lodash").add(1, 2));
import("./async.js");
new Worker(new URL("./worker.js", import.meta.url), {type: 'module'});
