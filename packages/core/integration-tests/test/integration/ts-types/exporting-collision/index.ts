
// Case 1: the top-level export is _after_ the wildcard export.

export * from "./other1";
export const nameConflict1 = { messageFromIndex: "this instance of nameConflict1 is from index.ts" };

// Case 2: the top-level export is _before_ the wildcard export.

export const nameConflict2 = { messageFromIndex: "this instance of nameConflict2 is from index.ts" };
export * from "./other2";

// Case 3: re-exporting something that uses nameConflict1 from "other1.ts",
// which would otherwise be shaken (like nameConflict2 from "other2.ts").

export { consumer } from "./consumer";
