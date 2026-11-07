FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN node tools/build.mjs && node tools/test.mjs

FROM nginx:alpine
COPY --from=build /app/public /usr/share/nginx/html
