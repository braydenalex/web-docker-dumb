import os
import docker
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# Load environment variables (docker-compose env vars override .env file)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

BASE_PATH = os.getenv("BASE_PATH", "").rstrip("/")
DOCKER_HOST = os.getenv("DOCKER_HOST", "tcp://docker-proxy:2375")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

client = docker.DockerClient(base_url=DOCKER_HOST)

app = FastAPI(
    title="web-docker-dumb API",
    openapi_url=f"{BASE_PATH}/openapi.json" if BASE_PATH else "/openapi.json",
    docs_url=f"{BASE_PATH}/docs" if BASE_PATH else "/docs",
    redoc_url=f"{BASE_PATH}/redoc" if BASE_PATH else "/redoc",
    root_path=BASE_PATH,
)

# Allow CORS for frontend access.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
    try:
        container = client.containers.get(container_id)
        container.start()
        return {"message": f"Started {container.name}"}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/containers/{container_id}/stop")
def stop_container(container_id: str):
    try:
        container = client.containers.get(container_id)
        container.stop()
        return {"message": f"Stopped {container.name}"}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.get("/containers/{container_id}/logs")
def get_container_logs(container_id: str):
    try:
        container = client.containers.get(container_id)
        logs = container.logs(tail=100).decode("utf-8")
        return {"logs": logs}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files for the frontend.
frontend_path = os.path.join(os.path.dirname(__file__), "frontend_build")
if os.path.exists(frontend_path):
    app.mount(BASE_PATH if BASE_PATH else "/", StaticFiles(directory=frontend_path, html=True), name="frontend")