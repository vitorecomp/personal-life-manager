package handlers

import (
	"net/http"
	"strconv"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/services"
)

type TimeHandler struct {
	service *services.TimeService
}

func NewTimeHandler(service *services.TimeService) *TimeHandler {
	return &TimeHandler{service: service}
}

func (h *TimeHandler) GetActiveTimer(w http.ResponseWriter, r *http.Request) {
	timer, err := h.service.GetActiveTimer()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, timer)
}

func (h *TimeHandler) StartTimer(w http.ResponseWriter, r *http.Request) {
	var timer models.ActiveTimer
	if err := readJSON(r, &timer); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if err := h.service.StartTimer(&timer); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, timer)
}

func (h *TimeHandler) StopTimer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Notes string `json:"notes"`
	}
	// Body is optional
	_ = readJSON(r, &body)

	session, err := h.service.StopTimer(body.Notes)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *TimeHandler) DiscardTimer(w http.ResponseWriter, r *http.Request) {
	if err := h.service.DiscardTimer(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Active timer discarded"})
}

func (h *TimeHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	sessions, err := h.service.ListSessions(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *TimeHandler) ListBlocks(w http.ResponseWriter, r *http.Request) {
	blocks, err := h.service.ListBlocks()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, blocks)
}

func (h *TimeHandler) CreateBlock(w http.ResponseWriter, r *http.Request) {
	var block models.TimeBlock
	if err := readJSON(r, &block); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if err := h.service.CreateBlock(&block); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, block)
}

func (h *TimeHandler) DeleteBlock(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.service.DeleteBlock(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Time block deleted"})
}

func (h *TimeHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.service.GetStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
