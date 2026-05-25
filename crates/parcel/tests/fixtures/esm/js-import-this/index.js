import returnThisDefault, { returnThis } from "./other.js";
import * as other from "./other.js";

import returnThisWrappedDefault, { returnThis as returnThisWrapped } from "./other-wrapped.js";
import * as otherWrapped from "./other-wrapped.js";

let result = {
  unwrappedNamed: returnThis(),
  unwrappedDefault: returnThisDefault(),
  unwrappedNamespace: other.returnThis(),
  wrappedNamed: returnThisWrapped(),
  wrappedDefault: returnThisWrappedDefault(),
  wrappedNamespace: otherWrapped.returnThis(),
};

output = result;
export default result;
