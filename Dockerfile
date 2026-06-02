# Use Node.js LTS light base image
FROM node:20-slim

# Install system dependencies (Python 3 for query_streets.py)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install python libraries required for geospatial data
RUN pip3 install --break-system-packages pyproj

# Create app directory
WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only (skip node-windows)
RUN npm ci --omit=dev --omit=optional

# Copy app source and data
COPY . .

# Set environment to production
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "server/index.js"]
