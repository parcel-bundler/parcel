import * as React from 'react';
import {ReactNode} from 'react';

interface OtherProps {
  children: ReactNode
}

export function OtherComponent(props: OtherProps) {
  return <div>{props.children}</div>;
}
