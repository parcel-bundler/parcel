### REPL Issues

**Bugs**:

- babel shims out all file access in the browser -> babelrc is ignored
- glob doesn't work
- `extends` in a parcelrc are read from fs, not `require`d
- removing an asset can make it look as though one of the remaining assets is an entry, but it actually isn't

**Improvements**:

- Preview
  - JS preview: use util.inspect
  - JS Preview: show error (Uncaught ReferenceError: ... is not defined)
  - use Parcel's devserver middleware in SW
- Lazy load plugins types
- install pkg using Yarn (via custom PackageInstaller)
- Add a "Show more"/”Expand" pull tab to options box
