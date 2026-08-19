import React from "react";

export type ModuleStatus = "active" | "placeholder";

export interface RouteConfig {
  path: string;
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  title?: string;
  icon?: React.ReactNode;
  showInNav?: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  status?: ModuleStatus;
}

export interface CalendarModule {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: React.ReactNode;
  status: ModuleStatus;
  order?: number;

  // active 状态时使用
  component?: React.LazyExoticComponent<React.ComponentType<any>>;

  // placeholder 状态时使用
  placeholder?: {
    title: string;
    description: string;
    plannedVersion: string;
    eta?: string;
  };

  // 路由配置
  routes: RouteConfig[];

  // 导航配置
  navItems: NavItem[];

  // 初始化函数（可选）
  onInit?: () => void | Promise<void>;
}
