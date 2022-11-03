export default function () {
	return Promise.all([
		import("../client").then((v) => v.default()),
		import("../client/simpleHasher.js").then((v) => v.default()),
	]);
}
