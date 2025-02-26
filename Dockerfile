FROM python:3.9
WORKDIR /app

# Copy Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ /app/backend

# Copy frontend to "frontend_build"
COPY frontend/ /app/backend/frontend_build/

# Expose port 8000
EXPOSE 8000

# Start FastAPI
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
