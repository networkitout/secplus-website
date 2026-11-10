import { Component, type ReactNode } from 'react';
import { ApiError, isUnavailable } from '../api/client';
import { Button } from './Button';
import { Footer } from './Footer';
import { usePageTitle } from './routeChange';

interface Props {
  children: ReactNode;
  /** Called when the user presses Retry, before the children are mounted again. */
  onRetry?: () => void;
}

export class ErrorBoundary extends Component<Props, { error: unknown; attempt: number }> {
  state = { error: undefined as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  retry = () => {
    this.props.onRetry?.();
    this.setState((s) => ({ error: undefined, attempt: s.attempt + 1 }));
  };

  render() {
    const { error, attempt } = this.state;
    if (error === undefined) return <div key={attempt} className="contents">{this.props.children}</div>;
    return <ErrorScreen error={error} onRetry={this.retry} />;
  }
}

/** What takes the place of the whole app. It is outside the app shell, so it titles the document itself. */
function ErrorScreen({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const offline = isUnavailable(error);
  const title = offline ? "Can't reach the server" : 'Something went wrong';
  usePageTitle(title);
  return (
    <div className="flex min-h-screen flex-col">
      <div role="alert" className="mx-auto w-full max-w-md flex-1 space-y-4 p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-muted">
          {offline
            ? 'Check your connection and try again. Your answers are kept until the server is back.'
            : error instanceof ApiError
              ? error.message
              : 'An unexpected error occurred.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Button onClick={onRetry}>Retry</Button>
          {/* When the page fails every time it is drawn, Retry and Back both lead here again. A plain
              link, not the router's: the app is loaded afresh at a page that is not the broken one.
              Not while the server cannot be reached: loading the app again would not work either, and
              would drop the answers that are waiting to be saved. */}
          {!offline && (
            <a href="/" className="rounded-sm text-accent underline underline-offset-2">
              Go to the study path
            </a>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
