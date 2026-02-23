import type { PropsWithChildren } from 'react';

export const Panel = ({ children }: PropsWithChildren) => (
  <section className="dw-panel">{children}</section>
);
