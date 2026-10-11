package services_test

import (
	"testing"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/services"
	"personal-system/backend/internal/storage"
)

func TestTaskService(t *testing.T) {
	tempFile := t.TempDir() + "/test_store.json"
	store, err := storage.NewFileStore(tempFile)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	svc := services.NewTaskService(store)

	task := &models.Task{
		Title:    "Test Task",
		Status:   models.TaskStatusTodo,
		Priority: models.TaskPriorityHigh,
	}

	if err := svc.CreateTask(task); err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	if task.ID == "" {
		t.Fatal("expected generated task ID, got empty")
	}

	retrieved, err := svc.GetTask(task.ID)
	if err != nil {
		t.Fatalf("failed to get task: %v", err)
	}

	if retrieved.Title != "Test Task" {
		t.Fatalf("expected title 'Test Task', got '%s'", retrieved.Title)
	}
}
