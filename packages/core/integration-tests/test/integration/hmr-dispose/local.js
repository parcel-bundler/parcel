export {value} from "./other.js";
import {value} from "./other.js";
output(["eval:local", value, module.hot.data]);
module.hot.dispose((data) => {
  output(["dispose:local", value]);
  data.value = value;
})
