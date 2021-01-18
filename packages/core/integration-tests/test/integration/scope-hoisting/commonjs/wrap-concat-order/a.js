sideEffect(1);
require("./b.js");
sideEffect(3);
if (Date.now() > 0) {
	sideEffect(4);
	require("./c.js");
	sideEffect(6);
}
sideEffect(7);
