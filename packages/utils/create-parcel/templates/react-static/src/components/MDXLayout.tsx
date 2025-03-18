import type { PageProps } from '@parcel/rsc';
import type { ReactNode } from 'react';
import { Nav } from '../components/Nav';
import '../page.css';
import '../client';

interface LayoutProps extends PageProps {
  children: ReactNode
}

export default function Layout({children, pages, currentPage}: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <title>{currentPage.tableOfContents?.[0].title}</title>
      </head>
      <body>
        {children}
        <Nav pages={pages} currentPage={currentPage} />
      </body>
    </html>
  );
}
