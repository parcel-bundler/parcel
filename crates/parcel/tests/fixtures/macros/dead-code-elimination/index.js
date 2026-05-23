import { test } from "./macro.mjs" with { type: "macro" };

if (test()) {
  sideEffect('bad');
} else {
  sideEffect('good');
}
