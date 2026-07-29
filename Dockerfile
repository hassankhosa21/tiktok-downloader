FROM node:18-slim

WORKDIR /app

# Copy package files from backend folder
COPY backend/package*.json ./
RUN npm install

# Copy the rest of the backend code
COPY backend/ ./

EXPOSE 5000

CMD ["node", "server.js"]