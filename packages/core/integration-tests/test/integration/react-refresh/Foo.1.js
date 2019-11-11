import React, { useState } from "react";

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
