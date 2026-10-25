import { join } from "path" with { type: "macro" };
import { basename } from "node:path" with { type: "macro" };
import { existsSync } from "fs" with { type: "macro" };
output = join("a", "b") + ":" + basename("/foo/bar.txt") + ":" + existsSync("/does/not/exist");
