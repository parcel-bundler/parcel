import "./a.js";
import "./style.css";

new Worker(new URL("./worker", import.meta.url), {type: 'module'});
