import { createAndFireEvent } from "./library/b.js";
var createAndFireEventOnAtlaskit = createAndFireEvent("index");
output = import("./library/a.js")
    .then((m) => m.c.then(c => [createAndFireEventOnAtlaskit(), m.default(), c.c, c.createAndFireEvent("c")()]));
