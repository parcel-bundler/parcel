import * as NamespaceImport from "./other1";
import { nameConflict as something } from "external";

export const consumer1: typeof NamespaceImport.nameConflict = { messageFromOther1: "foo" };
export const consumer2: typeof NamespaceImport.notAConflict = { messageFromOther2: "foo" };
export const consumer3: something = {}
const nameConflict = { messageFromIndex: "foo" };
export const consumer4: typeof nameConflict = { messageFromIndex: "bar" }
