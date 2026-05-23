import { test } from "./macro.mjs" with { type: "macro" };
output = test(1 + 2, 'foo ' + 'bar', 3 + 'em', 'test'.length, 'test'['length'], 'test'[1], !true, [1, ...[2, 3]], {x: 2, ...{y: 3}}, true ? 1 : 0, typeof false, null ?? 2);
