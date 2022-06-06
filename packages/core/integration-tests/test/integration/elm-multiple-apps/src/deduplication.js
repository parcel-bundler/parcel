import { Elm } from './Main.elm?with=MainB.elm&with=MainC.elm';
import { Elm as Elm2 } from './Main.elm?with=MainC.elm&with=MainB.elm';

export default function() {
  return { Elm, Elm2 };
}
