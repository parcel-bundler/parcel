import x from "./c.js";

export default import("./b.js").then((v) => [v.default, x]);
