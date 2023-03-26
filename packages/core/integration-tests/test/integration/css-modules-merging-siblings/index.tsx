// Adopted from reproduction here
// https://github.com/parcel-bundler/parcel/issues/8716
import * as styles from "./outer.module.css";

sideEffect(['mainJs', styles.container]);
