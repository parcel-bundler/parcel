import * as NamespaceImport from "./other1";

export const consumer1: typeof NamespaceImport.nameConflict = { messageFromOther1: "foo" }
export const consumer2: typeof NamespaceImport.notAConflict = { messageFromOther2: "foo" }