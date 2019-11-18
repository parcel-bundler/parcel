for (let v of ["a", "b", "c"]) {
	module.exports[v] = v;
}

module.exports = "xyz";
