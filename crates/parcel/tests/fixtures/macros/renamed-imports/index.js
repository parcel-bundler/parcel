import { hashString as foo } from "../hash.mjs" with { type: "macro" };
output = foo('hi');
