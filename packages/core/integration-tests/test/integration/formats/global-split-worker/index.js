import {add} from "lodash";

output = add(1, 2);

new Worker(new URL("./worker", import.meta.url), {type: 'module'});
