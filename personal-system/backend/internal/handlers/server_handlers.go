package handlers

import (
	"net/http"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/services"
)

type ServerHandler struct {
	service *services.ServerService
}

func NewServerHandler(service *services.ServerService) *ServerHandler {
	return &ServerHandler{service: service}
}

func (h *ServerHandler) ListServers(w http.ResponseWriter, r *http.Request) {
	servers, err := h.service.ListServers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, servers)
}

func (h *ServerHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	var server models.ServerNode
	if err := readJSON(r, &server); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if server.Name == "" || server.Host == "" {
		writeError(w, http.StatusBadRequest, "Server name and host are required")
		return
	}
	if server.Port <= 0 {
		server.Port = 22
	}
	if server.CheckType == "" {
		server.CheckType = models.CheckTypeTCP
	}

	if err := h.service.CreateServer(&server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, server)
}

func (h *ServerHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	server, err := h.service.GetServer(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, server)
}

func (h *ServerHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var server models.ServerNode
	if err := readJSON(r, &server); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}
	server.ID = id

	if err := h.service.UpdateServer(&server); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, server)
}

func (h *ServerHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.service.DeleteServer(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Server deleted successfully"})
}

func (h *ServerHandler) CheckServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	server, err := h.service.CheckNow(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, server)
}

func (h *ServerHandler) GetSummary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.service.GetSummary()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
