const x = {
	require: ["a", "b"],
};

output(
	x.require[
		(() => {
			let x = typeof require !== "undefined" && require;
			return 0;
		})()
	]
);
