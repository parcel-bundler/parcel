import { nameConflict1 } from "./other1";

export const consumer: typeof nameConflict1 = { messageFromOther1: "This variable uses the type of the nameConflict1 variable defined in other1.ts, which should now be declared in the bundle, but not exported." };
