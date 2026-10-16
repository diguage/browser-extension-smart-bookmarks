import { sendToBackground } from '../../lib/messages';
import type { Settings } from '../../lib/types';

/**
 * 设置页：读写全部配置，并提供物理去重的预览与执行入口。
 * 所有持久化都经后台统一处理，页面本身不直接写 storage。
 */

interface DedupeGroup {
  url: string;
  title: string;
  keepId: string;
  remove: Array<{ id: string; title: string }>;
}

const statusEl = document.querySelector<HTMLElement>('#status')!;
const resultEl = document.querySelector<HTMLElement>('#dedupeResult')!;

/** 按 id 映射表单元素，集中读写。 */
function field<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
  setTimeout(() => (statusEl.textContent = ''), 3000);
}

/** 从后台读取设置并填到表单。 */
async function loadForm(): Promise<void> {
  const settings = await sendToBackground<Settings>({ type: 'getSettings' });
  field<HTMLInputElement>('reorderNativeBar').checked = settings.reorderNativeBar;
  field<HTMLSelectElement>('nativeDirection').value = settings.nativeDirection;
  field<HTMLSelectElement>('overflowMode').value = settings.overflowMode;
  field<HTMLInputElement>('sortSubfolders').checked = settings.sortSubfolders;
  field<HTMLInputElement>('autoPromoteToBar').checked = settings.autoPromoteToBar;
  field<HTMLInputElement>('promoteThreshold').value = String(settings.promoteThreshold);
  field<HTMLInputElement>('syncEnabled').checked = settings.syncEnabled;
  field<HTMLInputElement>('deduplicateEnabled').checked = settings.deduplicateEnabled;
  field<HTMLInputElement>('debugSortIntervalMinutes').value = String(
    settings.debugSortIntervalMinutes,
  );
}

/** 收集表单并保存。 */
async function saveForm(): Promise<void> {
  const patch: Partial<Settings> = {
    reorderNativeBar: field<HTMLInputElement>('reorderNativeBar').checked,
    nativeDirection: field<HTMLSelectElement>('nativeDirection').value as Settings['nativeDirection'],
    overflowMode: field<HTMLSelectElement>('overflowMode').value as Settings['overflowMode'],
    sortSubfolders: field<HTMLInputElement>('sortSubfolders').checked,
    autoPromoteToBar: field<HTMLInputElement>('autoPromoteToBar').checked,
    promoteThreshold: Number(field<HTMLInputElement>('promoteThreshold').value) || 30,
    syncEnabled: field<HTMLInputElement>('syncEnabled').checked,
    deduplicateEnabled: field<HTMLInputElement>('deduplicateEnabled').checked,
    debugSortIntervalMinutes: Number(field<HTMLInputElement>('debugSortIntervalMinutes').value) || 0,
  };
  await sendToBackground({ type: 'updateSettings', patch });
  setStatus('已保存');
}

/** 预览重复书签。 */
async function previewDedupe(): Promise<void> {
  const groups = await sendToBackground<DedupeGroup[]>({ type: 'dedupePreview' });
  if (groups.length === 0) {
    resultEl.textContent = '没有重复书签';
    return;
  }
  resultEl.textContent = groups
    .map(
      (g) =>
        `保留：${g.title}\n  删除：${g.remove.map((r) => r.title).join('、')}\n`,
    )
    .join('\n');
}

/** 执行物理去重。 */
async function executeDedupe(): Promise<void> {
  if (!confirm('确认删除预览中的重复书签吗？此操作不可撤销，建议先备份书签。')) return;
  try {
    const result = await sendToBackground<{ removedGroups: number }>({
      type: 'dedupeExecute',
    });
    setStatus(`已处理 ${result.removedGroups} 组重复书签`);
    await previewDedupe();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

field('save').addEventListener('click', () => void saveForm());
field('dedupePreview').addEventListener('click', () => void previewDedupe());
field('dedupeExecute').addEventListener('click', () => void executeDedupe());

void loadForm();
