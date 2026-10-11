package services

import (
	"errors"
	"strings"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/storage"
)

type TimeService struct {
	store storage.Store
}

func NewTimeService(store storage.Store) *TimeService {
	return &TimeService{store: store}
}

func (s *TimeService) GetActiveTimer() (*models.ActiveTimer, error) {
	return s.store.GetActiveTimer()
}

func (s *TimeService) StartTimer(timer *models.ActiveTimer) error {
	timer.TaskTitle = strings.TrimSpace(timer.TaskTitle)
	if timer.TaskTitle == "" {
		timer.TaskTitle = "Unassigned Focus Session"
	}
	if timer.Category == "" {
		timer.Category = models.CategoryDeepWork
	}
	if timer.Project == "" {
		timer.Project = "General"
	}
	return s.store.StartTimer(timer)
}

func (s *TimeService) StopTimer(notes string) (*models.TimeSession, error) {
	return s.store.StopTimer(notes)
}

func (s *TimeService) DiscardTimer() error {
	return s.store.DiscardTimer()
}

func (s *TimeService) ListSessions(limit int) ([]models.TimeSession, error) {
	return s.store.ListSessions(limit)
}

func (s *TimeService) CreateBlock(block *models.TimeBlock) error {
	block.Title = strings.TrimSpace(block.Title)
	if block.Title == "" {
		return errors.New("time block title is required")
	}
	if block.Category == "" {
		block.Category = models.CategoryDeepWork
	}
	return s.store.CreateBlock(block)
}

func (s *TimeService) ListBlocks() ([]models.TimeBlock, error) {
	return s.store.ListBlocks()
}

func (s *TimeService) DeleteBlock(id string) error {
	return s.store.DeleteBlock(id)
}

func (s *TimeService) GetStats() (*models.TimeStats, error) {
	return s.store.GetTimeStats()
}
