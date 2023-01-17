// Adopted from https://github.com/nartallax/parcel-css-bug
// To address https://github.com/parcel-bundler/parcel/issues/8716
import * as aCss from "./a.module.css"
import * as bCss from "./b.module.css"

sideEffect(['mainJs', aCss.myClass, bCss.myOtherClass]);