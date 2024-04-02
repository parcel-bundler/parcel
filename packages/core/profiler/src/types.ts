export interface TraceMeasurement {
  end(): void;
}
export type TraceMeasurementData = {
  readonly categories: string[];
  readonly args?: Record<string, unknown>;
};
