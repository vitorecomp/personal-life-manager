package handlers

import (
	"net/http"

	"personal-system/backend/internal/services"
)

func RegisterRoutes(
	mux *http.ServeMux,
	taskSvc *services.TaskService,
	timeSvc *services.TimeService,
	serverSvc *services.ServerService,
) {
	taskH := NewTaskHandler(taskSvc)
	timeH := NewTimeHandler(timeSvc)
	serverH := NewServerHandler(serverSvc)

	// System Health
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "healthy",
			"service": "personal-system-backend",
			"version": "1.0.0",
		})
	})

	// Tasks
	mux.HandleFunc("GET /api/tasks", taskH.ListTasks)
	mux.HandleFunc("POST /api/tasks", taskH.CreateTask)
	mux.HandleFunc("GET /api/tasks/{id}", taskH.GetTask)
	mux.HandleFunc("PUT /api/tasks/{id}", taskH.UpdateTask)
	mux.HandleFunc("DELETE /api/tasks/{id}", taskH.DeleteTask)

	// Time
	mux.HandleFunc("GET /api/time/timer", timeH.GetActiveTimer)
	mux.HandleFunc("POST /api/time/timer/start", timeH.StartTimer)
	mux.HandleFunc("POST /api/time/timer/stop", timeH.StopTimer)
	mux.HandleFunc("POST /api/time/timer/discard", timeH.DiscardTimer)
	mux.HandleFunc("GET /api/time/sessions", timeH.ListSessions)
	mux.HandleFunc("GET /api/time/blocks", timeH.ListBlocks)
	mux.HandleFunc("POST /api/time/blocks", timeH.CreateBlock)
	mux.HandleFunc("DELETE /api/time/blocks/{id}", timeH.DeleteBlock)
	mux.HandleFunc("GET /api/time/stats", timeH.GetStats)

	// Servers
	mux.HandleFunc("GET /api/servers", serverH.ListServers)
	mux.HandleFunc("POST /api/servers", serverH.CreateServer)
	mux.HandleFunc("GET /api/servers/{id}", serverH.GetServer)
	mux.HandleFunc("PUT /api/servers/{id}", serverH.UpdateServer)
	mux.HandleFunc("DELETE /api/servers/{id}", serverH.DeleteServer)
	mux.HandleFunc("POST /api/servers/{id}/check", serverH.CheckServer)
	mux.HandleFunc("GET /api/servers/summary", serverH.GetSummary)
}
