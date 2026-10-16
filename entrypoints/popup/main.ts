import { sendToBackground } from '../../lib/messages';

/**
 * 弹窗：快捷操作入口。
 * 只提供最常用的动作与统计视图，详细配置在 options 页。
 */

interface StatEntry {
  title: string;
  count: number;
}

const statsEl = document.querySelector<HTMLElement>('#stats')!;

/** 拉取 TOP 50 统计并渲染。 */
async function refreshStats(): Promise<void> {
  const stats = await sendToBackground<StatEntry[]>({ type: 'getStats' });
  if (stats.length === 0) {
    statsEl.innerHTML = '<div class="empty">暂无访问数据</div>';
    return;
  }
  statsEl.innerHTML = stats
    .map(
      (s) =>
        `<div class="row"><span class="title">${escapeHtml(s.title)}</span><span class="count">${s.count}</span></div>`,
    )
    .join('');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.querySelector('#sortNow')!.addEventListener('click', async () => {
  await sendToBackground({ type: 'sortNow' });
  await refreshStats();
});

document.querySelector('#refresh')!.addEventListener('click', () => void refreshStats());

document.querySelector('#openOptions')!.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});

document.querySelector('#clear')!.addEventListener('click', async () => {
  if (!confirm('确定清空全部访问统计数据吗？')) return;
  await sendToBackground({ type: 'clearStats' });
  await refreshStats();
});

void refreshStats();
