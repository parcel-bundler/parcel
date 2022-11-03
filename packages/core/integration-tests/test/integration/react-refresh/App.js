import React, { useState } from "react";
import ReactDOM from "react-dom";
import Foo from "./Foo";
import { act } from "react-dom/test-utils";

export const App = () => {
  const [x] = useState(Math.random());

  return (
    <div>
      {x} <Foo />
    </div>
  );
};
