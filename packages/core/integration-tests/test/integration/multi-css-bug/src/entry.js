// This repro was taken from https://github.com/parcel-bundler/parcel/issues/8813

// This file needs to import a CSS asset, so that `index.css` will be created.
import './main.css';

/*
   Import the CSS out of the package; causes a bundle Group entry type error.
   This import causes the asset in the lazy imported bundle below to also be
   named `index.css`.
*/
import './Foo/foo.css';

/*
   Due to the import above, the dynamic import CSS asset is also created as
   `index.css`, resulting in a name collision with the `index.css` asset created
   for this file.

   If the import of 'foo.css' above is removed, the dynamic import CSS asset
   will be named `Foo.<hash>.css` as expected, like its JS file.

   If the import of 'main.css' above is removed, the dynamic import CSS asset
   will be named `index.css` as expected, but there will be no name collision
   because this file did not generate an `index.css` asset itself.

   Also, if parcel is run with a cache, on the first execution the
   AssertionError for the bundle group will be raised.  However, on a second
   execution, the AssertError will not occur, but the generated `index.css` will
   only contain the content of `foo.css` and be missing the content of
   `main.css`.

   In a React app, the dynamic import occurs via React.lazy:
     import {lazy} from 'react'
     const foo = lazy(() => import('./Foo'));
*/
import('./Foo');
