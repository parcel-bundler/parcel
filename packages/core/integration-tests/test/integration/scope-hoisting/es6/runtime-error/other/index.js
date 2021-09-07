//@flow
import {UNLICENSED, USER, type Board} from "../index";

const myFunc = (): Board => UNLICENSED + USER + "!"
//import("../index")
let fooResult = myFunc()
console.log(fooResult)
export const foo = (): Board => fooResult;
