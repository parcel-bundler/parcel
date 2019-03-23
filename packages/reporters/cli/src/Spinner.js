// @flow strict-local

import React from 'react';
import spinners, {type CLISpinner} from 'cli-spinners';

type Props = {|
  type: string
|};

type State = {|
  frame: number
|};

export default class Spinner extends React.Component<Props, State> {
  static defaultProps = {
    type: 'dots'
  };

  timer: IntervalID;

  state = {
    frame: 0
  };

  getSpinner(): CLISpinner {
    return spinners[this.props.type] || spinners.dots;
  }

  render() {
    const spinner = this.getSpinner();
    return spinner.frames[this.state.frame];
  }

  componentDidMount() {
    const spinner = this.getSpinner();
    this.timer = setInterval(this.switchFrame, spinner.interval);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  switchFrame = () => {
    const {frame} = this.state;

    const spinner = this.getSpinner();
    const isLastFrame = frame === spinner.frames.length - 1;
    const nextFrame = isLastFrame ? 0 : frame + 1;

    this.setState({
      frame: nextFrame
    });
  };
}
