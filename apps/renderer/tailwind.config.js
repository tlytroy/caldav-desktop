export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class", // 启用基于class的暗色模式
  theme: {
    extend: {
      colors: {
        // 使用CSS变量的主题颜色
        primary: {
          DEFAULT: "var(--color-primary, #8d9ba8)",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `${(i + 1) * 100}`,
              `var(--color-primary, #8d9ba8)`
            ])
          )
        },
        secondary: {
          DEFAULT: "var(--color-secondary, #a89d8d)",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `${(i + 1) * 100}`,
              `var(--color-secondary, #a89d8d)`
            ])
          )
        },
        accent: {
          DEFAULT: "var(--color-accent, #9da88d)",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `${(i + 1) * 100}`,
              `var(--color-accent, #9da88d)`
            ])
          )
        },
        neutral: {
          DEFAULT: "var(--color-neutral, #c5c5c5)",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              `${(i + 1) * 100}`,
              `var(--color-neutral, #c5c5c5)`
            ])
          )
        },
        // 主色调 - 用于主要按钮和链接
        blue: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // 次要色调 - 用于次要按钮和辅助元素
        sky: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        // 成功色调 - 用于成功状态和确认操作
        green: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
        // 警告色调 - 用于警告状态
        amber: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        // 错误色调 - 用于错误状态和危险操作
        red: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
        },
        // 中性色调 - 用于文本、边框和背景
        gray: {
          50: "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
        },
        // 莫兰迪配色方案（保留用于预览）
        morandi: {
          primary: "#8d9ba8",
          secondary: "#a89d8d",
          accent: "#9da88d",
          neutral: "#c5c5c5",
          earth: {
            primary: "#a89d8d",
            secondary: "#8d9ba8",
            accent: "#9da88d",
            neutral: "#b8a99a"
          },
          blueGreen: {
            primary: "#8da89d",
            secondary: "#9da88d",
            accent: "#8d9ba8",
            neutral: "#a9b8aa"
          },
          purpleGray: {
            primary: "#9d8da8",
            secondary: "#a88d9b",
            accent: "#8d9ba8",
            neutral: "#b1a9b8"
          }
        }
      },
      borderRadius: {
        'none': '0',
        'sm': '0.125rem',
        'DEFAULT': '0.25rem',
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        'full': '9999px',
      }
    },
  },
  plugins: [],
};
