This directory exists for the `should correctly detect changes when watchDir is higher up in a project-only lockfile monorepo` test.

Without it I was getting a `Uncaught Error: No such file or directory` error stemming from [this line](https://github.com/parcel-bundler/parcel/blob/3b798e0456bbef951c684d43f96fda1fea386f62/packages/core/fs/src/OverlayFS.js#L375). The test itself doesn't care about watching the readable file system but it was necessary because `.watch` on `OverlayFS` subscribes to both the readable and writable filesystems.
