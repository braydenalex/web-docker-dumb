# web-docker-dumb

A small Docker dashboard for people who already use Docker and Compose. Browse containers by Compose project, search by name or image, start and stop containers, and read timestamped logs.

## Run locally

With Docker and Docker Compose installed, run this from the repository root.

```sh
docker compose up -d --build
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The dashboard binds to the host's loopback interface, and the Docker socket proxy is reachable only on a private Compose network shared with the backend. The pinned [LinuxServer socket proxy](https://docs.linuxserver.io/images/docker-socket-proxy/) permits container reads and explicitly allows start and stop with general writes disabled.

If you copied an older Compose example, remove the proxy's published `2375` port and apply the updated configuration. This repository's `compose.yml` is the deployment example.

The refresh timestamp shows when the container list was last loaded successfully. If a refresh fails, the previous list remains visible and container actions wait for a successful refresh. The log panel shows the configured line limit, adds Docker timestamps, and indicates when the byte cap cuts off output. You can refresh, copy, or download the displayed logs.

## Remote access

Keep the dashboard port bound to loopback. For a single administrator with SSH access, forward the dashboard port and open it locally.

```sh
ssh -N -L 8000:127.0.0.1:8000 your-docker-host
```

For browser access by multiple people, use an authenticated HTTPS reverse proxy or a private VPN with access controls. A host-based reverse proxy can reach `127.0.0.1:8000`. Protect the entire site, including `/containers` and all its subpaths. Set `ALLOWED_HOSTS` to include the public hostname and `ALLOWED_ORIGINS` to the exact external origin if TLS terminates before the app. The proxy should preserve the original `Host` header. If using forwarded scheme headers, set `FORWARDED_ALLOW_IPS` to the trusted proxy IP as seen by the application.

You can let the reverse proxy handle authentication or set both `APP_USERNAME` and `APP_PASSWORD` to enable HTTP Basic authentication for the UI and API. Use HTTPS for remote Basic authentication.

## Limit the dashboard to selected containers

Set `MANAGED_ONLY=true` and add this label to each workload that the dashboard should manage. Recreate those workload containers so the label takes effect.

```yaml
services:
  example:
    labels:
      web-docker-dumb.manage: "true"
```

While enabled, the label controls listing, logs, and start and stop on the backend. This keeps other workloads and the dashboard's own infrastructure out of the UI.

## Configuration

Set values in your shell or in a `.env` file in the repository root before running Compose. A direct Python launch also reads `backend/.env`. Keep credential-bearing `.env` files local.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `8000` | Host loopback port for Compose |
| `APP_USERNAME`, `APP_PASSWORD` | Empty | Enable HTTP Basic authentication when both are set |
| `MANAGED_ONLY` | `false` | Require `web-docker-dumb.manage=true` on each accessible container |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated hostnames accepted by the backend |
| `ALLOWED_ORIGINS` | Empty | Explicit browser origins allowed for cross-origin requests, including writes |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | IPs Uvicorn trusts for forwarded headers |
| `ROOT_PATH` | Empty | External URL prefix, such as `/docker`, when a reverse proxy strips that prefix |
| `API_BASE_PATH` | `ROOT_PATH` | Optional override for the same-origin API prefix |
| `DOCKER_HOST` | `tcp://docker-proxy:2375` | Docker endpoint. The supplied Compose file sets this to its private proxy |
| `DOCKER_TIMEOUT_SECONDS` | `10` | Docker SDK HTTP timeout in seconds |
| `STOP_GRACE_SECONDS` | Docker default | Optional override for the container's normal graceful stop timeout |
| `LOG_TAIL_LINES` | `200` | Docker log tail limit, clamped to 10–1000 lines |
| `LOG_MAX_BYTES` | `262144` | Maximum Docker log bytes collected per request, clamped to 1 KiB–1 MiB |
| `ENABLE_DOCS` | `false` | Expose the OpenAPI schema at `/openapi.json` |
| `LOG_LEVEL` | `INFO` | Backend log level |

## Update dependencies

The image uses Python 3.13 and installs the pinned runtime dependencies from `backend/requirements.txt`. Update the lock and audit it with the following commands.

```sh
uv pip compile --universal --python-version 3.13 --upgrade backend/requirements.in -o backend/requirements.txt
uvx --python 3.13 pip-audit --disable-pip --no-deps -r backend/requirements.txt
```
