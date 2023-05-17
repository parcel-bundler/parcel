debugger;
import { c } from "./c.mjs"; // imports and calls b1 (circular)

// works fine in the Node native ESM
// fails in Parcel because we don't hoist it before the imports
export default function () {
	return "b1";
}

// fails in Node native ESM
// fails in Parcel because it isn't hoisted
// function b1() {
// 	return "b1";
// };
// export default b1;


// works in Node native ESM
// works in Parcel because we first do `parcelHelpers.export("b1")` and then `require(c)`
// export function b1() {
// 	return "b1";
// };

let str = c + "str";
