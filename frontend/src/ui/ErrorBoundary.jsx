import { Component } from "react";
import { Button } from "./primitives";
import * as SentryModule from "@sentry/react";
import { SENTRY_DSN, IS_DEV } from "../config";

const Sentry = SENTRY_DSN ? SentryModule : null;

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (Sentry) {
      Sentry.captureException(error, { extra: errorInfo });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { level } = this.props;
    const { error } = this.state;

    if (level === "page") {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="w-full max-w-md rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-(--ui-surface) p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xl font-bold text-amber-600">
              !
            </div>
            <h2 className="mb-1 text-lg font-semibold text-(--text-primary)">
              Something went wrong
            </h2>
            <p className="mb-4 text-sm text-(--text-secondary)">
              This section encountered an error. You can try again or reload the page.
            </p>
            {IS_DEV && error && (
              <pre className="mb-4 max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-800">
                {error.message}
                {"\n"}
                {error.stack}
              </pre>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button onClick={() => window.location.reload()}>Reload</Button>
            </div>
          </div>
        </div>
      );
    }

    // Global / full-page error
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--ui-bg) p-4">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-2xl font-bold text-amber-600">
            !
          </div>
          <h1 className="mb-2 text-2xl font-bold text-(--text-primary)">
            Something went wrong
          </h1>
          <p className="mb-6 text-(--text-secondary)">
            An unexpected error occurred. Please reload the page to continue.
          </p>
          {IS_DEV && error && (
            <pre className="mb-6 max-h-60 overflow-auto rounded-lg bg-red-50 p-4 text-left text-xs text-red-800">
              {error.message}
              {"\n"}
              {error.stack}
            </pre>
          )}
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </div>
      </div>
    );
  }
}
