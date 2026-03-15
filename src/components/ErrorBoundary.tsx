"use client";

// src/components/ErrorBoundary.tsx
// Catches render errors and shows a clean recovery UI

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="min-h-screen bg-[oklch(0.07_0.01_260)] flex items-center justify-center p-6"
          style={{ fontFamily: "'Berkeley Mono', 'JetBrains Mono', monospace" }}
        >
          <div className="max-w-md w-full border border-[oklch(0.25_0.08_25)] rounded-xl bg-[oklch(0.09_0.02_25)] p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[oklch(0.65_0.18_25)] text-xl">⚠</span>
              <h2 className="text-sm font-semibold text-[oklch(0.82_0.06_25)]">
                Something went wrong
              </h2>
            </div>
            <p className="text-xs text-[oklch(0.48_0.06_260)] font-mono leading-relaxed">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex-1 py-2 rounded-lg bg-[oklch(0.65_0.18_145)] text-[oklch(0.07_0.01_260)] text-xs font-semibold hover:bg-[oklch(0.7_0.18_145)] transition-all"
              >
                Try again
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="flex-1 py-2 rounded-lg border border-[oklch(0.22_0.04_260)] text-xs text-[oklch(0.55_0.06_260)] hover:border-[oklch(0.35_0.06_260)] transition-all"
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
