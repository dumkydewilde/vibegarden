export type AnalysisSourceHandle = { id: string; expiresAt?: number };
export type AnalysisQueryResult = {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
};

export interface AnalysisBackend {
  inspect(userId: string, sourceUrl: URL): Promise<AnalysisSourceHandle>;
  query(userId: string, handle: AnalysisSourceHandle, sql: string): Promise<AnalysisQueryResult>;
  release(userId: string, handle: AnalysisSourceHandle): Promise<void>;
}
