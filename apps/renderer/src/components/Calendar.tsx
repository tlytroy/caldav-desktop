import { useState, useMemo, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarStore } from '../store/calendarStore';
import { useSyncStore } from '../store/syncStore';
import { CategorySelector } from './ui/CategorySelector';
import { TagSelector } from './ui/TagSelector';
import { RecurrenceEditor } from './ui/RecurrenceEditor';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Modal } from './ui/Modal';
import { createCalendarEventFromForm, updateCalendarEventFromForm, deleteCalendarEvent } from '../api/calendar';
import type { EventFormData } from '../types';
import { useThemeStore } from '../store/themeStore';

interface CalendarProps {
  calendarUrl?: string;
}

export default function Calendar({ calendarUrl }: CalendarProps) {
  const {
    events,
    loadingState,
    error,
    loadEvents,
    forceSync,
    initSync,
    setLoadingState
  } = useCalendarEvents(calendarUrl || null);
  const { eventFilter } = useCalendarStore();
  const { removeEventFromCache } = useSyncStore();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<{ id: string; title: string } | null>(null);
  const { categories, tags } = useCalendarStore();
  const { borderRadius } = useThemeStore();
  const [formData, setFormData] = useState<EventFormData>({
    title: '',
    start: new Date(),
    end: new Date(Date.now() + 3600000),
    allDay: false,
    description: '',
    category: undefined,
    tags: [],
    recurrence: undefined
  });

  // 首次加载时执行初始化同步，但不要阻塞UI显示
  useEffect(() => {
    if (calendarUrl) {
      // 立即显示日历框架，事件数据在后台加载
      setLoadingState('success');

      // 在后台执行初始化同步
      initSync().catch(err => {
        console.error('Background sync failed:', err);
        // 后台同步失败不影响UI显示
      });
    }
  }, [calendarUrl, initSync, setLoadingState]);

  // 过滤事件
  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // 搜索文本过滤
      if (eventFilter.searchText) {
        const searchText = eventFilter.searchText.toLowerCase();
        const matchesTitle = event.title.toLowerCase().includes(searchText);
        const matchesDescription = event.description?.toLowerCase().includes(searchText);
        if (!matchesTitle && !matchesDescription) {
          return false;
        }
      }

      // 分类过滤
      if (eventFilter.categoryId) {
        if (!event.category || event.category.id !== eventFilter.categoryId) {
          return false;
        }
      }

      // 标签过滤
      if (eventFilter.tagIds && eventFilter.tagIds.length > 0) {
        if (!event.tags || event.tags.length === 0) {
          return false;
        }

        const hasMatchingTag = event.tags.some(tag =>
          eventFilter.tagIds?.includes(tag.id)
        );

        if (!hasMatchingTag) {
          return false;
        }
      }

      return true;
    });
  }, [events, eventFilter]);

  const handleSelect = (info: any) => {
    setFormData({
      title: '',
      start: info.start,
      end: info.end,
      allDay: info.allDay,
      description: ''
    });
    setShowModal(true);
  };

  const handleEventClick = (info: any) => {
    const event = events.find(e => e.id === info.event.id);
    if (event) {
      setFormData({
        id: event.id,
        title: event.title,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay || false,
        description: event.description || '',
        category: event.category,
        tags: event.tags || [],
        recurrence: event.recurrence
      });
      setShowModal(true);
    }
  };

  const handleSubmit = async () => {
    if (!calendarUrl) {
      alert('未选择日历');
      return;
    }

    try {
      // 立即更新UI - 关闭对话框
      setShowModal(false);

      // 显示成功消息
      console.log('事件保存成功，正在后台同步...');

      // 在后台执行实际的保存操作和同步
      const saveAndSync = async () => {
        try {
          if (formData.id) {
            // 更新现有事件
            await updateCalendarEventFromForm(formData.id, calendarUrl, {
              title: formData.title,
              start: formData.start,
              end: formData.end,
              allDay: formData.allDay,
              description: formData.description,
              category: formData.category,
              tags: formData.tags,
              recurrence: formData.recurrence
            });
          } else {
            // 创建新事件
            await createCalendarEventFromForm(calendarUrl, {
              title: formData.title,
              start: formData.start,
              end: formData.end,
              allDay: formData.allDay,
              description: formData.description,
              category: formData.category,
              tags: formData.tags,
              recurrence: formData.recurrence
            });
          }
          
          // 执行后台同步
          await forceSync();
          console.log('后台同步完成');
        } catch (err) {
          console.error('后台同步失败:', err);
          // 如果后台同步失败，可以在UI上显示一个小提示
          // 或者在下次应用启动时重试
        }
      };

      // 立即开始后台操作
      saveAndSync().catch(err => {
        console.error('后台保存失败:', err);
      });
    } catch (err) {
      console.error('保存事件失败:', err);
      alert(err instanceof Error ? err.message : '保存事件失败');
      // 如果立即操作失败，重新显示对话框
      setShowModal(true);
    }
  };

  const handleDeleteClick = () => {
    if (formData.id) {
      setEventToDelete({ id: formData.id, title: formData.title });
      setShowDeleteConfirm(true);
    }
  };

  const confirmDelete = async () => {
    if (eventToDelete?.id && calendarUrl) {
      try {
        // 立即更新UI - 关闭对话框
        setShowModal(false);
        setShowDeleteConfirm(false);
        setEventToDelete(null);

        // 立即从本地缓存中移除事件
        // 注意：这里我们不等待服务器响应，而是立即更新UI
        // 实际的服务器同步将在后台进行
        removeEventFromCache(calendarUrl, eventToDelete.id);
        
        // 显示成功消息
        console.log('事件删除成功，正在后台同步...');
        
        // 在后台执行同步操作
        forceSync().catch(err => {
          console.error('后台同步失败:', err);
          // 如果后台同步失败，可以在UI上显示一个小提示
          // 或者在下次应用启动时重试
        });
      } catch (err) {
        console.error('删除事件时发生错误:', err);
        // 如果立即操作失败，重新显示对话框
        setShowDeleteConfirm(true);
        
        // 显示详细错误信息
        let errorMessage = '删除事件时出现未知错误';
        if (err instanceof Error) {
          errorMessage = err.message;
        }

        // 如果是网络错误或其他技术错误，给用户更多上下文
        alert(`删除事件失败: ${errorMessage}\n\n请检查您的网络连接并重试。如果问题持续存在，请联系技术支持。`);
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toTimeString().slice(0, 5);
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  // 即使在加载或错误状态下也显示日历框架，但显示相应的提示
  if (loadingState === 'loading') {
    return (
      <div className="bg-white dark:bg-neutral-700 rounded-lg shadow p-4 relative">
        <div className="absolute top-4 right-4 z-10">
          <LoadingSpinner message="加载事件中..." />
        </div>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
          }}
          events={[]} // 加载过程中显示空事件列表
          weekends={true}
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={true}
          select={handleSelect}
          eventClick={handleEventClick}
          height="auto"
          contentHeight="auto"
          expandRows={true}
        />
      </div>
    );
  }

  if (loadingState === 'error') {
    return (
      <div className="bg-white dark:bg-neutral-700 rounded-lg shadow p-4 relative">
        <div className="absolute top-4 right-4 z-10">
          <div className="text-red-600 text-sm">错误: {error}</div>
          <button
            onClick={() => loadEvents()}
            className="px-2 py-1 text-xs text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors mt-1"
          >
            重试
          </button>
        </div>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
          }}
          events={events} // 即使有错误也显示已有的事件
          weekends={true}
          editable={true}
          selectable={true}
          selectMirror={true}
          dayMaxEvents={true}
          select={handleSelect}
          eventClick={handleEventClick}
          eventContent={(arg) => {
            const calendarEvent = events.find(e => e.id === arg.event.id);
            return (
              <div className="touch-pan-x touch-pan-y w-full">
                <div className="flex items-center">
                  {calendarEvent?.category && (
                    <div
                      className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                      style={{ backgroundColor: calendarEvent.category.color }}
                      title={calendarEvent.category.name}
                    />
                  )}
                  <span className="truncate">{arg.event.title}</span>
                  {calendarEvent?.tags && calendarEvent.tags.length > 0 && (
                    <div className="ml-1 flex">
                      {calendarEvent.tags.slice(0, 2).map(tag => (
                        <div
                          key={tag.id}
                          className="w-2 h-2 rounded-full ml-1 flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                          title={tag.name}
                        />
                      ))}
                      {calendarEvent.tags.length > 2 && (
                        <span className="text-xs ml-1">+{calendarEvent.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                  {calendarEvent?.recurrence && (
                    <span className="ml-1 text-xs">↻</span>
                  )}
                </div>
              </div>
            );
          }}
          height="auto"
          contentHeight="auto"
          expandRows={true}
        />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-700 rounded-lg shadow p-4 relative">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        }}
        events={filteredEvents.map(event => ({
          ...event,
          id: event.id
        }))}
        weekends={true}
        editable={true}
        selectable={true}
        selectMirror={true}
        dayMaxEvents={true}
        select={handleSelect}
        eventClick={handleEventClick}
        eventContent={(arg) => {
          const calendarEvent = filteredEvents.find(e => e.id === arg.event.id);
          return (
            <div className="touch-pan-x touch-pan-y w-full">
              <div className="flex items-center">
                {calendarEvent?.category && (
                  <div
                    className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                    style={{ backgroundColor: calendarEvent.category.color }}
                    title={calendarEvent.category.name}
                  />
                )}
                <span className="truncate">{arg.event.title}</span>
                {calendarEvent?.tags && calendarEvent.tags.length > 0 && (
                  <div className="ml-1 flex">
                    {calendarEvent.tags.slice(0, 2).map(tag => (
                      <div
                        key={tag.id}
                        className="w-2 h-2 rounded-full ml-1 flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                        title={tag.name}
                      />
                    ))}
                    {calendarEvent.tags.length > 2 && (
                      <span className="text-xs ml-1">+{calendarEvent.tags.length - 2}</span>
                    )}
                  </div>
                )}
                {calendarEvent?.recurrence && (
                  <span className="ml-1 text-xs">↻</span>
                )}
              </div>
            </div>
          );
        }}
        height="auto"
        contentHeight="auto"
        expandRows={true}
      />

      {/* 事件编辑模态框 */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={formData.id ? '编辑事件' : '创建新事件'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              事件标题 *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              placeholder="输入事件标题"
              autoFocus
            />
          </div>

          <div className="flex items-center">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.allDay}
                onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-base font-medium text-gray-700 dark:text-gray-300">全天事件</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                开始日期 *
              </label>
              <input
                type="date"
                value={formatDate(formData.start)}
                onChange={(e) => {
                  const newStart = new Date(e.target.value);
                  newStart.setHours(formData.start.getHours(), formData.start.getMinutes());
                  setFormData({ ...formData, start: newStart });
                }}
                className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                结束日期 *
              </label>
              <input
                type="date"
                value={formatDate(formData.end)}
                onChange={(e) => {
                  const newEnd = new Date(e.target.value);
                  newEnd.setHours(formData.end.getHours(), formData.end.getMinutes());
                  setFormData({ ...formData, end: newEnd });
                }}
                className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              />
            </div>
          </div>

          {!formData.allDay && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  开始时间
                </label>
                <input
                  type="time"
                  value={formatTime(formData.start)}
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(':').map(Number);
                    const newStart = new Date(formData.start);
                    newStart.setHours(hours, minutes);
                    setFormData({ ...formData, start: newStart });
                  }}
                  className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  结束时间
                </label>
                <input
                  type="time"
                  value={formatTime(formData.end)}
                  onChange={(e) => {
                    const [hours, minutes] = e.target.value.split(':').map(Number);
                    const newEnd = new Date(formData.end);
                    newEnd.setHours(hours, minutes);
                    setFormData({ ...formData, end: newEnd });
                  }}
                  className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className={`w-full px-4 py-3 text-base border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              rows={4}
              placeholder="输入事件描述（可选）"
            />
          </div>

          <CategorySelector
            categories={categories}
            selectedCategory={formData.category}
            onSelect={(category) => setFormData({ ...formData, category })}
          />

          <TagSelector
            tags={tags}
            selectedTags={formData.tags || []}
            onToggle={(tag) => {
              const currentTags = formData.tags || [];
              const newTags = currentTags.some(t => t.id === tag.id)
                ? currentTags.filter(t => t.id !== tag.id)
                : [...currentTags, tag];
              setFormData({ ...formData, tags: newTags });
            }}
          />

          <RecurrenceEditor
            value={formData.recurrence}
            onChange={(recurrence) => setFormData({ ...formData, recurrence })}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-3 mt-6 sticky bottom-0 bg-white dark:bg-neutral-700 py-4 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={() => setShowModal(false)}
            className={`px-6 py-3 text-base text-gray-700 bg-gray-100 ${borderRadius} hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors min-w-[100px]`}
          >
            取消
          </button>
          {formData.id && (
            <button
              onClick={handleDeleteClick}
              className={`px-6 py-3 text-base text-red-600 bg-red-50 ${borderRadius} hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors min-w-[100px]`}
            >
              删除
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!formData.title.trim()}
            className={`px-6 py-3 text-base text-white bg-indigo-600 ${borderRadius} hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed min-w-[100px]`}
          >
            {formData.id ? '保存更改' : '创建事件'}
          </button>
        </div>
      </Modal>

      {/* 删除确认框 */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="确认删除"
        size="sm"
      >
        <p className="text-gray-600 dark:text-gray-300 mb-6 text-base">
          确定要删除事件 "{eventToDelete?.title}" 吗？此操作无法撤销。
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className={`px-6 py-3 text-base text-gray-700 bg-gray-100 ${borderRadius} hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors min-w-[100px]`}
          >
            取消
          </button>
          <button
            onClick={confirmDelete}
            className={`px-6 py-3 text-base text-white bg-red-600 ${borderRadius} hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors min-w-[100px]`}
          >
            删除
          </button>
        </div>
      </Modal>
    </div>
  );
}