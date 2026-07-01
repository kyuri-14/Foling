// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

// Top-level error boundary. Without this, a render-time exception unmounts the
// whole React tree and leaves a blank white window with no way to recover.
// Here we catch it, show the message, and offer a reload.
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console for diagnosis; also keep a short component stack.
    console.error("Foling crashed:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-box">
          <h1>予期しないエラーが発生しました</h1>
          <p>
            編集中のデータはディスクに自動保存されています(直近の数百ミリ秒分は
            失われる場合があります)。下のボタンで再読み込みしてください。
          </p>
          <pre className="crash-message">{String(this.state.error)}</pre>
          {this.state.info && (
            <details>
              <summary>詳細 (スタックトレース)</summary>
              <pre className="crash-stack">{this.state.info}</pre>
            </details>
          )}
          <div className="crash-actions">
            <button onClick={() => window.location.reload()}>
              再読み込み
            </button>
            <button
              onClick={() => this.setState({ error: null, info: null })}
            >
              この画面を閉じて続行
            </button>
          </div>
        </div>
      </div>
    );
  }
}
