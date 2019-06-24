import React from 'react';

class IsItReady extends React.Component {
  shouldComponentUpdate() {
    return false;
  }

  render() {
    let {data} = this.props;
    let decision = data.percent === 100;
    let passing = data.percent === 100 ? 'All' : data.percent + '% of';

    return decision ? (
      <div className="IsItReady">
        <h1 className="IsItReadyText">
          Yes
          <i>{'\ud83c\udf89'}</i>
        </h1>
      </div>
    ) : (
      <div className="IsItReady">
        <h1 className="IsItReadyText">No</h1>
        <p>
          {passing} tests are passing
          <i>{'\u2705'}</i>
        </p>
      </div>
    );
  }
}

export default IsItReady;
