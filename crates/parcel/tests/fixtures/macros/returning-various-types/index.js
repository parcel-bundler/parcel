import { inspect } from 'util';
import { test } from "./macro.mjs" with { type: "macro" };
output = inspect(test());
