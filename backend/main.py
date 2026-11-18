import base64
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager, contextmanager, suppress
from pathlib import Path as FilePath
from threading import Lock
from typing import Annotated

import docker
from docker.errors import APIError, DockerException, NotFound
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Path, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from requests.exceptions import RequestException
from starlette.middleware.trustedhost import TrustedHostMiddleware

load_dotenv(FilePath(__file__).with_name('.env'))

logger = logging.getLogger('web-docker-dumb')
logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO').upper())

ContainerId = Annotated[str, Path(pattern=r'^[a-fA-F0-9]{12,64}$')]
MANAGED_LABEL = 'web-docker-dumb.manage'
COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': (
        "default-src 'self'; connect-src 'self'; script-src 'self'; "
        "style-src 'self'; font-src 'self'; img-src 'self' data:; "
        "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
    ),
}


def parse_csv_env(name: str, default: str = '') -> list[str]:
    return [value.strip() for value in os.getenv(name, default).split(',') if value.strip()]


def env_flag(name: str) -> bool:
    return os.getenv(name, '').lower() in {'1', 'true', 'yes', 'on'}


DOCKER_HOST = os.getenv('DOCKER_HOST', 'tcp://docker-proxy:2375')
ROOT_PATH = os.getenv('ROOT_PATH', '').rstrip('/')
API_BASE_PATH = (os.getenv('API_BASE_PATH') or ROOT_PATH).rstrip('/')
DOCKER_TIMEOUT_SECONDS = int(os.getenv('DOCKER_TIMEOUT_SECONDS', '10'))
stop_grace_setting = os.getenv('STOP_GRACE_SECONDS')
STOP_GRACE_SECONDS = int(stop_grace_setting) if stop_grace_setting else None
LOG_TAIL_LINES = max(10, min(1000, int(os.getenv('LOG_TAIL_LINES', '200'))))
LOG_MAX_BYTES = max(1024, min(1024 * 1024, int(os.getenv('LOG_MAX_BYTES', '262144'))))
ALLOWED_ORIGINS = parse_csv_env('ALLOWED_ORIGINS')
ALLOWED_HOSTS = parse_csv_env('ALLOWED_HOSTS', 'localhost,127.0.0.1')
ENABLE_DOCS = env_flag('ENABLE_DOCS')
MANAGED_ONLY = env_flag('MANAGED_ONLY')
APP_USERNAME = os.getenv('APP_USERNAME', '')
APP_PASSWORD = os.getenv('APP_PASSWORD', '')
if bool(APP_USERNAME) != bool(APP_PASSWORD) or ':' in APP_USERNAME:
    raise ValueError('Set both APP_USERNAME and APP_PASSWORD, with no colon in APP_USERNAME.')
AUTH_CREDENTIALS = f'{APP_USERNAME}:{APP_PASSWORD}'.encode() if APP_USERNAME else None

client = None
client_lock = Lock()


def get_docker_client():
    global client
    with client_lock:
        if client is None:
            client = docker.DockerClient(base_url=DOCKER_HOST, timeout=DOCKER_TIMEOUT_SECONDS)
        return client


@asynccontextmanager
async def lifespan(_app):
    global client
    try:
        yield
    finally:
        if client is not None:
            client.close()
            client = None


app = FastAPI(
    title='web-docker-dumb API',
    root_path=ROOT_PATH,
    openapi_url='/openapi.json' if ENABLE_DOCS else None,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

if ALLOWED_ORIGINS:
    allow_any_origin = '*' in ALLOWED_ORIGINS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'] if allow_any_origin else ALLOWED_ORIGINS,
        allow_credentials=not allow_any_origin,
        allow_methods=['GET', 'POST', 'OPTIONS'],
        allow_headers=['Accept', 'Content-Type', 'Authorization'],
        max_age=600,
    )


def valid_credentials(header: str) -> bool:
    scheme, _, value = header.partition(' ')
    if scheme.lower() != 'basic':
        return False
    try:
        credentials = base64.b64decode(value, validate=True)
    except ValueError:
        return False
    return hmac.compare_digest(credentials, AUTH_CREDENTIALS)


def allowed_write_origin(request: Request) -> bool:
    origin = request.headers.get('origin')
    if origin in ALLOWED_ORIGINS and origin not in {None, 'null', '*'}:
        return True
    if request.headers.get('sec-fetch-site') == 'cross-site':
        return False
    return origin is None or origin == f'{request.url.scheme}://{request.url.netloc}'


@app.middleware('http')
async def protect_requests(request: Request, call_next):
    if request.method == 'POST' and not allowed_write_origin(request):
        response = JSONResponse({'detail': 'Request origin is not allowed.'}, status_code=403)
    elif (
        AUTH_CREDENTIALS is not None
        and request.method != 'OPTIONS'
        and not valid_credentials(request.headers.get('authorization', ''))
    ):
        response = JSONResponse(
            {'detail': 'Sign in to access the dashboard.'},
            status_code=401,
            headers={'WWW-Authenticate': 'Basic realm="web-docker-dumb", charset="UTF-8"'},
        )
    else:
        response = await call_next(request)

    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    response.headers.setdefault('Cache-Control', 'no-store')
    return response


@contextmanager
def docker_operation(operation: str):
    try:
        yield
    except NotFound as exc:
        raise HTTPException(status_code=404, detail='Container not found.') from exc
    except APIError as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail='Container state changed. Refresh and try again.') from exc
        if exc.status_code == 403:
            raise HTTPException(status_code=502, detail='The Docker proxy denied this operation.') from exc
        logger.exception('Docker API error while %s', operation)
        raise HTTPException(status_code=502, detail='Docker API request failed.') from exc
    except (DockerException, RequestException) as exc:
        logger.exception('Docker connection error while %s', operation)
        raise HTTPException(status_code=503, detail='Docker API unavailable.') from exc


def get_container_or_404(container_id: str):
    container = get_docker_client().containers.get(container_id)
    if MANAGED_ONLY and container.labels.get(MANAGED_LABEL) != 'true':
        raise HTTPException(status_code=404, detail='Container not found.')
    return container


@app.get('/containers')
def list_containers():
    filters = {'label': [f'{MANAGED_LABEL}=true']} if MANAGED_ONLY else None
    with docker_operation('listing containers'):
        containers = get_docker_client().api.containers(all=True, filters=filters)

    return [
        {
            'id': container['Id'][:12],
            'name': container['Names'][0].lstrip('/') if container.get('Names') else container['Id'][:12],
            'status': container['State'],
            'image': container['Image'],
            'compose_project': (container.get('Labels') or {}).get(COMPOSE_PROJECT_LABEL),
        }
        for container in containers
    ]


@app.post('/containers/{container_id}/start')
def start_container(container_id: ContainerId):
    with docker_operation('starting a container'):
        container = get_container_or_404(container_id)
        container.start()
        return {'message': f'Started {container.name}.'}


@app.post('/containers/{container_id}/stop')
def stop_container(container_id: ContainerId):
    with docker_operation('stopping a container'):
        container = get_container_or_404(container_id)
        timeout = STOP_GRACE_SECONDS
        if timeout is None:
            timeout = container.attrs['Config'].get('StopTimeout')
        container.stop(timeout=None if timeout == -1 else timeout)
        return {'message': f'Stopped {container.name}.'}


@app.get('/containers/{container_id}/logs')
def get_container_logs(container_id: ContainerId):
    with docker_operation('fetching container logs'):
        container = get_container_or_404(container_id)
        stream = container.logs(tail=LOG_TAIL_LINES, timestamps=True, stream=True, follow=False)
        output = bytearray()
        truncated = False
        try:
            for chunk in stream:
                remaining = LOG_MAX_BYTES - len(output)
                output.extend(chunk[:remaining])
                if len(chunk) > remaining:
                    truncated = True
                    break
        finally:
            with suppress(OSError):
                stream.close()

    return {
        'logs': output.decode('utf-8', errors='replace'),
        'tail_lines': LOG_TAIL_LINES,
        'truncated': truncated,
    }


@app.get('/config.js', include_in_schema=False)
def get_config_js():
    return Response(
        content=f'window.API_BASE_PATH = {json.dumps(API_BASE_PATH)};',
        media_type='application/javascript',
    )


frontend_path = FilePath(__file__).with_name('frontend_build')
if frontend_path.is_dir():
    app.mount('/', StaticFiles(directory=frontend_path, html=True), name='frontend')
