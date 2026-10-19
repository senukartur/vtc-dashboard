import { Component, type ReactNode } from "react";
import { Button, Card } from "../shared/ui/primitives.js";

export class RouteErrorBoundary extends Component<
  { children: ReactNode; fallbackTitle: string; recoverLabel: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <Card role="alert">
          <h1>{this.props.fallbackTitle}</h1>
          <Button onClick={() => window.location.reload()}>{this.props.recoverLabel}</Button>
        </Card>
      );
    return this.props.children;
  }
}
