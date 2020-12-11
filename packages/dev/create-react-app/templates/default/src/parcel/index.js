import React from 'react';
import logoUrl from 'url:./logo.svg';
import frontUrl from 'url:./front.png';
import backUrl from 'url:./back.png';
import {container, boxContainer, logo, parcel, front} from './index.module.css';

export default function Parcel() {
  return (
    <div className={container}>
      <div className={parcel}>
        <div>
          <h1>Welcome to</h1>
          <img src={logoUrl} className={logo} alt="Parcel logo" />
        </div>

        <div className={boxContainer}>
          <img src={backUrl} alt="" height="474" />
          <div id="icons" />
          <img src={frontUrl} className={front} alt="Parcel box" height="474" />
        </div>
      </div>
    </div>
  );
}
