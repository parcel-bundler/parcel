import { test } from "./macro.mjs" with { type: "macro" };
output = test(undefined, null, true, false, 1, 0, -2, 'hi', /yo/i, [1, {test: 8}]);
