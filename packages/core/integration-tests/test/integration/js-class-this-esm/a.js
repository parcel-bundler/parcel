import prefix from "./b.js";

class Foo {
	x(v) {
		return prefix + v;
	}
	y = (v) => {
		return this.x(v);
	};
}

let result = new Foo().y(123);

output = result;
export default result;
