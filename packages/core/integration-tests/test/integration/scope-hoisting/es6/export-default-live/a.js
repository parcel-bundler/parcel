import foo, {change} from "./b.js";
sideEffect(foo);
change(10);
sideEffect(foo);
