import x from "./shared";
if (Date.now() > 0) {
	let x = require("./run-interop.js");
	sideEffect("async " + x.default);
}
