package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"personal-system/backend/internal/models"
)

type fileData struct {
	Tasks       map[string]models.Task       `json:"tasks"`
	Sessions    []models.TimeSession         `json:"sessions"`
	ActiveTimer *models.ActiveTimer          `json:"active_timer,omitempty"`
	Blocks      map[string]models.TimeBlock  `json:"blocks"`
	Servers     map[string]models.ServerNode `json:"servers"`
}

type FileStore struct {
	mu       sync.RWMutex
	filePath string
	data     fileData
}

func NewFileStore(filePath string) (*FileStore, error) {
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory for store: %w", err)
	}

	fs := &FileStore{
		filePath: filePath,
		data: fileData{
			Tasks:    make(map[string]models.Task),
			Sessions: make([]models.TimeSession, 0),
			Blocks:   make(map[string]models.TimeBlock),
			Servers:  make(map[string]models.ServerNode),
		},
	}

	if err := fs.load(); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fs.seedInitialData()
			if err := fs.save(); err != nil {
				return nil, fmt.Errorf("failed to save initial seed data: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to load store data: %w", err)
		}
	}

	return fs, nil
}

func (fs *FileStore) load() error {
	bytes, err := os.ReadFile(fs.filePath)
	if err != nil {
		return err
	}

	var data fileData
	if err := json.Unmarshal(bytes, &data); err != nil {
		return err
	}

	if data.Tasks == nil {
		data.Tasks = make(map[string]models.Task)
	}
	if data.Sessions == nil {
		data.Sessions = make([]models.TimeSession, 0)
	}
	if data.Blocks == nil {
		data.Blocks = make(map[string]models.TimeBlock)
	}
	if data.Servers == nil {
		data.Servers = make(map[string]models.ServerNode)
	}

	fs.data = data
	return nil
}

func (fs *FileStore) save() error {
	bytes, err := json.MarshalIndent(fs.data, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := fs.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, bytes, 0644); err != nil {
		return err
	}

	return os.Rename(tmpFile, fs.filePath)
}

func (fs *FileStore) seedInitialData() {
	now := time.Now()

	// Initial Tasks
	task1 := models.Task{
		ID:               "task-1",
		Title:            "Configure Obsidian Second Brain Synchronization",
		Description:      "Run ./scripts/download_brain.sh and connect private vault to database/",
		Status:           models.TaskStatusInProgress,
		Priority:         models.TaskPriorityHigh,
		Project:          "Second Brain",
		Tags:             []string{"setup", "obsidian", "automation"},
		EstimatedMinutes: 30,
		CreatedAt:        now.Add(-2 * time.Hour),
		UpdatedAt:        now,
	}

	task2 := models.Task{
		ID:               "task-2",
		Title:            "Build Personal System Next.js Dashboard",
		Description:      "Connect frontend UI to Golang backend for time, tasks, and servers",
		Status:           models.TaskStatusTodo,
		Priority:         models.TaskPriorityUrgent,
		Project:          "Personal System",
		Tags:             []string{"frontend", "nextjs", "ui"},
		EstimatedMinutes: 90,
		CreatedAt:        now.Add(-1 * time.Hour),
		UpdatedAt:        now,
	}

	task3 := models.Task{
		ID:               "task-3",
		Title:            "Scaffold Second Brain Core Architecture",
		Description:      "Set up crawlers, hermes, infra-deploy, and root README",
		Status:           models.TaskStatusDone,
		Priority:         models.TaskPriorityHigh,
		Project:          "Second Brain",
		Tags:             []string{"architecture", "done"},
		EstimatedMinutes: 45,
		CreatedAt:        now.Add(-5 * time.Hour),
		UpdatedAt:        now.Add(-3 * time.Hour),
	}

	fs.data.Tasks[task1.ID] = task1
	fs.data.Tasks[task2.ID] = task2
	fs.data.Tasks[task3.ID] = task3

	// Initial Server
	server1 := models.ServerNode{
		ID:            "srv-localhost",
		Name:          "Local Development Host",
		Host:          "127.0.0.1",
		Port:          8080,
		CheckType:     models.CheckTypeTCP,
		Status:        models.ServerStatusOnline,
		LastLatencyMs: 1,
		LastMessage:   "Initialized",
		Tags:          []string{"local", "dev"},
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	server2 := models.ServerNode{
		ID:            "srv-postgres",
		Name:          "Infra PostgreSQL Service",
		Host:          "127.0.0.1",
		Port:          5432,
		CheckType:     models.CheckTypeTCP,
		Status:        models.ServerStatusUnknown,
		LastLatencyMs: 0,
		LastMessage:   "Pending first probe",
		Tags:          []string{"database", "infra"},
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	fs.data.Servers[server1.ID] = server1
	fs.data.Servers[server2.ID] = server2

	// Initial Time Session
	ended := now.Add(-3 * time.Hour)
	task3ID := task3.ID
	fs.data.Sessions = append(fs.data.Sessions, models.TimeSession{
		ID:              "sess-1",
		TaskID:          &task3ID,
		TaskTitle:       task3.Title,
		Project:         "Second Brain",
		Category:        models.CategoryDeepWork,
		StartedAt:       now.Add(-4 * time.Hour),
		EndedAt:         &ended,
		DurationSeconds: 3600,
		Notes:           "Completed repository restructuring and git migration",
		Tags:            []string{"architecture"},
	})
}

// ----------------- Tasks -----------------

func (fs *FileStore) CreateTask(task *models.Task) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if task.ID == "" {
		task.ID = fmt.Sprintf("task-%d", time.Now().UnixNano())
	}
	now := time.Now()
	task.CreatedAt = now
	task.UpdatedAt = now

	fs.data.Tasks[task.ID] = *task
	return fs.save()
}

func (fs *FileStore) GetTask(id string) (*models.Task, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	task, exists := fs.data.Tasks[id]
	if !exists {
		return nil, fmt.Errorf("task not found: %s", id)
	}
	return &task, nil
}

func (fs *FileStore) ListTasks(filter models.TaskFilter) ([]models.Task, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	var result []models.Task
	for _, task := range fs.data.Tasks {
		if filter.Status != nil && task.Status != *filter.Status {
			continue
		}
		if filter.Priority != nil && task.Priority != *filter.Priority {
			continue
		}
		if filter.Project != nil && !strings.EqualFold(task.Project, *filter.Project) {
			continue
		}
		if filter.Search != nil && *filter.Search != "" {
			term := strings.ToLower(*filter.Search)
			if !strings.Contains(strings.ToLower(task.Title), term) &&
				!strings.Contains(strings.ToLower(task.Description), term) {
				continue
			}
		}
		result = append(result, task)
	}

	return result, nil
}

func (fs *FileStore) UpdateTask(task *models.Task) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	existing, exists := fs.data.Tasks[task.ID]
	if !exists {
		return fmt.Errorf("task not found: %s", task.ID)
	}

	task.CreatedAt = existing.CreatedAt
	task.UpdatedAt = time.Now()

	fs.data.Tasks[task.ID] = *task
	return fs.save()
}

func (fs *FileStore) DeleteTask(id string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if _, exists := fs.data.Tasks[id]; !exists {
		return fmt.Errorf("task not found: %s", id)
	}

	delete(fs.data.Tasks, id)
	return fs.save()
}

// ----------------- Time -----------------

func (fs *FileStore) GetActiveTimer() (*models.ActiveTimer, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	return fs.data.ActiveTimer, nil
}

func (fs *FileStore) StartTimer(timer *models.ActiveTimer) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	timer.StartedAt = time.Now()
	timer.IsRunning = true
	fs.data.ActiveTimer = timer

	return fs.save()
}

func (fs *FileStore) StopTimer(notes string) (*models.TimeSession, error) {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if fs.data.ActiveTimer == nil || !fs.data.ActiveTimer.IsRunning {
		return nil, errors.New("no active timer is currently running")
	}

	now := time.Now()
	timer := fs.data.ActiveTimer
	duration := int64(now.Sub(timer.StartedAt).Seconds())

	session := models.TimeSession{
		ID:              fmt.Sprintf("sess-%d", now.UnixNano()),
		TaskID:          timer.TaskID,
		TaskTitle:       timer.TaskTitle,
		Project:         timer.Project,
		Category:        timer.Category,
		StartedAt:       timer.StartedAt,
		EndedAt:         &now,
		DurationSeconds: duration,
		Notes:           notes,
	}

	fs.data.Sessions = append([]models.TimeSession{session}, fs.data.Sessions...)
	fs.data.ActiveTimer = nil

	if err := fs.save(); err != nil {
		return nil, err
	}

	return &session, nil
}

func (fs *FileStore) DiscardTimer() error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	fs.data.ActiveTimer = nil
	return fs.save()
}

func (fs *FileStore) ListSessions(limit int) ([]models.TimeSession, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	if limit <= 0 || limit > len(fs.data.Sessions) {
		limit = len(fs.data.Sessions)
	}

	result := make([]models.TimeSession, limit)
	copy(result, fs.data.Sessions[:limit])
	return result, nil
}

func (fs *FileStore) CreateBlock(block *models.TimeBlock) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if block.ID == "" {
		block.ID = fmt.Sprintf("block-%d", time.Now().UnixNano())
	}
	fs.data.Blocks[block.ID] = *block
	return fs.save()
}

func (fs *FileStore) ListBlocks() ([]models.TimeBlock, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	var blocks []models.TimeBlock
	for _, b := range fs.data.Blocks {
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (fs *FileStore) DeleteBlock(id string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if _, exists := fs.data.Blocks[id]; !exists {
		return fmt.Errorf("block not found: %s", id)
	}
	delete(fs.data.Blocks, id)
	return fs.save()
}

func (fs *FileStore) GetTimeStats() (*models.TimeStats, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startOfWeek := startOfDay.AddDate(0, 0, -int(now.Weekday()))

	stats := &models.TimeStats{
		ByCategory: make(map[string]int64),
		ByProject:  make(map[string]int64),
	}

	for _, s := range fs.data.Sessions {
		if s.StartedAt.After(startOfDay) {
			stats.TodaySeconds += s.DurationSeconds
		}
		if s.StartedAt.After(startOfWeek) {
			stats.ThisWeekSeconds += s.DurationSeconds
		}
		stats.ByCategory[string(s.Category)] += s.DurationSeconds
		if s.Project != "" {
			stats.ByProject[s.Project] += s.DurationSeconds
		}
	}

	return stats, nil
}

// ----------------- Servers -----------------

func (fs *FileStore) CreateServer(server *models.ServerNode) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if server.ID == "" {
		server.ID = fmt.Sprintf("srv-%d", time.Now().UnixNano())
	}
	now := time.Now()
	server.CreatedAt = now
	server.UpdatedAt = now
	server.Status = models.ServerStatusUnknown

	fs.data.Servers[server.ID] = *server
	return fs.save()
}

func (fs *FileStore) GetServer(id string) (*models.ServerNode, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	server, exists := fs.data.Servers[id]
	if !exists {
		return nil, fmt.Errorf("server not found: %s", id)
	}
	return &server, nil
}

func (fs *FileStore) ListServers() ([]models.ServerNode, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	var result []models.ServerNode
	for _, s := range fs.data.Servers {
		result = append(result, s)
	}
	return result, nil
}

func (fs *FileStore) UpdateServer(server *models.ServerNode) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	existing, exists := fs.data.Servers[server.ID]
	if !exists {
		return fmt.Errorf("server not found: %s", server.ID)
	}

	server.CreatedAt = existing.CreatedAt
	server.UpdatedAt = time.Now()

	fs.data.Servers[server.ID] = *server
	return fs.save()
}

func (fs *FileStore) DeleteServer(id string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	if _, exists := fs.data.Servers[id]; !exists {
		return fmt.Errorf("server not found: %s", id)
	}

	delete(fs.data.Servers, id)
	return fs.save()
}

func (fs *FileStore) UpdateServerStatus(id string, status models.ServerStatus, latencyMs int64, msg string) error {
	fs.mu.Lock()
	defer fs.mu.Unlock()

	server, exists := fs.data.Servers[id]
	if !exists {
		return fmt.Errorf("server not found: %s", id)
	}

	now := time.Now()
	server.Status = status
	server.LastLatencyMs = latencyMs
	server.LastMessage = msg
	server.LastCheckedAt = &now
	server.UpdatedAt = now

	fs.data.Servers[id] = server
	return fs.save()
}

func (fs *FileStore) GetServerSummary() (*models.ServerSummary, error) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()

	summary := &models.ServerSummary{
		TotalServers: len(fs.data.Servers),
	}

	for _, s := range fs.data.Servers {
		switch s.Status {
		case models.ServerStatusOnline:
			summary.Online++
		case models.ServerStatusDegraded:
			summary.Degraded++
		case models.ServerStatusOffline:
			summary.Offline++
		default:
			summary.Unknown++
		}
	}

	return summary, nil
}
