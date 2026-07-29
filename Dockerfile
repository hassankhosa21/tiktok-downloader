FROM node:18-slim
USER node
WORKDIR /home/node/app
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
COPY frontend/ ./frontend/
EXPOSE 5000
CMD ["node", "server.js"]