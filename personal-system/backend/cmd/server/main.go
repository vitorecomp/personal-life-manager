package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"personal-system/backend/internal/config"
	"personal-system/backend/internal/handlers"
	"personal-system/backend/internal/services"
	"personal-system/backend/internal/storage"
)

func main() {
	cfg := config.Load()

	store, err := storage.NewFileStore(cfg.DataFile)
	if err != nil {
		log.Fatalf("[Server] Failed to open data file %s: %v", cfg.DataFile, err)
	}

	taskSvc := services.NewTaskService(store)
	timeSvc := services.NewTimeService(store)
	serverSvc := services.NewServerService(store, cfg.ProbeIntervalSeconds)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverSvc.StartBackgroundProber(ctx)

	mux := http.NewServeMux()
	handlers.RegisterRoutes(mux, taskSvc, timeSvc, serverSvc)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handlers.Chain(mux, handlers.LoggingMiddleware, handlers.CORSMiddleware(cfg.CORSOrigin)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[Server] Listening on :%s (data file: %s)", cfg.Port, cfg.DataFile)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[Server] %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[Server] Shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[Server] Graceful shutdown failed: %v", err)
	}
}
