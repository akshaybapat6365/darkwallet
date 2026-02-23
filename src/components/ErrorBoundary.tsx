import React from 'react';

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unknown render error',
    };
  }

  override componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('[ui] render failure', error);
  }

  override render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="mx-auto mt-10 max-w-2xl rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm">
        <h1 className="text-lg font-semibold text-destructive">Something went wrong</h1>
        <p className="mt-2 text-muted-foreground">
          The page hit a rendering error. Refresh and try again.
        </p>
        <pre className="mt-4 whitespace-pre-wrap rounded-md border border-border/60 bg-background/80 p-3 font-mono text-xs">
          {this.state.errorMessage}
        </pre>
      </main>
    );
  }
}
