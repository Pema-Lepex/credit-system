# Credit Management System — common tasks.
#
#   make setup    one-time install (backend venv + frontend deps + .env files)
#   make seed     reset the database and load demo data
#   make dev      run backend + frontend together
#   make check    tests + lint + typecheck, everything
#
# `make dev` runs both servers in one terminal. Ctrl-C stops both.

SHELL := /bin/bash
PY    := backend/.venv/bin/python
PIP   := backend/.venv/bin/pip

.PHONY: help setup setup-backend setup-frontend seed dev dev-backend dev-frontend \
        test lint typecheck check build migrate migration clean reset

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- setup ------------------------------------------------------------------
setup: setup-backend setup-frontend ## Install everything (run once)
	@echo ""
	@echo "  Setup complete. Next:  make seed && make dev"
	@echo ""

setup-backend: ## Create the venv and install Python deps
	python3 -m venv backend/.venv
	$(PIP) install --quiet --upgrade pip
	$(PIP) install --quiet -r backend/requirements.txt
	@test -f backend/.env || cp backend/.env.example backend/.env
	@echo "  backend ready"

setup-frontend: ## Install Node deps
	cd frontend && npm install --silent
	@test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
	@echo "  frontend ready"

# --- run --------------------------------------------------------------------
seed: ## Reset the database and load demo data
	cd backend && ../$(PY) -m app.db.seed --reset

dev: ## Run backend (:8000) and frontend (:3000) together
	@echo "  backend  → http://localhost:8000/graphql"
	@echo "  frontend → http://localhost:3000"
	@echo ""
	@trap 'kill 0' EXIT INT TERM; \
	( cd backend && ../$(PY) -m uvicorn app.main:app --reload --port 8000 ) & \
	( cd frontend && npm run dev ) & \
	wait

dev-backend: ## Run only the backend
	cd backend && ../$(PY) -m uvicorn app.main:app --reload --port 8000

dev-frontend: ## Run only the frontend
	cd frontend && npm run dev

# --- quality ----------------------------------------------------------------
test: ## Run the backend test suite
	cd backend && ../$(PY) -m pytest -q

lint: ## Lint backend and frontend
	cd backend && ../backend/.venv/bin/ruff check app tests
	cd frontend && npx eslint .

typecheck: ## Typecheck the frontend
	cd frontend && npx tsc --noEmit

build: ## Production build of the frontend
	cd frontend && npm run build

check: test lint typecheck build ## Everything. Run this before you commit.
	@echo ""
	@echo "  All checks passed."
	@echo ""

# --- database ---------------------------------------------------------------
migrate: ## Apply pending migrations
	cd backend && ../backend/.venv/bin/alembic upgrade head

migration: ## Create a migration:  make migration m="add customer tier"
	cd backend && ../backend/.venv/bin/alembic revision --autogenerate -m "$(m)"

# --- housekeeping -----------------------------------------------------------
clean: ## Remove caches and build artefacts (keeps the database)
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf backend/.pytest_cache backend/.ruff_cache frontend/.next

reset: ## Delete the database and all uploads. Destructive.
	@read -p "  Delete the database and every uploaded file? [y/N] " ok; \
	 [ "$$ok" = "y" ] || exit 1; \
	 rm -f database/app.db*; \
	 find uploads -type f ! -name .gitkeep -delete; \
	 echo "  Wiped. Run 'make seed' to start again."
