# ReactJS Learning – Backend API

Mock REST API (Node.js + Express) for the **Secure Multi-Page Course Management Dashboard** assignment
(React Router, authentication, authorization). Data is stored **in memory** and re-seeded on every start.

## Quick start

Requirements: Node.js 20+.

```bash
git clone https://github.com/vunt286/reactjs-learning-backend-api.git
cd reactjs-learning-backend-api
npm install
cp .env.example .env      # optional, defaults work for a Vite app on http://localhost:5173
npm start                 # or: npm run dev (auto-restart)
```

The server listens on `http://localhost:3000`. Check it: `curl http://localhost:3000/health`.

Run the tests: `npm test`.

## Demo accounts

Password for every account: `Password123!`

| Email | Role | Notes |
|---|---|---|
| `admin@demo.com` (`u1`) | admin | Full access, incl. `/admin/*` |
| `teacher1@demo.com` (`u2`) | instructor | Owns some courses |
| `teacher2@demo.com` (`u3`) | instructor | Owns other courses |
| `student@demo.com` (`u4`) | student | Read-only |

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed frontend origins |
| `ACCESS_TOKEN_TTL_SECONDS` | `120` | Access session lifetime. Keep it short to practice expiry/refresh |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800` | Refresh session lifetime (7 days) |
| `COOKIE_SAMESITE` | `lax` | `lax`, `strict` or `none` |
| `COOKIE_SECURE` | `false` (`true` when `NODE_ENV=production`) | Required `true` when `COOKIE_SAMESITE=none` |
| `LATENCY_MS` | `0` | Artificial delay for every request |
| `ENABLE_DEBUG_ROUTES` | `true` (`false` in production) | Enables `/debug/*`, `?_delay`, `?_fail` |

## CORS configuration

Authentication uses **HttpOnly cookies**, so CORS must allow credentials:

1. Add your frontend origin to `CORS_ORIGINS` (exact match: scheme + host + port, no trailing slash), e.g.
   `CORS_ORIGINS=http://localhost:5173,https://my-dashboard.vercel.app`.
   Wildcards (`*`) are **not** used because browsers reject `*` together with credentials.
2. The API sends `Access-Control-Allow-Origin: <your origin>` and `Access-Control-Allow-Credentials: true`
   for allowed origins only. Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Allowed headers: `Content-Type, Authorization`.
3. In the frontend, **always send credentials**:
   ```ts
   fetch(`${API_URL}/courses`, { credentials: "include" });
   // Axios: axios.create({ baseURL: API_URL, withCredentials: true })
   ```
4. Same-site setups (`localhost:5173` → `localhost:3000`) work with the default `COOKIE_SAMESITE=lax`.
   If the frontend and API are on **different sites** in production (e.g. `app.vercel.app` → `api.onrender.com`), use HTTPS and set
   `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, and `NODE_ENV=production`.
5. Alternative without CORS: proxy through Vite (`server.proxy: { "/api": "http://localhost:3000" }`) so the browser sees one origin.
6. State-changing requests (`POST/PUT/PATCH/DELETE`) with an `Origin` header that is not in `CORS_ORIGINS` are rejected with `403 ORIGIN_NOT_ALLOWED` (CSRF defense in depth).

Troubleshooting: a CORS error in the console usually means the origin is missing from `CORS_ORIGINS`, the server was not restarted after editing `.env`, or `credentials: "include"` is missing.

## Sessions and security notes

- `POST /auth/login` sets two cookies: `access_token` (short-lived, path `/`) and `refresh_token` (path `/auth`, single use / rotated). Both are `HttpOnly`.
- Bearer tokens in the `Authorization` header are also accepted by protected endpoints (useful for Postman/curl), but the frontend should rely on cookies.
- Sessions are kept in server memory: restarting the server logs everyone out.
- Failed logins return the same generic message for unknown emails and wrong passwords. 5 failures per email+IP in 5 minutes return `429`.
- **Authorization is enforced on the server for every request** (`src/permissions.js`). The client-side checks are only UX.

## Error format

Every error uses the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "fieldErrors": { "title": "Title already exists" } } }
```

| Status | Codes | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` | Not logged in / expired. Try `/auth/refresh` once, then go to login |
| 403 | `FORBIDDEN`, `COURSE_PUBLISHED`, `ORIGIN_NOT_ALLOWED` | Authenticated but not allowed. Do **not** log out |
| 404 | `NOT_FOUND` | Unknown route/id, **or a private course the user may not see** |
| 409 | `CANNOT_DEMOTE_SELF` | Conflict |
| 422 | `VALIDATION_ERROR` | Invalid body/query. `fieldErrors` maps field → message (use with `setError`) |
| 429 | `TOO_MANY_ATTEMPTS` | Login rate limit |

## Endpoints

### Auth

| Method & path | Auth | Description |
|---|---|---|
| `POST /auth/login` | – | Body `{ email, password }`. Sets cookies, returns `{ user }` |
| `POST /auth/logout` | – | Destroys the session, clears cookies, `204` |
| `POST /auth/refresh` | refresh cookie | Rotates tokens, returns `{ user }`. `401 SESSION_EXPIRED` if invalid |
| `GET /me` | access | Returns `{ user: { id, email, name, role, permissions[] } }` |

### Courses (all require login)

| Method & path | Permission | Description |
|---|---|---|
| `GET /courses` | login | Query: `q`, `status` (`all\|draft\|published\|archived`), `sort` (`title\|createdAt\|price`), `order` (`asc\|desc`), `page` (≥1), `pageSize` (1–50, default 10). Returns `{ items, total, page, pageSize, totalPages }`. A `page` beyond `totalPages` returns empty `items` so the client can clamp |
| `GET /courses/:id` | login | Course or `404` (invalid id / not visible) |
| `POST /courses` | `course:create` | Create (`201`). Instructors are always the owner; admins may pass `instructorId` |
| `PUT /courses/:id` | owner or admin | Full update |
| `PATCH /courses/:id` | owner or admin | Partial update |
| `DELETE /courses/:id` | owner or admin | `204`. Published courses → `403 COURSE_PUBLISHED` |
| `POST /courses/:id/publish` | owner or admin | Sets status `published` |
| `POST /courses/:id/unpublish` | owner or admin | Sets status `draft` |

Course fields: `id`, `title` (3–120), `description` (≤500), `instructorId`, `instructorName`, `status`, `price` (≥0), `startDate`, `endDate` (`YYYY-MM-DD`, must be after `startDate`), `createdAt`, `updatedAt`.
Every course also has `permissions: { canEdit, canDelete, canPublish }` computed for the current user. Titles must be unique (`422` with `fieldErrors.title`, useful for server-error mapping).

Visibility: everyone sees **published** courses; instructors also see their **own** drafts/archived; admins see everything. Anything else returns `404`.

### Instructors and admin

| Method & path | Permission | Description |
|---|---|---|
| `GET /instructors` | login | List instructors |
| `GET /instructors/:id` | login | `{ id, name, email, bio, courseCount }` (for dependent queries) |
| `GET /admin/users` | `user:manage` | List users (`403` otherwise) |
| `PATCH /admin/users/:id/role` | `user:manage` | Body `{ role }`. Takes effect immediately, so a user's next request can return `403` and `/me` shows the new role |

### Permission matrix

| Permission | admin | instructor | student |
|---|---|---|---|
| `course:create` | ✅ | ✅ | ❌ |
| `course:update` | ✅ | ✅ own courses | ❌ |
| `course:publish` | ✅ | ✅ own courses | ❌ |
| `course:delete` | ✅ unpublished only | ✅ own, unpublished only | ❌ |
| `user:manage` | ✅ | ❌ | ❌ |

## Practice helpers (disabled when `ENABLE_DEBUG_ROUTES=false`)

| Helper | Purpose |
|---|---|
| `POST /debug/reset` | Re-seed data, clear sessions and login attempts |
| `POST /debug/expire-access` | Expire the current access token (the next request returns `401 SESSION_EXPIRED`; `/auth/refresh` still works) |
| `POST /debug/revoke-session` | Destroy access **and** refresh tokens (refresh fails → force logout) |
| `?_delay=1500` on any request | Delay the response (race conditions, pending UI) |
| `?_fail=500` on any request | Force an error status (error boundaries, retry UI) |

## Project structure

```
src/
  app.js          Express app, CORS, CSRF origin check, debug query params
  server.js       Entry point
  config.js       Environment config
  auth.js         Sessions, cookies, authenticate middleware
  permissions.js  Roles, permissions, can(), canView()
  store.js        In-memory data and seed
  errors.js       ApiError and error handlers
  routes/         auth, courses, people (instructors/admin), debug
test/api.test.js  Integration tests (node:test)
```
