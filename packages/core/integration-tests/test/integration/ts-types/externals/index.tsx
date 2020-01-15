import {ReactNode} from 'react';
import * as React from 'react';
import {OtherComponent} from './other';
import {External} from 'external';

interface Props {
  children: ReactNode
}

export const Component: React.FC<Props> = (props) => {
  return <OtherComponent>{props.children}</OtherComponent>;
}

export {External};
