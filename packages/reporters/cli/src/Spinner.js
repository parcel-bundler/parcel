const {h, Color} = require('ink');
const PropTypes = require('prop-types');
const spinners = require('cli-spinners');
const omit = require('object.omit');
import React from 'react';

export default class Spinner extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      frame: 0
    };

    this.switchFrame = this.switchFrame.bind(this);
  }

  getSpinner() {
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

  switchFrame() {
    const {frame} = this.state;

    const spinner = this.getSpinner();
    const isLastFrame = frame === spinner.frames.length - 1;
    const nextFrame = isLastFrame ? 0 : frame + 1;

    this.setState({
      frame: nextFrame
    });
  }
}

Spinner.propTypes = {
  type: PropTypes.string
};

Spinner.defaultProps = {
  type: 'dots'
};
