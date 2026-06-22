import { useState, useEffect } from 'react';
import { useThemeStore, morandiSchemes, getCurrentColorScheme } from '../../store/themeStore';
import { Palette, Sun, Moon, Square, Shapes } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    isDarkMode,
    toggleTheme,
    colorScheme,
    setColorScheme,
    customColors,
    setCustomColors,
    borderRadius,
    setBorderRadius
  } = useThemeStore();

  const [tempCustomColors, setTempCustomColors] = useState<Record<string, string>>({});
  const [showCustomColorPicker, setShowCustomColorPicker] = useState(false);

  // 初始化临时自定义颜色
  useEffect(() => {
    if (customColors) {
      setTempCustomColors({
        primary: customColors.primary || '',
        secondary: customColors.secondary || '',
        accent: customColors.accent || '',
        neutral: customColors.neutral || ''
      });
    } else {
      setTempCustomColors({});
    }
  }, [customColors, isOpen]);

  const handleColorSchemeChange = (scheme: string) => {
    setColorScheme(scheme);
    setCustomColors(null);
    setShowCustomColorPicker(false);
  };

  const handleCustomColorChange = (key: string, value: string) => {
    setTempCustomColors(prev => ({ ...prev, [key]: value }));
  };

  const saveCustomColors = () => {
    setCustomColors(tempCustomColors);
    setColorScheme('custom');
  };

  const handleBorderRadiusChange = (radius: string) => {
    setBorderRadius(radius);
  };

  const currentScheme = getCurrentColorScheme(useThemeStore.getState());

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="设置" size="lg">
      <div className="space-y-6">
        {/* 主题设置 */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <Sun className="w-5 h-5 mr-2" />
            主题设置
          </h3>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <span className="text-gray-700 dark:text-gray-200">暗色模式</span>
            <button
              onClick={toggleTheme}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                isDarkMode ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isDarkMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
              {isDarkMode ? (
                <Moon className="absolute left-1 w-3 h-3 text-gray-400" />
              ) : (
                <Sun className="absolute right-1 w-3 h-3 text-yellow-500" />
              )}
            </button>
          </div>
        </div>

        {/* 配色方案 */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <Palette className="w-5 h-5 mr-2" />
            配色方案
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(morandiSchemes).map(([key, scheme]) => (
              <button
                key={key}
                onClick={() => handleColorSchemeChange(key)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  colorScheme === key && !customColors
                    ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                    : 'border-gray-200 dark:border-gray-600 hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
              >
                <div className="flex items-center mb-2">
                  <div
                    className="w-4 h-4 rounded-full mr-2"
                    style={{ backgroundColor: scheme.primary }}
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {scheme.name}
                  </span>
                </div>
                <div className="flex space-x-1">
                  <div
                    className="w-6 h-3 rounded"
                    style={{ backgroundColor: scheme.primary }}
                  />
                  <div
                    className="w-6 h-3 rounded"
                    style={{ backgroundColor: scheme.secondary }}
                  />
                  <div
                    className="w-6 h-3 rounded"
                    style={{ backgroundColor: scheme.accent }}
                  />
                  <div
                    className="w-6 h-3 rounded"
                    style={{ backgroundColor: scheme.neutral }}
                  />
                </div>
              </button>
            ))}

            <button
              onClick={() => setShowCustomColorPicker(!showCustomColorPicker)}
              className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center ${
                customColors
                  ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-900'
                  : 'border-gray-200 dark:border-gray-600 hover:border-indigo-300 dark:hover:border-indigo-700'
              }`}
            >
              <Shapes className="w-6 h-6 text-gray-400 mb-1" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                自定义
              </span>
            </button>
          </div>

          {showCustomColorPicker && (
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-4">
              <h4 className="font-medium text-gray-900 dark:text-white">自定义颜色</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    主色
                  </label>
                  <div className="flex items-center">
                    <input
                      type="color"
                      value={tempCustomColors.primary || currentScheme.primary}
                      onChange={(e) => handleCustomColorChange('primary', e.target.value)}
                      className="w-10 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {tempCustomColors.primary || currentScheme.primary}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    次色
                  </label>
                  <div className="flex items-center">
                    <input
                      type="color"
                      value={tempCustomColors.secondary || currentScheme.secondary}
                      onChange={(e) => handleCustomColorChange('secondary', e.target.value)}
                      className="w-10 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {tempCustomColors.secondary || currentScheme.secondary}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    强调色
                  </label>
                  <div className="flex items-center">
                    <input
                      type="color"
                      value={tempCustomColors.accent || currentScheme.accent}
                      onChange={(e) => handleCustomColorChange('accent', e.target.value)}
                      className="w-10 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {tempCustomColors.accent || currentScheme.accent}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                    中性色
                  </label>
                  <div className="flex items-center">
                    <input
                      type="color"
                      value={tempCustomColors.neutral || currentScheme.neutral}
                      onChange={(e) => handleCustomColorChange('neutral', e.target.value)}
                      className="w-10 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                    />
                    <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {tempCustomColors.neutral || currentScheme.neutral}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={saveCustomColors}
                className="w-full px-4 py-2 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
              >
                保存自定义颜色
              </button>
            </div>
          )}
        </div>

        {/* 圆角设置 */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
            <Square className="w-5 h-5 mr-2" />
            圆角设置
          </h3>

          <div className="grid grid-cols-4 gap-2">
            {[
              { name: '无圆角', value: 'rounded-none', example: 'square' },
              { name: '小圆角', value: 'rounded-sm', example: 'small' },
              { name: '默认', value: 'rounded', example: 'default' },
              { name: '大圆角', value: 'rounded-lg', example: 'large' },
            ].map((item) => (
              <button
                key={item.value}
                onClick={() => handleBorderRadiusChange(item.value)}
                className={`p-3 flex flex-col items-center justify-center border-2 ${
                  borderRadius === item.value
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
              >
                <div className="w-12 h-8 mb-1 flex items-center justify-center">
                  {item.example === 'square' ? (
                    <div className="w-8 h-6 bg-gray-300 dark:bg-gray-600"></div>
                  ) : item.example === 'small' ? (
                    <div className="w-8 h-6 bg-gray-300 dark:bg-gray-600 rounded-sm"></div>
                  ) : item.example === 'default' ? (
                    <div className="w-8 h-6 bg-gray-300 dark:bg-gray-600 rounded"></div>
                  ) : (
                    <div className="w-8 h-6 bg-gray-300 dark:bg-gray-600 rounded-lg"></div>
                  )}
                </div>
                <span className="text-xs text-gray-700 dark:text-gray-300">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-gray-100 dark:text-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
        >
          关闭
        </button>
      </div>
    </Modal>
  );
}