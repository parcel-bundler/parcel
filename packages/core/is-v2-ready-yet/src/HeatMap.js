import React from 'react';

function getTooltipContent({fileName, title}) {
  return `${fileName}\n→it("${title}")`;
}

export default class HeatMap extends React.Component {
  render() {
    let {testData, onMouseOver, onMouseOut} = this.props;
    let items = testData.tests.map((test, i) => {
      let {fileName, link, status, title} = test;
      return (
        <a
          key={i}
          target="_blank"
          data-tooltip={getTooltipContent(test)}
          data-status={status}
          className={`Test ${status}`}
          href={link}
        />
      );
    });

    let handleMouseOver = event => {
      let node = event.target;
      if (node.nodeName === 'A') {
        onMouseOver(
          event,
          node.getAttribute('data-tooltip'),
          node.getAttribute('data-status')
        );
      }
    };

    return (
      <div
        className="HeatMap"
        onMouseOut={onMouseOut}
        onMouseOver={handleMouseOver}
      >
        {items}
      </div>
    );
  }
}
