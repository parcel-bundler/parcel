import * as React from 'react';
import * as Icons from 'svg/*.svg';

export default function () {
  const {SVG_Logo} = Icons;
  console.log(Icons, SVG_Logo);
  const Tag = SVG_Logo.default ? SVG_Logo.default : SVG_Logo;
  return (
    <>
      <Tag />
      <div>hello!</div>
    </>
  );
}
