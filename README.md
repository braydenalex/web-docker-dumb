# web-docker-dumb

## Overview

**web-docker-dumb** is a simple web-based user interface designed for users who are already familiar with Docker and Docker Compose command-line tools. This project aims to provide a basic set of features to manage Docker containers remotely.

## Features

- **View All Containers**: Easily view a list of all Docker containers, including their status and basic details.
- **Start and Stop Containers**: Manage the lifecycle of your containers with simple start and stop controls.
- **View Logs**: Access the logs of your containers to monitor their output and diagnose issues.

## Why Use Docker Proxy?

In this project, we utilize the `tecnativa/docker-socket-proxy` for the following reasons:

- **Security**: Directly exposing the Docker socket to a web application can pose significant security risks. The proxy helps mitigate these risks by controlling access to the Docker API.

## Building using Docker Compose
```
services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: docker-proxy
    restart: always
    ports:
      - "2375:2375"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      PING: "1"
      CONTAINERS: "1"
      POST: "1"
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:2375/_ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 2s

  web-docker-dumb:
    image: braydennn/web-docker-dumb:latest
    depends_on:
      docker-proxy:
        condition: service_healthy
    environment:
      - DOCKER_HOST=tcp://docker-proxy:2375
      - BASE_PATH=/web-docker-dumb
    ports:
      - "8000:8000"
```

This would make the UI accessible at /web-docker-dumb, ignore the variable if you wish to use at its normal path.

## Building from Dockerfile

### Prerequisites

- Docker
- Docker Compose

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/web-docker-dumb.git
   cd web-docker-dumb
   ```

2. Set up the environment variables:
   - Create a `.env` file in the `backend` directory with the necessary configurations. Refer to the `.env.example` for guidance.

3. Start the application using Docker Compose:
   ```bash
   docker-compose up -d
   ```

4. Access the UI:
   - Open your web browser and navigate to `http://localhost:8000` to start using the application.
  
## Environment Variables
   ```
   DOCKER_HOST=
   BASE_PATH=
   ```

## Usage

- **Refresh the Container List**: Click the "Refresh" button to update the list of containers.
- **View Container Details**: Click on a container name to view its details and available actions.
- **Manage Containers**: Use the "Start" and "Stop" buttons to control the container's state.
- **View Logs**: Click "View Logs" to see the container's output.

## Code Structure

- **Frontend**: Contains the HTML and JavaScript files for the user interface.
  - `index.html`: The main HTML file for the UI.
  - `script.js`: JavaScript file handling UI interactions and API calls.

- **Backend**: Built with FastAPI to interact with Docker.
  - `main.py`: The main API file that handles requests to list, start, stop, and fetch logs of containers.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request for any improvements or bug fixes.
