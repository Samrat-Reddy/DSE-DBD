# Frontend — Insurance Policy Management System

React + Vite (JavaScript) single-page application. This is the project
foundation only; no business modules are implemented yet.

## Getting started

```bash
npm install
cp .env.example .env   # adjust VITE_API_BASE_URL if needed
npm run dev
```

## Scripts

| Command            | Purpose                              |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start the Vite dev server (port 5173)|
| `npm run build`    | Production build into `dist/`        |
| `npm run preview`  | Serve the production build locally   |
| `npm run lint`     | Run ESLint                           |
| `npm run lint:fix` | Run ESLint with autofix              |
| `npm test`         | Run the test suite (Node test runner)|

## Folder structure

```
src/
├── assets/            Static images, icons, fonts
├── components/
│   └── common/        Reusable presentational components
├── layouts/           Page shells rendering routed children
├── pages/             Route-level screens
├── routes/            Route table (AppRoutes)
├── services/          API client, endpoint registry, feature services
├── data/              Mock / seed data, kept out of components
├── styles/            Global CSS and design tokens
├── utils/             Config, constants, formatters
├── App.jsx            Router provider
└── main.jsx           React entry point
```

## Architecture rules

- **No hardcoded API URLs.** The base URL is read once in
  [`src/utils/config.js`](src/utils/config.js) from `VITE_API_BASE_URL`; paths
  live in [`src/services/endpoints.js`](src/services/endpoints.js).
- **UI never calls `fetch` directly.** Components call service functions,
  which use the shared client in
  [`src/services/apiClient.js`](src/services/apiClient.js).
- **Mock data stays in `src/data/`**, never inline in a component.
- **Components stay reusable** — presentational, prop-driven, no business rules.

## Connecting to FastAPI later

1. Point `VITE_API_BASE_URL` at the FastAPI service (default
   `http://localhost:8000/api/v1`).
2. Add the new paths to `src/services/endpoints.js`.
3. Add a service module per feature next to `healthService.js`.
4. Enable CORS for the dev origin on the FastAPI side.
