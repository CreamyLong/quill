install:
	npm ci

dev:
	SCITOPS_PORT=8001 npm run gateway:dev

gateway:
	npm run build && SCITOPS_PORT=8001 npm run gateway

test:
	npm run check && npm run gateway:test

lint:
	npm run check

format:
	npm run build
