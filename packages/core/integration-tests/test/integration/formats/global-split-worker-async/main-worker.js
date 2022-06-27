import a from "./sync.js";

import("./async").then(v => {
    output(a + v.default);
});
