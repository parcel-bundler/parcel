import React from 'react';
import logoUrl from 'url:./logo.svg';
import frontUrl from 'url:./front.png';
import backUrl from 'url:./back.png';
import './index.css';

export default function Parcel() {
  return (
    <div className="parcel-container">
      <div className="parcel-heading">
        <div>
          <h1>Welcome to</h1>
          <img src={logoUrl} className="parcel-logo" alt="Parcel logo" />
        </div>

        <div className="parcel-box">
          <img src={backUrl} alt="" height="474" />
          <div id="icons" />
          <img
            src={frontUrl}
            className="parcel-box-front"
            alt="Parcel box"
            height="474"
          />
        </div>
      </div>
    </div>
  );
}
