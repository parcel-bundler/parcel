import React from "react";
import { render } from "react-dom";

import * as styles from "./app.module.css"

const App = function() {
    return <div className={styles.notExisting}></div>
}

render(<App/>, document.getElementById("app"))
