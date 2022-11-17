export * from "./other3";
export { nameConflict as notAConflict } from "./other2";
export const nameConflict = { messageFromOther1: "foo" };
