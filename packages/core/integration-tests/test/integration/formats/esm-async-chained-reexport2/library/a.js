import { createAndFireEvent } from "./b.js";
var createAndFireEventOnAtlaskit = createAndFireEvent("a");
export default () => createAndFireEventOnAtlaskit();
export const a = 1;