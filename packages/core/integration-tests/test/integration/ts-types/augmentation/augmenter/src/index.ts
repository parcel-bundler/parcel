import { Person } from "original";
Person.prototype.greet = function() { return `Hello ${this.name}!` }

export const anotherThing: string = "hello";

declare module "original" {
  interface Person {
    greet(): string;
  }
}

export const somethingElse: string = "goodbye";