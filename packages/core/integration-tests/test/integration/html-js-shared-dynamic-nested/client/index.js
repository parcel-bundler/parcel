export default function () {
	return import("./simpleHasher.js").then((v) => v.default());
}
