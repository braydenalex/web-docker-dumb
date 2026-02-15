import json
import logging
import os
from typing import List

import docker
from docker.errors import APIError, DockerException, NotFound
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger("web-docker-dumb")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

CONTAINER_ID_REGEX = r"^[a-fA-F0-9]{12,64}$"
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "connect-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self';"
    ),
}


def parse_csv_env(variable_name: str, fallback: str = "") -> List[str]:
    raw_value = os.getenv(variable_name, fallback)
    return [entry.strip() for entry in raw_value.split(",") if entry.strip()]


DOCKER_HOST = os.getenv("DOCKER_HOST", "tcp://docker-proxy:2375")
ROOT_PATH = os.getenv("ROOT_PATH", "")
API_BASE_PATH = os.getenv("API_BASE_PATH", "")
DOCKER_TIMEOUT_SECONDS = int(os.getenv("DOCKER_TIMEOUT_SECONDS", "10"))
LOG_TAIL_LINES = max(10, min(1000, int(os.getenv("LOG_TAIL_LINES", "200"))))
ALLOWED_ORIGINS = parse_csv_env("ALLOWED_ORIGINS")
ALLOWED_HOSTS = parse_csv_env("ALLOWED_HOSTS", "localhost,127.0.0.1")
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "true").lower() in {"1", "true", "yes", "on"}

client = docker.DockerClient(base_url=DOCKER_HOST, timeout=DOCKER_TIMEOUT_SECONDS)

openapi_url = f"{ROOT_PATH}/openapi.json" if ROOT_PATH else "/openapi.json"
docs_url = f"{ROOT_PATH}/docs" if ROOT_PATH else "/docs"
redoc_url = f"{ROOT_PATH}/redoc" if ROOT_PATH else "/redoc"
if not ENABLE_DOCS:
    openapi_url = None
    docs_url = None
    redoc_url = None

app = FastAPI(
    title="web-docker-dumb API",
    root_path=ROOT_PATH,
    openapi_url=openapi_url,
    docs_url=docs_url,
    redoc_url=redoc_url,
)

if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

if ALLOWED_ORIGINS:
    allow_any_origin = "*" in ALLOWED_ORIGINS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_any_origin else ALLOWED_ORIGINS,
        allow_credentials=not allow_any_origin,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
        max_age=600,
    )


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    for header_name, header_value in SECURITY_HEADERS.items():
        response.headers.setdefault(header_name, header_value)
    return response


def get_container_or_404(container_id: str):
    try:
        return client.containers.get(container_id)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail="Container not found") from exc
    except APIError as exc:
        logger.exception("Docker API error while resolving container '%s'", container_id)
        raise HTTPException(status_code=502, detail="Docker API request failed") from exc
    except DockerException as exc:
        logger.exception("Docker connection error while resolving container '%s'", container_id)
        raise HTTPException(status_code=503, detail="Docker API unavailable") from exc


def get_container_image(container) -> str:
    try:
        if container.image and container.image.tags:
            return container.image.tags[0]
    except (AttributeError, DockerException):
        pass
    return "unknown"


@app.get("/containers")
def list_containers():
    try:
        containers = client.containers.list(all=True)
    except APIError as exc:
        logger.exception("Docker API error while listing containers")
        raise HTTPException(status_code=502, detail="Docker API request failed") from exc
    except DockerException as exc:
        logger.exception("Docker connection error while listing containers")
        raise HTTPException(status_code=503, detail="Docker API unavailable") from exc

    return [
        {
            "id": container.id[:12],
            "name": container.name,
            "status": container.status,
            "image": get_container_image(container),
        }
        for container in containers
    ]


@app.post("/containers/{container_id}/start")
def start_container(container_id: str = Path(..., min_length=12, max_length=64, regex=CONTAINER_ID_REGEX)):
    container = get_container_or_404(container_id)
    try:
        container.start()
        return {"message": f"Started {container.name}"}
    except APIError as exc:
        logger.exception("Docker API error while starting container '%s'", container_id)
        raise HTTPException(status_code=502, detail="Failed to start container") from exc
    except DockerException as exc:
        logger.exception("Docker connection error while starting container '%s'", container_id)
        raise HTTPException(status_code=503, detail="Docker API unavailable") from exc


@app.post("/containers/{container_id}/stop")
def stop_container(container_id: str = Path(..., min_length=12, max_length=64, regex=CONTAINER_ID_REGEX)):
    container = get_container_or_404(container_id)
    try:
        container.stop()
        return {"message": f"Stopped {container.name}"}
    except APIError as exc:
        logger.exception("Docker API error while stopping container '%s'", container_id)
        raise HTTPException(status_code=502, detail="Failed to stop container") from exc
    except DockerException as exc:
        logger.exception("Docker connection error while stopping container '%s'", container_id)
        raise HTTPException(status_code=503, detail="Docker API unavailable") from exc


@app.get("/containers/{container_id}/logs")
def get_container_logs(container_id: str = Path(..., min_length=12, max_length=64, regex=CONTAINER_ID_REGEX)):
    container = get_container_or_404(container_id)
    try:
        logs = container.logs(tail=LOG_TAIL_LINES).decode("utf-8", errors="replace")
        return {"logs": logs}
    except APIError as exc:
        logger.exception("Docker API error while fetching logs for '%s'", container_id)
        raise HTTPException(status_code=502, detail="Failed to fetch container logs") from exc
    except DockerException as exc:
        logger.exception("Docker connection error while fetching logs for '%s'", container_id)
        raise HTTPException(status_code=503, detail="Docker API unavailable") from exc


@app.get("/config.js", include_in_schema=False)
def get_config_js():
    js_payload = f"window.API_BASE_PATH = {json.dumps(API_BASE_PATH)};"
    return Response(
        content=js_payload,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.on_event("shutdown")
def close_docker_client():
    client.close()


frontend_path = os.path.join(os.path.dirname(__file__), "frontend_build")
if os.path.exists(frontend_path):
    mount_path = ROOT_PATH if ROOT_PATH else "/"
    app.mount(mount_path, StaticFiles(directory=frontend_path, html=True), name="frontend")
