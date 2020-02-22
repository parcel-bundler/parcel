import {T} from "./i18n";

const version = import("./version.js");

console.log(
	T("index"),
	version.then(v => "Diagram" + v.default())
);
