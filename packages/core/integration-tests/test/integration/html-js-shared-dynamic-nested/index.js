import c from "./client";
import v from "./viewer";

output = Promise.all([c(), v()]);
// ["hasher", ["hasher", "hasher"]]
