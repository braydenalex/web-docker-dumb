import os
import docker
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

DOCKER_HOST = os.getenv("DOCKER_HOST", "tcp://docker-proxy:2375")
ROOT_PATH = os.getenv("ROOT_PATH", "")
API_BASE_PATH = os.getenv("API_BASE_PATH", "") # also used in frontend

client = docker.DockerClient(base_url=DOCKER_HOST)

app = FastAPI(
    title="web-docker-dumb API",
    root_path=ROOT_PATH,
    openapi_url=f"{ROOT_PATH}/openapi.json" if ROOT_PATH else "/openapi.json",
    docs_url=f"{ROOT_PATH}/docs" if ROOT_PATH else "/docs",
    redoc_url=f"{ROOT_PATH}/redoc" if ROOT_PATH else "/redoc",
)

# Allow CORS for frontend access.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API endpoints remain unchanged.
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

@app.get("/config.js", include_in_schema=False)
def get_config_js():
    # This value comes from your Docker Compose .env via the container environment.
    return Response(content=f"window.API_BASE_PATH = '{API_BASE_PATH}';", media_type="application/javascript")

# Mount static files.
frontend_path = os.path.join(os.path.dirname(__file__), "frontend_build")
if os.path.exists(frontend_path):
    mount_path = ROOT_PATH if ROOT_PATH else "/"
    app.mount(mount_path, StaticFiles(directory=frontend_path, html=True), name="frontend")