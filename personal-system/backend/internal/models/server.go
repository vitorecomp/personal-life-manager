package models

import "time"

type ServerStatus string

const (
	ServerStatusOnline   ServerStatus = "online"
	ServerStatusDegraded ServerStatus = "degraded"
	ServerStatusOffline  ServerStatus = "offline"
	ServerStatusUnknown  ServerStatus = "unknown"
)

type CheckType string

const (
	CheckTypeTCP  CheckType = "tcp"
	CheckTypeHTTP CheckType = "http"
)

type ServerNode struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Host          string       `json:"host"`
	Port          int          `json:"port"`
	CheckType     CheckType    `json:"check_type"`
	HTTPUrl       string       `json:"http_url,omitempty"`
	Status        ServerStatus `json:"status"`
	LastCheckedAt *time.Time   `json:"last_checked_at,omitempty"`
	LastLatencyMs int64        `json:"last_latency_ms"`
	LastMessage   string       `json:"last_message,omitempty"`
	Tags          []string     `json:"tags"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

type ServerSummary struct {
	TotalServers int `json:"total_servers"`
	Online       int `json:"online"`
	Degraded     int `json:"degraded"`
	Offline      int `json:"offline"`
	Unknown      int `json:"unknown"`
}
