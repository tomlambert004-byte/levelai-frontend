#!/bin/bash
cd ~/Downloads/pulpmain/backend/backend2
export $(cat .env | xargs)
brew services start redis
brew services start postgresql@16
python3 -m celery -A worker.celery_app worker --loglevel=info &
python3 -m uvicorn api:app --reload --port 8000 &
echo "All services started"
