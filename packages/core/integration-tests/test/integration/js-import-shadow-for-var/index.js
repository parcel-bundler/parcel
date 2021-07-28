import { f, g, h } from "./other.js";

export function baz() {
  {
    class g {}
    var h = {};
  }

	for (var f = [], i = 0; i < 4; i++) {
		f[i] = i;
	}

	return typeof g === 'number' && typeof h === 'object' && f;
}
