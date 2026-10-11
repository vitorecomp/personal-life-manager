.PHONY: run build test clean

run:
	go run ./cmd/server

build:
	go build -o bin/server ./cmd/server

test:
	go test -v ./...

clean:
	rm -rf bin/
