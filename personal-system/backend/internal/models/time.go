package models

import "time"

type TimeCategory string

const (
	CategoryDeepWork    TimeCategory = "deep_work"
	CategoryMaintenance TimeCategory = "maintenance"
	CategoryLearning    TimeCategory = "learning"
	CategoryAdmin       TimeCategory = "admin"
	CategoryHealth      TimeCategory = "health"
)

type TimeSession struct {
	ID              string       `json:"id"`
	TaskID          *string      `json:"task_id,omitempty"`
	TaskTitle       string       `json:"task_title"`
	Project         string       `json:"project"`
	Category        TimeCategory `json:"category"`
	StartedAt       time.Time    `json:"started_at"`
	EndedAt         *time.Time   `json:"ended_at,omitempty"`
	DurationSeconds int64        `json:"duration_seconds"`
	Notes           string       `json:"notes"`
	Tags            []string     `json:"tags"`
}

type ActiveTimer struct {
	TaskID    *string      `json:"task_id,omitempty"`
	TaskTitle string       `json:"task_title"`
	Project   string       `json:"project"`
	Category  TimeCategory `json:"category"`
	StartedAt time.Time    `json:"started_at"`
	IsRunning bool         `json:"is_running"`
}

type TimeBlock struct {
	ID        string       `json:"id"`
	Title     string       `json:"title"`
	StartTime time.Time    `json:"start_time"`
	EndTime   time.Time    `json:"end_time"`
	Category  TimeCategory `json:"category"`
	Color     string       `json:"color"`
	Completed bool         `json:"completed"`
}

type TimeStats struct {
	TodaySeconds    int64            `json:"today_seconds"`
	ThisWeekSeconds int64            `json:"this_week_seconds"`
	ByCategory      map[string]int64 `json:"by_category"`
	ByProject       map[string]int64 `json:"by_project"`
}
