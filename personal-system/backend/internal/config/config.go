package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port                 string
	DataFile             string
	ProbeIntervalSeconds int
	CORSOrigin           string
}

func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dataFile := os.Getenv("DATA_FILE")
	if dataFile == "" {
		dataFile = "data/store.json"
	}

	interval := 30
	if val := os.Getenv("PROBE_INTERVAL_SECONDS"); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil && parsed > 0 {
			interval = parsed
		}
	}

	cors := os.Getenv("CORS_ORIGIN")
	if cors == "" {
		cors = "*"
	}

	return &Config{
		Port:                 port,
		DataFile:             dataFile,
		ProbeIntervalSeconds: interval,
		CORSOrigin:           cors,
	}
}
