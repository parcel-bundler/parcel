class Test {
	run() {
		return this.#priv();
	}

	#priv() {
		return 123;
	}
}

export default new Test("hi from inside a private method").run();
