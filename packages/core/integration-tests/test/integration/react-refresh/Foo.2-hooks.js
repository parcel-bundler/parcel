import React, { useState } from "react";

let Foo = () => {
  const [x] = useState(Math.random());
  const [y] = useState(Math.random());

  return (
    <div>
      Hooks:{x}:{y}
    </div>
  );
};

export default Foo;
