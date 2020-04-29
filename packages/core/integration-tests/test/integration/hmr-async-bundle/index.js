import lodash from "lodash";

let A = () => import("./a");
let B = () => import("./b");

export default A().then(a => a.default);
