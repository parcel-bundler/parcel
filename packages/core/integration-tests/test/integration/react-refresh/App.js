import React, { useState } from "react";
import Foo from "./Foo";

export const App = () => {
  const [x] = useState(Math.random());

  return (
    <div>
      {x} <Foo />
    </div>
  );
};
