.PHONY: test lint build-web dev

test:
	pytest backend/tests frontend/tests/regression -v

lint:
	ruff check --config backend/pyproject.toml backend/opentalking/core backend/opentalking/events backend/opentalking/avatar backend/apps backend/tests

build-web:
	cd frontend && npm run build

dev:
	bash scripts/start_unified.sh --mock
