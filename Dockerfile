FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
COPY frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /src
COPY backend/backend.csproj backend/
RUN dotnet restore backend/backend.csproj
COPY backend/ backend/
RUN dotnet publish backend/backend.csproj --configuration Release --output /app/publish --no-restore
COPY --from=frontend-build /src/frontend/dist/frontend/browser/ /app/publish/wwwroot/

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=backend-build /app/publish/ ./
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 10000
CMD ["sh", "-c", "dotnet backend.dll --urls http://0.0.0.0:${PORT:-10000}"]