const x = {
	require: ["a", "b"],
};

sideEffect(
	x.require[
		(() => {
			let x = typeof require !== "undefined" && require;
			return 0;
		})()
	]
);
