package storage

import "personal-system/backend/internal/models"

type Store interface {
	// Tasks
	CreateTask(task *models.Task) error
	GetTask(id string) (*models.Task, error)
	ListTasks(filter models.TaskFilter) ([]models.Task, error)
	UpdateTask(task *models.Task) error
	DeleteTask(id string) error

	// Time
	GetActiveTimer() (*models.ActiveTimer, error)
	StartTimer(timer *models.ActiveTimer) error
	StopTimer(notes string) (*models.TimeSession, error)
	DiscardTimer() error
	ListSessions(limit int) ([]models.TimeSession, error)
	CreateBlock(block *models.TimeBlock) error
	ListBlocks() ([]models.TimeBlock, error)
	DeleteBlock(id string) error
	GetTimeStats() (*models.TimeStats, error)

	// Servers
	CreateServer(server *models.ServerNode) error
	GetServer(id string) (*models.ServerNode, error)
	ListServers() ([]models.ServerNode, error)
	UpdateServer(server *models.ServerNode) error
	DeleteServer(id string) error
	UpdateServerStatus(id string, status models.ServerStatus, latencyMs int64, msg string) error
	GetServerSummary() (*models.ServerSummary, error)
}
