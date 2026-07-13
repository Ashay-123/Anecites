import { type ReactElement } from "react";

import { type NativeMonitoringSnapshot } from "./native.js";
import { type NativeMonitoringStatus } from "./meeting-types.js";

export interface NativeMonitorPanelProps {
  status: NativeMonitoringStatus;
  error: string | null;
  snapshot: NativeMonitoringSnapshot | null;
  protectedWindowCount: number;
  detectedVmSignalCount: number;
  onRunCheck: () => void;
}

export function NativeMonitorPanel({
  status,
  error,
  snapshot,
  protectedWindowCount,
  detectedVmSignalCount,
  onRunCheck,
}: NativeMonitorPanelProps): ReactElement {
  return (
    <section className="meeting-native-panel" id="native-monitor" aria-label="Native monitor">
      <header>
        <h2>Native monitor</h2>
        <span aria-live="polite">{status}</span>
      </header>
      <button type="button" onClick={onRunCheck} disabled={status === "scanning"}>
        Run native check
      </button>
      <dl>
        <div>
          <dt>Processes</dt>
          <dd>{snapshot?.processReport.processes.length ?? "-"}</dd>
        </div>
        <div>
          <dt>Windows</dt>
          <dd>{snapshot?.windowReport.windows.length ?? "-"}</dd>
        </div>
        <div>
          <dt>Capture flags</dt>
          <dd>{protectedWindowCount}</dd>
        </div>
        <div>
          <dt>VM signals</dt>
          <dd>{detectedVmSignalCount}</dd>
        </div>
      </dl>
      {error ? (
        <p className="meeting-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
