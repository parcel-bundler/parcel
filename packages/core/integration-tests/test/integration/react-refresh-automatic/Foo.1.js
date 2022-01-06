// Don't import "react" to actually test automatic runtime check
import { useState } from "./hooks.js";

let Foo = () => {
  const [x] = useState(Math.random());

  return (
    <div>
      OtherFunctional:
      <span>{x}</span>
    </div>
  );
};

export default Foo;
