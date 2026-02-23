import type { PropsWithChildren } from 'react';

import { Footer } from './Footer';
import { NavBar } from './NavBar';

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="min-h-screen bg-background text-foreground">
    <NavBar />
    <main className="mx-auto w-full max-w-7xl px-4 py-4 pb-24 md:pb-4">{children}</main>
    <Footer />
  </div>
);
