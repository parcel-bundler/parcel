import React, { Component } from "react";

class Foo extends Component {
  constructor(props) {
    super(props);
    this.state = {
      x: Math.random()
    };
  }

  render() {
    return (
      <div>
        Class:{this.state.x}
      </div>
    );
  }
}
export default Foo;