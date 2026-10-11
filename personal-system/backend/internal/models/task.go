package models

import "time"

type TaskStatus string

const (
	TaskStatusBacklog    TaskStatus = "backlog"
	TaskStatusTodo       TaskStatus = "todo"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusReview     TaskStatus = "review"
	TaskStatusDone       TaskStatus = "done"
)

type TaskPriority string

const (
	TaskPriorityLow    TaskPriority = "low"
	TaskPriorityMedium TaskPriority = "medium"
	TaskPriorityHigh   TaskPriority = "high"
	TaskPriorityUrgent TaskPriority = "urgent"
)

type Task struct {
	ID               string       `json:"id"`
	Title            string       `json:"title"`
	Description      string       `json:"description"`
	Status           TaskStatus   `json:"status"`
	Priority         TaskPriority `json:"priority"`
	Project          string       `json:"project"`
	Tags             []string     `json:"tags"`
	DueDate          *time.Time   `json:"due_date,omitempty"`
	EstimatedMinutes int          `json:"estimated_minutes"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

type TaskFilter struct {
	Status   *TaskStatus   `json:"status,omitempty"`
	Priority *TaskPriority `json:"priority,omitempty"`
	Project  *string       `json:"project,omitempty"`
	Search   *string       `json:"search,omitempty"`
}
