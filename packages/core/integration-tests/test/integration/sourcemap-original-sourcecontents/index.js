// @flow

import * as React from "react";
import * as ReactDOM from "react-dom";

type Props = {|
  bar: string,
|};

function App(props: Props) {
  return <div>{props.bar}</div>;
}

ReactDOM.render(<App bar="bar" />, document.getElementById("root"));
