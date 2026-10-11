package handlers

import (
	"net/http"

	"personal-system/backend/internal/models"
	"personal-system/backend/internal/services"
)

type TaskHandler struct {
	service *services.TaskService
}

func NewTaskHandler(service *services.TaskService) *TaskHandler {
	return &TaskHandler{service: service}
}

func (h *TaskHandler) ListTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := models.TaskFilter{}

	if status := q.Get("status"); status != "" {
		st := models.TaskStatus(status)
		filter.Status = &st
	}
	if priority := q.Get("priority"); priority != "" {
		pr := models.TaskPriority(priority)
		filter.Priority = &pr
	}
	if project := q.Get("project"); project != "" {
		filter.Project = &project
	}
	if search := q.Get("search"); search != "" {
		filter.Search = &search
	}

	tasks, err := h.service.ListTasks(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (h *TaskHandler) CreateTask(w http.ResponseWriter, r *http.Request) {
	var task models.Task
	if err := readJSON(r, &task); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}

	if err := h.service.CreateTask(&task); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *TaskHandler) GetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	task, err := h.service.GetTask(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *TaskHandler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var task models.Task
	if err := readJSON(r, &task); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}
	task.ID = id

	if err := h.service.UpdateTask(&task); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *TaskHandler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.service.DeleteTask(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Task deleted successfully"})
}
