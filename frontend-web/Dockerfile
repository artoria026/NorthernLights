# Stage 1: build con Node + npm (mismo gestor que package-lock.json del repo)
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite incrusta VITE_* en el bundle en tiempo de BUILD, no de runtime — deben
# llegar como build args (ver build.args en docker-compose.yml), no como
# variables de entorno del contenedor final.
ARG VITE_API_BASE_URL
ARG VITE_APP_ENV=production
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_ENV=${VITE_APP_ENV}
# VITE_ENABLE_DEV_LOGIN deliberadamente NO se define aqui: ademas de esa env
# var, el boton de login de prueba requiere import.meta.env.DEV, que `vite
# build` siempre deja en false — doble seguro documentado en el README.
RUN npm run build

# Stage 2: servir con nginx (imagen final ~30MB)
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
