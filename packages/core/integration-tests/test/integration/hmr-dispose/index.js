import {value} from "./local.js";
output(["eval:index", value, module.hot.data]);
module.hot.accept();
module.hot.dispose((data) => {
  output(["dispose:index", value]);
  data.value = value;
})
