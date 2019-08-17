/**
 * A Middleware represents event handlers for events emitted by Assets.
 * There are different types of events, such as postGenerate.
 * The base Middleware class doesn't do much by itself, but sets up an interface
 * for subclasses to implement.
 */
class Middleware {
  constructor(asset) {
    this.asset = asset; // doesn't make much sense to replicate any options from asset, since the can be accessed anyways
  }
}

module.exports = Asset;
