import type { EventTag } from '../../types';

interface TagSelectorProps {
  tags: EventTag[];
  selectedTags: EventTag[];
  onToggle: (tag: EventTag) => void;
}

export function TagSelector({ tags, selectedTags, onToggle }: TagSelectorProps) {
  const isSelected = (tag: EventTag) => selectedTags.some(t => t.id === tag.id);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        标签
      </label>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => onToggle(tag)}
            className={`px-3 py-1 text-sm rounded-full border ${
              isSelected(tag)
                ? 'bg-opacity-20 border-current'
                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
            style={{
              backgroundColor: isSelected(tag) ? tag.color : undefined,
              borderColor: tag.color,
              color: isSelected(tag) ? tag.color : undefined
            }}
          >
            {tag.name}
          </button>
        ))}
      </div>
    </div>
  );
}