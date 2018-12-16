import React from 'react';
import {
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
  VictoryContainer
} from 'victory';

const BLACK = '#262626';
const GRAY = '#ccc';

function getTooltipContent(data) {
  let gitHash = data.gitHash.slice(0, 7);
  let progress = `${data.passing} / ${data.total}`;
  return `${data.dateStr}\n→ ${gitHash}\n\n${data.percent}%  (${progress})`;
}

function getStyleMutationObj(color) {
  return [
    {
      mutation: props => {
        return {
          style: Object.assign({}, props.style, {fill: color})
        };
      }
    }
  ];
}

class Graph extends React.Component {
  shouldComponentUpdate(nextProps) {
    return nextProps.width !== this.props.width;
  }

  render() {
    let width = this.props.width;
    let graphData = this.props.graphData;
    let lastIndex = graphData.length - 1;
    let start = graphData[0].date;
    let end = graphData[lastIndex].date;

    let styles = {
      xAxis: {
        grid: {
          stroke: GRAY,
          strokeWidth: data => (data.index === lastIndex ? 1 : 0),
          strokeDasharray: '3 3'
        },
        axis: {
          stroke: BLACK,
          strokeWidth: 1
        },
        ticks: {
          size: 5,
          stroke: BLACK,
          strokeWidth: 1
        },
        tickLabels: {
          fill: BLACK,
          fontFamily: 'inherit',
          fontSize: 14
        }
      },
      yAxis: {
        grid: {
          stroke: GRAY,
          strokeWidth: data => (data === 0 ? 0 : 1),
          strokeDasharray: '3 3'
        },
        axis: {
          stroke: BLACK,
          strokeWidth: 1
        },
        ticks: {
          size: 5,
          stroke: BLACK,
          strokeWidth: 1
        },
        tickLabels: {
          fill: BLACK,
          fontFamily: 'inherit',
          fontSize: 14
        }
      },
      line: {
        data: {
          stroke: BLACK,
          strokeWidth: 3
        }
      },
      scatter: {
        data: {
          strokeWidth: 10,
          stroke: 'transparent',
          fill: data => (data.index === lastIndex ? BLACK : 'transparent')
        }
      }
    };

    return (
      <div className="Graph" onMouseOut={this.props.onMouseOut}>
        <VictoryChart
          height={260}
          width={width}
          containerComponent={<VictoryContainer responsive={false} title="" />}
        >
          <VictoryAxis
            scale="time"
            standalone={false}
            style={styles.xAxis}
            tickValues={graphData.map(data => data.date)}
            tickFormat={(date, index) => {
              return index === 0 || index === graphData.length - 1
                ? `${date.getMonth() + 1}/${date.getDate()}`
                : '';
            }}
          />
          <VictoryAxis
            dependentAxis
            domain={[0, 100]}
            style={styles.yAxis}
            tickFormat={x => `${x}%`}
            tickValues={[0, 25, 50, 75, 100]}
          />
          <VictoryLine
            data={graphData}
            domain={{x: [start, end], y: [0, 100]}}
            interpolation="stepAfter"
            scale={{x: 'time', y: 'linear'}}
            style={styles.line}
          />
          <VictoryScatter
            data={graphData}
            domain={{x: [start, end], y: [0, 100]}}
            scale={{x: 'time', y: 'linear'}}
            style={styles.scatter}
            events={[
              {
                eventHandlers: {
                  onMouseOver: (event, point) => {
                    this.props.onMouseOver(
                      event,
                      getTooltipContent(point.datum)
                    );
                    return getStyleMutationObj(BLACK);
                  },
                  onMouseOut: (event, point) => {
                    let color =
                      point.index === lastIndex ? BLACK : 'transparent';
                    return getStyleMutationObj(color);
                  },
                  onClick: (event, point) => {
                    let hash = point.datum.gitHash;
                    let url = `https://github.com/padmaia/parcel/commit/${hash}`;
                    window.open(url);
                  }
                }
              }
            ]}
          />
        </VictoryChart>
      </div>
    );
  }
}

export default Graph;
