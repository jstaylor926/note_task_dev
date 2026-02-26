import { invoke } from "@tauri-apps/api/core";

export interface HealthStatus {
  tauri: string;
  sidecar: string;
  sqlite: string;
  lancedb: string;
}

export async function checkHealth(): Promise<HealthStatus> {
  return invoke<HealthStatus>("health_check");
}

export async function getAppStatus(): Promise<string> {
  return invoke<string>("get_app_status");
}
