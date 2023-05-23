import { c } from "./c.mjs"; // imports and calls b1 (circular)

export default function b1() {
	return "b1";
}

let str = c + "str";
