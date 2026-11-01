import {Header} from './header';
export function Layout({children}) {
  return <main><Header />{children}</main>;
}
