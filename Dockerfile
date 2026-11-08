FROM node:22-alpine
WORKDIR /app
COPY . .
RUN node tools/build.mjs && node tools/test.mjs
ENV PORT=80 DATA_DIR=/data
EXPOSE 80
CMD ["node", "server/server.mjs"]
