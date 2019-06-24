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
        <div className="FooterRow">
          <FooterLink href="parcel-bundler/parcel/blob/master/PARCEL_2_RFC.md">
            RFC
          </FooterLink>
          &middot;
          <FooterLink href="parcel-bundler/parcel/projects/5">
            Project Board
          </FooterLink>
          &middot;
          <FooterLink href="parcel-bundler/parcel/tree/v2/packages/core/is-v2-ready-yet">
            Page Source
          </FooterLink>
        </div>
        <div className="FooterRow">
          <FooterLink href="tomocchino/isfiberreadyyet">
            Forked from {'"Is Fiber Ready Yet?"'}
          </FooterLink>
        </div>
      </div>
    );
  }
}

export default Footer;
