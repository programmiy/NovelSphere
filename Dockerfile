# Dockerfile

# --- Builder Stage ---
# This stage installs all Python dependencies.
FROM python:3.11-slim as builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN pip install --upgrade pip

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /app/wheels -r requirements.txt


# --- Final Stage ---
# This stage creates the final, smaller image.
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy installed packages from builder stage
COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache /wheels/*

# Copy the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8000

# Command to run the application
# This assumes your FastAPI application instance is named "app" in the "main" module (main.py).
# You might need to adjust this based on your actual application structure.
CMD ["uvicorn", "server.server:app", "--host", "0.0.0.0", "--port", "8000"]
