import React from 'react';
import ProgressBar from './ProgressBar';
import Graph from './Graph';
import HeatMap from './HeatMap';
import IsItReady from './IsItReady';
import Footer from './Footer';

const tooltipIcons = {
  passing: '\u2705',
  failingInDev: '\uD83D\uDEA7',
  failing: '\u274C'
};

const tooltipStatus = {
  passing: 'passing',
  failingInDev: 'passing, except dev-only behavior',
  failing: 'failing'
};

function Tooltip(props) {
  let contentStyle = {
    right: props.flip ? -15 : 'auto',
    left: props.flip ? 'auto' : -15
  };

  var statusRow = null;
  if (props.status) {
    let icon = tooltipIcons[props.status];
    let text = tooltipStatus[props.status];
    statusRow = (
      <div className="TooltipStatus">
        <i>{icon}</i>
        {text}
      </div>
    );
  }

  return (
    <div className="Tooltip" style={{left: props.left, top: props.top}}>
      <div className="TooltipContent" style={contentStyle}>
        {props.content}
        {statusRow}
      </div>
    </div>
  );
}

export default class App extends React.Component {
  state = {tooltipData: null};

  handleMouseOver = (event, content, status) => {
    let rect = event.target.getBoundingClientRect();
    let left = Math.round(rect.left + rect.width / 2 + window.scrollX);
    let top = Math.round(rect.top + window.scrollY);
    let flip = event.clientX > document.documentElement.clientWidth / 2;
    this.setState({tooltipData: {left, top, content, status, flip}});
  };

  handleMouseOut = event => {
    this.setState({tooltipData: null});
  };

  render() {
    let {testData, graphData, mostRecent, width} = this.props;
    let tooltipData = this.state.tooltipData;
    let tooltip = tooltipData ? <Tooltip {...tooltipData} /> : null;

    return (
      <>
        <ProgressBar data={mostRecent} />
        <IsItReady data={mostRecent} testData={testData} />
        <Graph
          width={width}
          graphData={graphData}
          onMouseOut={this.handleMouseOut}
          onMouseOver={this.handleMouseOver}
        />
        <HeatMap
          testData={testData}
          onMouseOut={this.handleMouseOut}
          onMouseOver={this.handleMouseOver}
        />
        <Footer />
        {tooltip}
      </>
    );
  }
}
