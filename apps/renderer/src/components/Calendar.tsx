import { useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarStore } from '../store/calendarStore';
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
  const { events, loadingState, error, loadEvents } = useCalendarEvents(calendarUrl || null);
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
      await loadEvents(); // 重新加载事件
      setShowModal(false);
    } catch (err) {
      console.error('保存事件失败:', err);
      alert(err instanceof Error ? err.message : '保存事件失败');
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
        await deleteCalendarEvent(eventToDelete.id, calendarUrl);
        await loadEvents(); // 重新加载事件
        setShowModal(false);
        setShowDeleteConfirm(false);
      } catch (err) {
        console.error('删除事件失败:', err);
        alert(err instanceof Error ? err.message : '删除事件失败');
      }
    }
  };

  const formatTime = (date: Date) => {
    return date.toTimeString().slice(0, 5);
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  if (loadingState === 'loading') {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner message="加载事件中..." />
      </div>
    );
  }

  if (loadingState === 'error') {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <p className="text-red-600 mb-2">错误: {error}</p>
          <button
            onClick={() => loadEvents()}
            className="px-4 py-2 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-700 rounded-lg shadow p-4">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        }}
        events={events}
        weekends={true}
        editable={true}
        selectable={true}
        selectMirror={true}
        dayMaxEvents={true}
        select={handleSelect}
        eventClick={handleEventClick}
        eventContent={(arg) => {
          return <div>{arg.event.title}</div>;
        }}
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
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              placeholder="输入事件标题"
            />
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.allDay}
                onChange={(e) => setFormData({ ...formData, allDay: e.target.checked })}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">全天事件</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
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
                className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              />
            </div>
          </div>

          {!formData.allDay && (
            <div className="grid grid-cols-2 gap-4">
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
                  className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
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
                  className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
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
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 ${borderRadius} focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white`}
              rows={3}
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

        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={() => setShowModal(false)}
            className={`px-4 py-2 text-gray-700 bg-gray-100 ${borderRadius} hover:bg-gray-200 transition-colors`}
          >
            取消
          </button>
          {formData.id && (
            <button
              onClick={handleDeleteClick}
              className={`px-4 py-2 text-red-600 bg-red-50 ${borderRadius} hover:bg-red-100 transition-colors`}
            >
              删除
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!formData.title.trim()}
            className={`px-4 py-2 text-white bg-indigo-600 ${borderRadius} hover:bg-indigo-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed`}
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
        <p className="text-gray-600 mb-4">
          确定要删除事件 "{eventToDelete?.title}" 吗？此操作无法撤销。
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className={`px-4 py-2 text-gray-700 bg-gray-100 ${borderRadius} hover:bg-gray-200 transition-colors`}
          >
            取消
          </button>
          <button
            onClick={confirmDelete}
            className={`px-4 py-2 text-white bg-red-600 ${borderRadius} hover:bg-red-700 transition-colors`}
          >
            删除
          </button>
        </div>
      </Modal>
    </div>
  );
}