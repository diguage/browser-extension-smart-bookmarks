import browser from 'webextension-polyfill';
import type { Settings } from './types';

/**
 * 后台与各 UI 页面之间的消息协议。
 * 集中定义便于类型安全与扩展：新增动作只改这里 + 后台的 handler。
 */

export type BackgroundMessage =
  | { type: 'getStats' }
  | { type: 'getSettings' }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'sortNow' }
  | { type: 'clearStats' }
  | { type: 'openBookmark'; id: string }
  | { type: 'dedupePreview' }
  | { type: 'dedupeExecute' };

export type BackgroundResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

/** 给 UI 页面用的统一发送封装，返回 Promise，简化调用。 */
export async function sendToBackground<T = unknown>(
  message: BackgroundMessage,
): Promise<T> {
  const res = (await browser.runtime.sendMessage(message)) as BackgroundResponse;
  if (!res || res.ok === false) {
    throw new Error(res?.error ?? '后台响应异常');
  }
  return res.data as T;
}
