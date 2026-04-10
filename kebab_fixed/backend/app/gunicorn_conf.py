"""Gunicorn configuration for production deployment.

Usage:
    gunicorn app.main:app -c app/gunicorn_conf.py
"""
import multiprocessing
import os

# Bind — default 127.0.0.1 (nginx proxies), override with BIND env var
bind = os.environ.get("BIND", "127.0.0.1:8000")

# Workers — CPU-bound tasks are minimal (mostly I/O to Postgres),
# so 2-4 workers per core is appropriate.
workers = int(os.environ.get("WEB_CONCURRENCY", min(multiprocessing.cpu_count() * 2 + 1, 9)))

# Use uvicorn worker class for ASGI
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.environ.get("GUNICORN_KEEPALIVE", "5"))

# Logging — let the app's logging config handle formatting
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")

# Process naming
proc_name = "kebab-mes"

# Preload app for faster worker startup and shared memory
preload_app = True

# Max requests before worker restart (prevents memory leaks)
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", "2000"))
max_requests_jitter = int(os.environ.get("GUNICORN_MAX_REQUESTS_JITTER", "200"))
