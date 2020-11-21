import { createAndFireEvent } from "./library/b.js";
var createAndFireEventOnAtlaskit = createAndFireEvent("index");
output = import("./library/a.js")
    .then((m) => [createAndFireEventOnAtlaskit(), m.default(), m.a]);
