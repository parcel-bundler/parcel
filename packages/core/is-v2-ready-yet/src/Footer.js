import React from 'react';

function FooterLink(props) {
  let href = `https://github.com/${props.href}`;
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="FooterLink"
      href={href}
    >
      {props.children}
    </a>
  );
}

class Footer extends React.Component {
  shouldComponentUpdate() {
    return false;
  }

  render() {
    return (
      <div className="Footer">
        <FooterLink href="parcel-bundler/parcel/blob/master/PARCEL_2_RFC.md">
          RFC
        </FooterLink>
        &middot;
        <FooterLink href="parcel-bundler/parcel/projects/5">
          Project Board
        </FooterLink>
        &middot;
        <FooterLink href="padmaia/parcel/tree/experimental-next/packages/core/integration-tests/ready-yet-app">
          Page Source
        </FooterLink>
      </div>
    );
  }
}

export default Footer;
