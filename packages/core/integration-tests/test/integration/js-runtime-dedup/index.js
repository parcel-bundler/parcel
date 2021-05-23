module.exports = output = Promise.all([import("./async1"), import("./async2")]).then(
	([{ default: a }, { default: b }]) => a === b
);
