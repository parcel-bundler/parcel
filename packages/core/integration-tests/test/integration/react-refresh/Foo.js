import React, { useState } from "react";

let Foo = () => {
  const [x] = useState(Math.random());

  return (
    <div>
      Functional:{x}
    </div>
  );
};

export default Foo;
