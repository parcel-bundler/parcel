var t = module.exports;
module.exports.COMMENT_KEYS = undefined;

Object.defineProperty(module.exports, "COMMENT_KEYS", {
	get() {
		return 5;
	}
});

output = t.COMMENT_KEYS;
