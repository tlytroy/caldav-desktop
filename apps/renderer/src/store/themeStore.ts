import { create } from "zustand";
import { persist } from "zustand/middleware";

// 定义配色方案类型
export interface ColorScheme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
}

// 莫兰迪配色方案
export const morandiSchemes: Record<string, ColorScheme> = {
  classic: {
    name: "经典莫兰迪",
    primary: "#8d9ba8",
    secondary: "#a89d8d",
    accent: "#9da88d",
    neutral: "#c5c5c5"
  },
  earth: {
    name: "大地棕褐",
    primary: "#a89d8d",
    secondary: "#8d9ba8",
    accent: "#9da88d",
    neutral: "#b8a99a"
  },
  blueGreen: {
    name: "清新蓝绿",
    primary: "#8da89d",
    secondary: "#9da88d",
    accent: "#8d9ba8",
    neutral: "#a9b8aa"
  },
  purpleGray: {
    name: "优雅紫灰",
    primary: "#9d8da8",
    secondary: "#a88d9b",
    accent: "#8d9ba8",
    neutral: "#b1a9b8"
  }
};

interface ThemeState {
  isDarkMode: boolean;
  colorScheme: string; // 当前配色方案的key
  customColors: Partial<ColorScheme> | null; // 自定义颜色
  borderRadius: string; // 统一圆角大小
  toggleTheme: () => void;
  setTheme: (isDark: boolean) => void;
  setColorScheme: (scheme: string) => void;
  setCustomColors: (colors: Partial<ColorScheme> | null) => void;
  setBorderRadius: (radius: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDarkMode: false,
      colorScheme: "classic",
      customColors: null,
      borderRadius: "rounded-lg", // 默认圆角
      toggleTheme: () => set((state) => ({ isDarkMode: !state.isDarkMode })),
      setTheme: (isDark) => set({ isDarkMode: isDark }),
      setColorScheme: (scheme) => set({ colorScheme: scheme, customColors: null }),
      setCustomColors: (colors) => set({ customColors: colors }),
      setBorderRadius: (radius) => set({ borderRadius: radius }),
    }),
    {
      name: "theme-storage", // 存储在localStorage中的key
    }
  )
);

// 获取当前配色方案
export const getCurrentColorScheme = (state: ThemeState): ColorScheme => {
  if (state.customColors) {
    return {
      name: "自定义",
      primary: state.customColors.primary || morandiSchemes[state.colorScheme].primary,
      secondary: state.customColors.secondary || morandiSchemes[state.colorScheme].secondary,
      accent: state.customColors.accent || morandiSchemes[state.colorScheme].accent,
      neutral: state.customColors.neutral || morandiSchemes[state.colorScheme].neutral,
    };
  }
  return morandiSchemes[state.colorScheme];
};
