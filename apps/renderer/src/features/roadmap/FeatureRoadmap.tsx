const modules = [
  { name: 'Calendar Workspace', status: 'ready', note: '日历视图与事件交互' },
  { name: 'Config Manager', status: 'ready', note: 'CalDAV 连接与配置' },
  { name: 'Sync Engine', status: 'in-progress', note: '同步队列与缓存' },
  { name: 'Event Search', status: 'planned', note: '过滤与高级搜索' },
  { name: 'Shared Library', status: 'planned', note: '通用表单与模型' },
];

export function FeatureRoadmap() {
  return (
    <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-neutral-700">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          模块开发路线
        </h2>
        <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
          Lego 架构
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {modules.map((module) => (
          <div
            key={module.name}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/60"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {module.name}
              </span>
              <span
                className={[
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  module.status === 'ready' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                  module.status === 'in-progress' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                  module.status === 'planned' && 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
                ].join(' ')}
              >
                {module.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-300">{module.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
