
import c from "./client/index.js";
import v from "./viewer/index.js";

output = Promise.all([c(), v()]);
