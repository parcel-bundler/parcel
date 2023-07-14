import { foo, bar, own } from "../library";

output = import("./async").then(v => [v.default, [foo, bar, own]])
