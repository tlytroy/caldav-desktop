import Calendar from "../../components/Calendar";

/**
 * CalendarPage - 日历模块页面
 *
 * 将现有的 Calendar 组件包装为模块化页面。
 * 后续可以添加模块特有的布局、工具栏等。
 */
export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          日历
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          管理您的日历事件
        </p>
      </div>
      <Calendar />
    </div>
  );
}