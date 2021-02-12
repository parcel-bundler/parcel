import { foo } from "./other.js";

function func(foo) {}

function func2() {
  var foo = 2;
}
const func3 = () => {
  var foo = 3;
}

export default foo;
