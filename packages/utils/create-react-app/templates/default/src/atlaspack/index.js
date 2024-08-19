import * as React from 'react';
import logoUrl from 'url:./logo.svg';
import frontUrl from 'url:./front.png';
import backUrl from 'url:./back.png';
import './index.css';

export default function Atlaspack() {
  return (
    <div className="atlaspack-container">
      <div className="atlaspack-heading">
        <div>
          <h1>Welcome to</h1>
          <img src={logoUrl} className="atlaspack-logo" alt="Atlaspack logo" />
        </div>

        <div className="atlaspack-box">
          <img src={backUrl} alt="" height="474" />
          <div id="icons" />
          <img
            src={frontUrl}
            className="atlaspack-box-front"
            alt="Atlaspack box"
            height="474"
          />
        </div>
      </div>
    </div>
  );
}
