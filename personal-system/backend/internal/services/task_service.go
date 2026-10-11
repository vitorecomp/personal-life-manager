package services

import (
	"errors"
	"strings"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/storage"
)

type TaskService struct {
	store storage.Store
}

func NewTaskService(store storage.Store) *TaskService {
	return &TaskService{store: store}
}

func (s *TaskService) CreateTask(task *models.Task) error {
	task.Title = strings.TrimSpace(task.Title)
	if task.Title == "" {
		return errors.New("task title is required")
	}

	if task.Status == "" {
		task.Status = models.TaskStatusTodo
	}
	if task.Priority == "" {
		task.Priority = models.TaskPriorityMedium
	}
	if task.Project == "" {
		task.Project = "General"
	}

	return s.store.CreateTask(task)
}

func (s *TaskService) GetTask(id string) (*models.Task, error) {
	return s.store.GetTask(id)
}

func (s *TaskService) ListTasks(filter models.TaskFilter) ([]models.Task, error) {
	return s.store.ListTasks(filter)
}

func (s *TaskService) UpdateTask(task *models.Task) error {
	task.Title = strings.TrimSpace(task.Title)
	if task.Title == "" {
		return errors.New("task title cannot be empty")
	}
	return s.store.UpdateTask(task)
}

func (s *TaskService) DeleteTask(id string) error {
	return s.store.DeleteTask(id)
}
