import os
import docker
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

BASE_PATH = os.getenv("BASE_PATH", "").rstrip("/")
DOCKER_HOST = os.getenv("DOCKER_HOST", "tcp://docker-proxy:2375")

client = docker.DockerClient(base_url=DOCKER_HOST)

app = FastAPI(
    title="web-docker-dumb API",
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Allow CORS for frontend access (will remove for prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/containers")
def list_containers():
    containers = client.containers.list(all=True)
    return [{"id": c.id[:12], "name": c.name, "status": c.status} for c in containers]

@app.post("/containers/{container_id}/start")
def start_container(container_id: str):
    container = client.containers.get(container_id)
    container.start()
    return {"message": f"Started {container.name}"}

@app.post("/containers/{container_id}/stop")
def stop_container(container_id: str):
    container = client.containers.get(container_id)
    container.stop()
    return {"message": f"Stopped {container.name}"}

frontend_path = os.path.join(os.path.dirname(__file__), "frontend_build")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
