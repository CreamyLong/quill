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

detect-thread-boundaries:
	npx tsx scripts/detect_thread_boundaries.ts

benchmark-memory-eviction:
	npx tsx scripts/benchmark/memory_eviction/validate_contracts.ts

extension-list:
	@echo "Extension listing requires a running Gateway. Use the API endpoint GET /api/extensions."

extension-install:
	@if [ -z "$(SOURCE)" ]; then \
		echo "Usage: make extension-install SOURCE=<path-or-url>"; \
		exit 1; fi
	@echo "Extension installation requires a running Gateway. Use POST /api/extensions/install."

extension-enable:
	@if [ -z "$(NAME)" ]; then \
		echo "Usage: make extension-enable NAME=<name>"; \
		exit 1; fi
	@echo "Extension enable requires a running Gateway. Use PUT /api/extensions/$(NAME)/enable."

extension-disable:
	@if [ -z "$(NAME)" ]; then \
		echo "Usage: make extension-disable NAME=<name>"; \
		exit 1; fi
	@echo "Extension disable requires a running Gateway. Use PUT /api/extensions/$(NAME)/disable."

extension-remove:
	@if [ -z "$(NAME)" ]; then \
		echo "Usage: make extension-remove NAME=<name>"; \
		exit 1; fi
	@echo "Extension removal requires a running Gateway. Use DELETE /api/extensions/$(NAME)."
