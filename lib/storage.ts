import browser from 'webextension-polyfill';
import {
  DEFAULT_PROMOTE_THRESHOLD,
  SCHEMA_VERSION,
  STORE_KEY,
} from './constants';
import type { Settings, StoreData } from './types';

/** 默认设置：与设计文档第 12 节「已确定的决策」保持一致。 */
export const DEFAULT_SETTINGS: Settings = {
  reorderNativeBar: true,
  nativeDirection: 'rightHigh',
  overflowMode: 'customFolder',
  sortSubfolders: true,
  deduplicateEnabled: false,
  autoPromoteToBar: false,
  promoteThreshold: DEFAULT_PROMOTE_THRESHOLD,
  syncEnabled: false,
  debugSortIntervalMinutes: 0,
};

/** 构造一份全新的空数据对象。 */
export function createEmptyStore(): StoreData {
  return {
    schemaVersion: SCHEMA_VERSION,
    visits: {},
    lastVisitedAt: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * 读取完整数据对象；不存在时写入默认值并返回。
 * 所有读写都走这个入口，保证 schema 与默认值唯一。
 */
export async function loadStore(): Promise<StoreData> {
  const result = await browser.storage.local.get(STORE_KEY);
  const existing = result[STORE_KEY] as Partial<StoreData> | undefined;

  if (!existing) {
    const empty = createEmptyStore();
    await browser.storage.local.set({ [STORE_KEY]: empty });
    return empty;
  }

  // 合并默认设置：新增字段时老数据也能平稳升级
  const merged: StoreData = {
    schemaVersion: existing.schemaVersion ?? SCHEMA_VERSION,
    visits: existing.visits ?? {},
    lastVisitedAt: existing.lastVisitedAt ?? {},
    moreFolderId: existing.moreFolderId,
    settings: { ...DEFAULT_SETTINGS, ...(existing.settings ?? {}) },
  };
  return merged;
}

/** 保存完整数据对象。 */
export async function saveStore(store: StoreData): Promise<void> {
  await browser.storage.local.set({ [STORE_KEY]: store });
}

/** 清空访问统计，保留设置。 */
export async function clearVisits(): Promise<void> {
  const store = await loadStore();
  store.visits = {};
  store.lastVisitedAt = {};
  await saveStore(store);
}

/** 读取设置（带默认值）。 */
export async function loadSettings(): Promise<Settings> {
  const store = await loadStore();
  return store.settings;
}

/** 部分更新设置并写回。 */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const store = await loadStore();
  store.settings = { ...store.settings, ...patch };
  await saveStore(store);
  return store.settings;
}

/**
 * 跨设备同步：把本地计数快照推送到 storage.sync。
 * 注意：只推计数，不推设置（设置各端独立更符合直觉）；写入频率受浏览器配额限制，
 * 因此调用方应做 debounce，而不是每次点击都推。
 */
export async function pushSyncSnapshot(store: StoreData): Promise<void> {
  if (!store.settings.syncEnabled) return;
  await browser.storage.sync.set({
    [STORE_KEY]: {
      schemaVersion: SCHEMA_VERSION,
      visits: store.visits,
      lastVisitedAt: store.lastVisitedAt,
    },
  });
}

/**
 * 跨设备同步：从 storage.sync 拉取远端快照并合并进本地。
 * 合并规则：按 URL 计数相加、lastVisitedAt 取较新值。
 * 返回值表示是否发生了合并（有远端数据）。
 */
export async function pullAndMergeSync(store: StoreData): Promise<boolean> {
  if (!store.settings.syncEnabled) return false;
  const result = await browser.storage.sync.get(STORE_KEY);
  const remote = result[STORE_KEY] as Partial<StoreData> | undefined;
  if (!remote?.visits) return false;

  for (const [url, count] of Object.entries(remote.visits)) {
    store.visits[url] = (store.visits[url] ?? 0) + count;
  }
  for (const [url, ts] of Object.entries(remote.lastVisitedAt ?? {})) {
    store.lastVisitedAt[url] = Math.max(store.lastVisitedAt[url] ?? 0, ts);
  }
  await saveStore(store);
  return true;
}
