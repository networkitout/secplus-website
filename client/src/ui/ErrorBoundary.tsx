import { Component, type ReactNode } from 'react';
import { ApiError, isUnavailable } from '../api/client';
import { Button } from './Button';

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
    const offline = isUnavailable(error);
    return (
      <div role="alert" className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="text-xl font-semibold">{offline ? "Can't reach the server" : 'Something went wrong'}</h1>
        <p className="text-muted">
          {offline
            ? 'Check your connection and try again. Your answers are kept until the server is back.'
            : error instanceof ApiError
              ? error.message
              : 'An unexpected error occurred.'}
        </p>
        <Button onClick={this.retry}>Retry</Button>
      </div>
    );
  }
}
