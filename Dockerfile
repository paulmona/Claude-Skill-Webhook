FROM node:20-slim

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

ENV PORT=3131
EXPOSE ${PORT}

CMD ["node", "server.js"]
