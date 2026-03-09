FROM node:20-slim

# Install Claude CLI globally and sudo for entrypoint permissions fix
RUN apt-get update && apt-get install -y --no-install-recommends sudo git && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

# Create non-root user with passwordless sudo (for fixing volume permissions on startup)
RUN useradd -m -s /bin/bash claude && echo "claude ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY .claude/commands/ ./.claude/commands/
COPY entrypoint.sh ./

RUN chmod +x entrypoint.sh && chown -R claude:claude /app

USER claude

ENV PORT=3131
EXPOSE ${PORT}

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
