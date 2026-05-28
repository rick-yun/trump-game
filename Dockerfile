FROM node:18-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm install
COPY server/ ./
COPY client/ ./public/
EXPOSE 3000
CMD ["node", "index.js"]
