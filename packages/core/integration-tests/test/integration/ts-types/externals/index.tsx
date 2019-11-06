import {ReactNode} from 'react';
import * as React from 'react';
import {OtherComponent} from './other';

interface Props {
  children: ReactNode
}

export const Component: React.FC<Props> = (props) => {
  return <OtherComponent>{props.children}</OtherComponent>;
}
