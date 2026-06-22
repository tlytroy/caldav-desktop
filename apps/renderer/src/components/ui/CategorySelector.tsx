import type { EventCategory } from '../../types';
import { useThemeStore, getCurrentColorScheme } from '../../store/themeStore';

interface CategorySelectorProps {
  categories: EventCategory[];
  selectedCategory?: EventCategory;
  onSelect: (category: EventCategory | undefined) => void;
}

export function CategorySelector({ categories, selectedCategory, onSelect }: CategorySelectorProps) {
  const themeState = useThemeStore.getState();
  const currentScheme = getCurrentColorScheme(themeState);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        分类
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelect(undefined)}
          className={`px-3 py-1 text-sm rounded-full border ${
            !selectedCategory
              ? `bg-[${currentScheme.primary}] bg-opacity-20 text-[${currentScheme.primary}] border-[${currentScheme.primary}]`
              : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
          }`}
        >
          无分类
        </button>

        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category)}
            className={`px-3 py-1 text-sm rounded-full border ${
              selectedCategory?.id === category.id
                ? 'bg-opacity-20 border-current'
                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
            style={{
              backgroundColor: selectedCategory?.id === category.id ? category.color : undefined,
              borderColor: category.color,
              color: selectedCategory?.id === category.id ? category.color : undefined
            }}
          >
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
}