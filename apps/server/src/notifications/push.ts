/**
 * 提醒推送渠道（服务端 → 手机）
 * ==============================
 *
 * 支持国内最常用的几种「免登录、拿一个 key 就能收」的推送：
 *  - 企业微信群机器人 webhook
 *  - Server酱（sctapi.ftqq.com）
 *  - PushPlus（pushplus.plus）
 *  - Bark（iOS，自建/官方）
 *  - ntfy（可自建，Android/iOS/桌面都行）
 *  - 通用 Webhook（自己接 n8n / 飞书 / 自建服务）
 *
 * 只依赖 `fetch`，不引第三方 SDK —— 这些服务的 API 都是「发一个 HTTP 请求」，
 * 引 SDK 反而增加依赖和版本风险。
 *
 * 安全：webhook URL / token 在 config.json 里属于敏感字段，读取时会被掩码。
 */

import { getConfig } from "../config.js";

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
  /** 该渠道需要的字段说明 */
  fields: Array<"webhookUrl" | "sendKey" | "token" | "serverUrl" | "deviceKey" | "url" | "topic">;
}

export const PUSH_CHANNELS: PushChannelMeta[] = [
  {
    id: "wecom",
    label: "企业微信机器人",
    hint: "群设置 → 群机器人 → 添加 → 复制 Webhook 地址",
    fields: ["webhookUrl"],
  },
  {
    id: "serverchan",
    label: "Server酱",
    hint: "sct.ftqq.com 登录后取 SendKey（形如 SCTxxxxx）",
    fields: ["sendKey"],
  },
  {
    id: "pushplus",
    label: "PushPlus",
    hint: "pushplus.plus 登录后取 token",
    fields: ["token"],
  },
  {
    id: "bark",
    label: "Bark（iOS）",
    hint: "填服务器地址与设备 Key；官方服务器 https://api.day.app",
    fields: ["serverUrl", "deviceKey"],
  },
  {
    id: "ntfy",
    label: "ntfy（可自建）",
    hint: "填 server 地址、topic；自建时可选访问 token",
    fields: ["url", "topic", "token"],
  },
  {
    id: "webhook",
    label: "通用 Webhook",
    hint: "POST JSON {title, body, source, url, tags, timestamp}，可接 n8n / 飞书 / 自建服务",
    fields: ["url"],
  },
];

export interface PushMessage {
  title: string;
  body: string;
  /** 可点击跳转的链接（部分渠道支持） */
  url?: string;
  tags?: string[];
}

export interface PushResult {
  channel: PushChannelId;
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 8000;

/** 允许用环境变量覆盖（自建代理 / 测试用；默认是官方地址） */
const SERVERCHAN_BASE =
  process.env.SERVERCHAN_API_BASE || "https://sctapi.ftqq.com";
const PUSHPLUS_BASE =
  process.env.PUSHPLUS_API_BASE || "https://www.pushplus.plus";

function clip(s: string, max = 180): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return `HTTP ${res.status}：${clip(text)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function sendWecom(
  webhookUrl: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const res = await postJson(webhookUrl, {
      msgtype: "text",
      text: {
        content: `${msg.title}\n${msg.body}${msg.url ? `\n${msg.url}` : ""}`,
      },
    });
    if (!res.ok) return { channel: "wecom", ok: false, error: await readError(res) };
    const j: any = await res.json().catch(() => null);
    if (j && typeof j.errcode === "number" && j.errcode !== 0) {
      return {
        channel: "wecom",
        ok: false,
        error: `企业微信返回 errcode=${j.errcode} ${j.errmsg || ""}`,
      };
    }
    return { channel: "wecom", ok: true };
  } catch (e) {
    return { channel: "wecom", ok: false, error: (e as Error).message };
  }
}

async function sendServerChan(
  sendKey: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const base = SERVERCHAN_BASE.replace(/\/+$/, "");
    const url = `${base}/${encodeURIComponent(sendKey)}.send`;
    const form = new URLSearchParams({
      title: msg.title,
      desp: `${msg.body}${msg.url ? `\n\n[打开](${msg.url})` : ""}`,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { channel: "serverchan", ok: false, error: await readError(res) };
    const j: any = await res.json().catch(() => null);
    if (j && typeof j.code === "number" && j.code !== 0) {
      return {
        channel: "serverchan",
        ok: false,
        error: `Server酱返回 code=${j.code} ${j.message || ""}`,
      };
    }
    return { channel: "serverchan", ok: true };
  } catch (e) {
    return { channel: "serverchan", ok: false, error: (e as Error).message };
  }
}

async function sendPushPlus(
  token: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const res = await postJson(`${PUSHPLUS_BASE.replace(/\/+$/, "")}/send`, {
      token,
      title: msg.title,
      content: `${msg.body}${msg.url ? `\n\n[打开](${msg.url})` : ""}`,
      template: "markdown",
    });
    if (!res.ok) return { channel: "pushplus", ok: false, error: await readError(res) };
    const j: any = await res.json().catch(() => null);
    if (j && typeof j.code === "number" && j.code !== 200) {
      return {
        channel: "pushplus",
        ok: false,
        error: `PushPlus返回 code=${j.code} ${j.msg || ""}`,
      };
    }
    return { channel: "pushplus", ok: true };
  } catch (e) {
    return { channel: "pushplus", ok: false, error: (e as Error).message };
  }
}

async function sendBark(
  serverUrl: string,
  deviceKey: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const base = serverUrl.replace(/\/+$/, "");
    const url = `${base}/${encodeURIComponent(deviceKey)}/${encodeURIComponent(
      msg.title,
    )}/${encodeURIComponent(msg.body)}?group=${encodeURIComponent("日程提醒")}`;
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { channel: "bark", ok: false, error: await readError(res) };
    const j: any = await res.json().catch(() => null);
    if (j && typeof j.code === "number" && j.code !== 200) {
      return { channel: "bark", ok: false, error: `Bark返回 code=${j.code}` };
    }
    return { channel: "bark", ok: true };
  } catch (e) {
    return { channel: "bark", ok: false, error: (e as Error).message };
  }
}

async function sendNtfy(
  baseUrl: string,
  topic: string,
  token: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const base = baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    // 用 JSON publish（POST 到根路径），避免 Title 头只能放 ASCII 的问题
    const res = await postJson(
      base,
      {
        topic,
        title: msg.title,
        message: `${msg.body}${msg.url ? `\n${msg.url}` : ""}`,
        tags: msg.tags?.length ? msg.tags : ["calendar"],
      },
      headers,
    );
    if (!res.ok) return { channel: "ntfy", ok: false, error: await readError(res) };
    return { channel: "ntfy", ok: true };
  } catch (e) {
    return { channel: "ntfy", ok: false, error: (e as Error).message };
  }
}

async function sendWebhook(
  url: string,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    const res = await postJson(url, {
      source: "caldav-desktop",
      title: msg.title,
      body: msg.body,
      url: msg.url,
      tags: msg.tags,
      timestamp: new Date().toISOString(),
    });
    if (!res.ok) return { channel: "webhook", ok: false, error: await readError(res) };
    return { channel: "webhook", ok: true };
  } catch (e) {
    return { channel: "webhook", ok: false, error: (e as Error).message };
  }
}

/** 已启用且配置完整的渠道 */
export function enabledChannelIds(): PushChannelId[] {
  const n = getConfig().notifications;
  if (!n.enabled) return [];
  const ids: PushChannelId[] = [];
  if (n.channels.wecom.enabled && n.channels.wecom.webhookUrl) ids.push("wecom");
  if (n.channels.serverchan.enabled && n.channels.serverchan.sendKey) {
    ids.push("serverchan");
  }
  if (n.channels.pushplus.enabled && n.channels.pushplus.token) ids.push("pushplus");
  if (n.channels.bark.enabled && n.channels.bark.deviceKey) ids.push("bark");
  if (n.channels.ntfy.enabled && n.channels.ntfy.topic) ids.push("ntfy");
  if (n.channels.webhook.enabled && n.channels.webhook.url) ids.push("webhook");
  return ids;
}

/** 某个渠道是否「配置完整」（忽略 enabled 开关，测试按钮要用） */
export function channelConfigured(id: PushChannelId): boolean {
  const n = getConfig().notifications.channels;
  switch (id) {
    case "wecom":
      return !!n.wecom.webhookUrl;
    case "serverchan":
      return !!n.serverchan.sendKey;
    case "pushplus":
      return !!n.pushplus.token;
    case "bark":
      return !!n.bark.deviceKey;
    case "ntfy":
      return !!n.ntfy.topic;
    case "webhook":
      return !!n.webhook.url;
    default:
      return false;
  }
}

async function sendOne(id: PushChannelId, msg: PushMessage): Promise<PushResult> {
  const n = getConfig().notifications.channels;
  switch (id) {
    case "wecom":
      if (!n.wecom.webhookUrl) return { channel: id, ok: false, error: "未填 Webhook 地址" };
      return sendWecom(n.wecom.webhookUrl, msg);
    case "serverchan":
      if (!n.serverchan.sendKey) return { channel: id, ok: false, error: "未填 SendKey" };
      return sendServerChan(n.serverchan.sendKey, msg);
    case "pushplus":
      if (!n.pushplus.token) return { channel: id, ok: false, error: "未填 token" };
      return sendPushPlus(n.pushplus.token, msg);
    case "bark":
      if (!n.bark.deviceKey) return { channel: id, ok: false, error: "未填设备 Key" };
      return sendBark(n.bark.serverUrl, n.bark.deviceKey, msg);
    case "ntfy":
      if (!n.ntfy.topic) return { channel: id, ok: false, error: "未填 topic" };
      return sendNtfy(n.ntfy.url, n.ntfy.topic, n.ntfy.token, msg);
    case "webhook":
      if (!n.webhook.url) return { channel: id, ok: false, error: "未填 Webhook 地址" };
      return sendWebhook(n.webhook.url, msg);
    default:
      return { channel: id, ok: false, error: `未知渠道：${id}` };
  }
}

/**
 * 发一条提醒到所有已启用渠道。
 *
 * 返回每个渠道的结果；**只要有一个成功**，调用方就可以认为「已推送」，
 * 避免某个渠道配错导致其他渠道重复收到。
 */
export async function sendPush(msg: PushMessage): Promise<PushResult[]> {
  const ids = enabledChannelIds();
  if (!ids.length) return [];
  return Promise.all(ids.map((id) => sendOne(id, msg)));
}

/** 测试推送：指定渠道时忽略 enabled 开关（方便边填边测） */
export async function sendTestPush(
  channel?: PushChannelId,
): Promise<PushResult[]> {
  const msg: PushMessage = {
    title: "【测试】日程提醒",
    body: "收到这条消息说明推送配置可用。这是一条测试消息，没有对应日程。",
    tags: ["test"],
  };
  if (channel) return [await sendOne(channel, msg)];
  const ids = enabledChannelIds();
  if (!ids.length) return [];
  return Promise.all(ids.map((id) => sendOne(id, msg)));
}
