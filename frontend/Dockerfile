FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_ALLOW_DEMO_AUTH=true
ARG VITE_APP_NAME=OpenOrg
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_ALLOW_DEMO_AUTH=$VITE_ALLOW_DEMO_AUTH
ENV VITE_APP_NAME=$VITE_APP_NAME
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
