package services

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/storage"
)

type ServerService struct {
	store    storage.Store
	interval time.Duration
	client   *http.Client
}

func NewServerService(store storage.Store, intervalSeconds int) *ServerService {
	return &ServerService{
		store:    store,
		interval: time.Duration(intervalSeconds) * time.Second,
		client: &http.Client{
			Timeout: 4 * time.Second,
		},
	}
}

func (s *ServerService) StartBackgroundProber(ctx context.Context) {
	go func() {
		log.Printf("[ServerService] Background server health prober started (interval: %v)", s.interval)
		// Run initial check immediately
		s.ProbeAll(ctx)

		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("[ServerService] Background server health prober stopped")
				return
			case <-ticker.C:
				s.ProbeAll(ctx)
			}
		}
	}()
}

func (s *ServerService) ProbeAll(ctx context.Context) {
	servers, err := s.store.ListServers()
	if err != nil {
		log.Printf("[ServerService] Error listing servers for probe: %v", err)
		return
	}

	var wg sync.WaitGroup
	for _, srv := range servers {
		wg.Add(1)
		go func(node models.ServerNode) {
			defer wg.Done()
			s.probeSingle(node)
		}(srv)
	}
	wg.Wait()
}

func (s *ServerService) CheckNow(id string) (*models.ServerNode, error) {
	srv, err := s.store.GetServer(id)
	if err != nil {
		return nil, err
	}

	s.probeSingle(*srv)
	return s.store.GetServer(id)
}

func (s *ServerService) probeSingle(node models.ServerNode) {
	start := time.Now()
	var status models.ServerStatus
	var message string

	switch node.CheckType {
	case models.CheckTypeHTTP:
		url := node.HTTPUrl
		if url == "" {
			url = fmt.Sprintf("http://%s:%d", node.Host, node.Port)
		}
		resp, err := s.client.Get(url)
		if err != nil {
			status = models.ServerStatusOffline
			message = fmt.Sprintf("HTTP probe failed: %v", err)
		} else {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 400 {
				status = models.ServerStatusOnline
				message = fmt.Sprintf("HTTP %d OK", resp.StatusCode)
			} else {
				status = models.ServerStatusDegraded
				message = fmt.Sprintf("HTTP error status: %d", resp.StatusCode)
			}
		}

	case models.CheckTypeTCP:
		fallthrough
	default:
		addr := net.JoinHostPort(node.Host, fmt.Sprintf("%d", node.Port))
		conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
		if err != nil {
			status = models.ServerStatusOffline
			message = fmt.Sprintf("TCP connect failed: %v", err)
		} else {
			conn.Close()
			status = models.ServerStatusOnline
			message = "TCP connection accepted"
		}
	}

	latency := time.Since(start).Milliseconds()
	if err := s.store.UpdateServerStatus(node.ID, status, latency, message); err != nil {
		log.Printf("[ServerService] Failed updating status for server %s: %v", node.ID, err)
	}
}

func (s *ServerService) ListServers() ([]models.ServerNode, error) {
	return s.store.ListServers()
}

func (s *ServerService) GetServer(id string) (*models.ServerNode, error) {
	return s.store.GetServer(id)
}

func (s *ServerService) CreateServer(server *models.ServerNode) error {
	return s.store.CreateServer(server)
}

func (s *ServerService) UpdateServer(server *models.ServerNode) error {
	return s.store.UpdateServer(server)
}

func (s *ServerService) DeleteServer(id string) error {
	return s.store.DeleteServer(id)
}

func (s *ServerService) GetSummary() (*models.ServerSummary, error) {
	return s.store.GetServerSummary()
}
