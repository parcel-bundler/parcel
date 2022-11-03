export default function () {
	return import("./simpleHasher").then((v) => v.default());
}
