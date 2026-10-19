import { useEffect } from "react";
import { useThemeStore, getCurrentColors } from "../store/themeStore";

/**
 * ThemeApplier - 响应式主题应用器
 *
 * 监听 themeStore 变化，把「暗色模式」与「莫兰迪配色」实时写到 <html> 上：
 * - 暗色：切换 document.documentElement 的 `.dark` class（之前只在首屏初始化时设置，
 *   运行时切换开关不会更新 DOM，导致暗黑模式按钮“点了没反应”）
 * - 配色：把当前方案的 primary/secondary/accent/neutral 写入 CSS 变量，
 *   供 index.css 里 `@theme inline` 映射的 bg-brand / text-brand-accent 等工具类引用，
 *   （之前只设置变量但组件从不引用，导致换配色肉眼无变化）
 * - 圆角：把存储的圆角方案映射为 px 写入 --radius，供需要动态圆角的组件引用
 */
const RADIUS_PX: Record<string, string> = {
  "rounded-none": "0px",
  "rounded-sm": "4px",
  "rounded": "8px",
  "rounded-lg": "12px",
  "rounded-xl": "16px",
  "rounded-2xl": "20px",
};

export function ThemeApplier() {
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const customColors = useThemeStore((s) => s.customColors);
  const borderRadius = useThemeStore((s) => s.borderRadius);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDarkMode);

    const colors = getCurrentColors(useThemeStore.getState());
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.style.setProperty("--radius", RADIUS_PX[borderRadius] || "12px");
  }, [isDarkMode, colorScheme, customColors, borderRadius]);

  return null;
}
