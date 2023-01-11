import ReactDOM from "react-dom";
import { App } from "./App";
import { act } from "react-dom/test-utils";

export default () =>
  act(async () => {ReactDOM.render(<App />, document.getElementById("root"));});
