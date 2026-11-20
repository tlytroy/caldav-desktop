/**
 * 提醒推送 API 客户端（服务端推送渠道）
 *
 * 渠道配置存在服务端的 config.json 里（敏感字段掩码传输），
 * 这里只做「读渠道状态 / 保存配置 / 发测试 / 立即检查」。
 */


import { createApiClient } from "./client";

const api = createApiClient(30000);

export type PushChannelId =
  | "wecom"
  | "serverchan"
  | "pushplus"
  | "bark"
  | "ntfy"
  | "webhook";

export interface PushChannelMeta {
  id: PushChannelId;
  label: string;
  hint: string;
  fields: string[];
  configured: boolean;
  enabled: boolean;
}

export interface PushChannelsResponse {
  success: boolean;
  pushEnabled: boolean;
  channels: PushChannelMeta[];
}

export interface PushResult {
  channel: PushChannelId;
  ok: boolean;
  error?: string;
}

export interface PushStatus {
  success: boolean;
  pushEnabled: boolean;
  channels: string[];
  configuredChannels: string[];
  dueCount: number;
  lastSentAt: number | null;
  lastRunAt: number | null;
  intervalSeconds: number;
  stateFile: string;
  lastResult: {
    channels: number;
    due: number;
    sent: number;
    failed: number;
    errors: string[];
  } | null;
}

/** 服务端配置（含 notifications 段；敏感字段是掩码） */
export interface ServerConfig {
  notifications: {
    enabled: boolean;
    channels: Record<
      PushChannelId,
      Record<string, unknown> & { enabled: boolean }
    >;
  };
  [key: string]: unknown;
}

export async function fetchPushChannels(): Promise<PushChannelsResponse> {
  const { data } = await api.get("/api/notifications/channels");
  return data;
}

export async function fetchPushStatus(): Promise<PushStatus> {
  const { data } = await api.get("/api/notifications/status");
  return data;
}

/** 发送测试消息；指定渠道时忽略「启用」开关 */
export async function sendTestPush(channel?: PushChannelId): Promise<{
  success: boolean;
  results: PushResult[];
  message?: string;
}> {
  const { data } = await api.post("/api/notifications/test", { channel });
  return data;
}

/** 立即执行一次「检查 + 推送」（调试用） */
export async function runPushCheck(): Promise<{
  success: boolean;
  channels: number;
  due: number;
  sent: number;
  failed: number;
  errors: string[];
}> {
  const { data } = await api.post("/api/notifications/check");
  return data;
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  const { data } = await api.get("/api/config");
  return data.config as ServerConfig;
}

export async function saveServerConfig(
  patch: Record<string, unknown>,
): Promise<ServerConfig> {
  const { data } = await api.put("/api/config", patch);
  return data.config as ServerConfig;
}
