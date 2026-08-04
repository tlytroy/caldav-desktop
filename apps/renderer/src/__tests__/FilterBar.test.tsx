import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "../components/ui/FilterBar";
import { useCalendarStore } from "../store/calendarStore";

describe("FilterBar", () => {
  const mockOnFilterChange = vi.fn();

  beforeEach(() => {
    mockOnFilterChange.mockClear();
    useCalendarStore.setState({
      categories: [
        { id: "1", name: "工作", color: "#3b82f6" },
        { id: "2", name: "个人", color: "#10b981" },
      ],
      tags: [
        { id: "1", name: "重要", color: "#ef4444" },
        { id: "2", name: "紧急", color: "#f97316" },
      ],
      eventFilter: {},
    });
  });

  it("should render search input", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    expect(
      screen.getByPlaceholderText("搜索事件..."),
    ).toBeInTheDocument();
  });

  it("should render category buttons", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    expect(screen.getByText("工作")).toBeInTheDocument();
    expect(screen.getByText("个人")).toBeInTheDocument();
  });

  it("should render tag buttons", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    expect(screen.getByText("重要")).toBeInTheDocument();
    expect(screen.getByText("紧急")).toBeInTheDocument();
  });

  it("should call onFilterChange with search text when typing", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    const input = screen.getByPlaceholderText("搜索事件...");
    fireEvent.change(input, { target: { value: "meeting" } });
    expect(mockOnFilterChange).toHaveBeenCalledWith({
      searchText: "meeting",
    });
  });

  it("should call onFilterChange with categoryId when clicking category", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    fireEvent.click(screen.getByText("工作"));
    expect(mockOnFilterChange).toHaveBeenCalledWith({
      categoryId: "1",
    });
  });

  it("should toggle category off when clicking active category", () => {
    useCalendarStore.setState({ eventFilter: { categoryId: "1" } });
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    fireEvent.click(screen.getByText("工作"));
    expect(mockOnFilterChange).toHaveBeenCalledWith({});
  });

  it("should call onFilterChange with tagIds when toggling tag", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    fireEvent.click(screen.getByText("重要"));
    expect(mockOnFilterChange).toHaveBeenCalledWith({
      tagIds: ["1"],
    });
  });

  it("should remove tag from filter when toggling active tag", () => {
    useCalendarStore.setState({ eventFilter: { tagIds: ["1", "2"] } });
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    fireEvent.click(screen.getByText("重要"));
    expect(mockOnFilterChange).toHaveBeenCalledWith({
      tagIds: ["2"],
    });
  });

  it("should show clear filters button when filters are active", () => {
    useCalendarStore.setState({
      eventFilter: { searchText: "test", categoryId: "1" },
    });
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    expect(screen.getByText("清除所有过滤器")).toBeInTheDocument();
  });

  it("should not show clear filters button when no filters active", () => {
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    expect(screen.queryByText("清除所有过滤器")).not.toBeInTheDocument();
  });

  it("should clear all filters when clicking clear button", () => {
    useCalendarStore.setState({
      eventFilter: { searchText: "test", categoryId: "1" },
    });
    render(<FilterBar onFilterChange={mockOnFilterChange} />);
    fireEvent.click(screen.getByText("清除所有过滤器"));
    expect(mockOnFilterChange).toHaveBeenCalledWith({});
  });
});