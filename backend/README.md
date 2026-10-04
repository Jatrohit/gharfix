# GharFix Backend (Node.js + Express + MySQL)

REST API for the GharFix home-service marketplace: customers find and book verified local professionals;
professionals manage requests; admins verify professionals and monitor the platform.

> **What was inspected:** the only frontend available in this project is the single-file `index.html`
> (HTML + CSS + vanilla JS) built earlier. The API field names and flows below are matched to *that* file.
> A patched copy that talks to this backend is in `../frontend-integration/` (see section 7).
>
> **What was tested:** all 151 API checks in `tests/smoke.js` and a 30-step jsdom run of the patched frontend
> passed against a live server on **MariaDB 10.11**. The SQL uses only features common to MariaDB and
> **MySQL 8.0+**, but it has not been executed on a real MySQL 8 server here.

---

## 1. Project structure

```
backend/
├── server.js                 app setup: helmet, CORS, rate limit, routes, errors, graceful shutdown
├── database.sql              schema + indexes + FKs + DEMO data
├── package.json
├── .env.example              copy to .env (never commit .env)
├── config/
│   ├── env.js                loads + validates environment (fails fast on a missing/weak JWT_SECRET)
│   └── db.js                 mysql2 pool, query() helper, withTransaction()
├── middleware/
│   ├── authMiddleware.js     authenticateToken, authorizeRole, loadProfessional
│   ├── errorMiddleware.js    notFound + central errorHandler (maps DB/JWT/multer errors, no leaks)
│   └── uploadMiddleware.js   Multer (disk) + real image-signature check
├── controllers/              auth, user, service, professional, booking, review, admin
├── routes/                   one router per controller
├── models/                   all SQL lives here (parameterized queries only)
├── utils/
│   ├── validators.js         express-validator rules + one 422 response format
│   ├── bookingRules.js       date/time validation, price calculation
│   ├── bookingWorkflow.js    the ONE place booking status changes are validated + applied
│   ├── constants.js          roles, statuses, allowed transitions, time slots
│   ├── mappers.js            DB row -> API JSON (hides phone/address until a booking is accepted)
│   ├── generateToken.js, helpers.js, AppError.js, asyncHandler.js, apiResponse.js
├── tests/smoke.js            151 end-to-end checks (npm run smoke)
└── uploads/profiles/         profile images (served at /uploads/...)
```

CommonJS (`require`) is used everywhere; there is no ES-module syntax anywhere.

## 2. Database design

```
users 1──0..1 professionals ──* bookings *──1 users(customer)
                  │                │
services 1────────┘ (service_id)   └──0..1 reviews (UNIQUE booking_id)
services 1──* bookings
```

| Table | Notes |
|---|---|
| `users` | `role` customer / professional / admin; unique `email` and `phone` (10 digits); bcrypt `password`; `is_active=0` = suspended |
| `services` | `slug` unique; `starting_price` is the base price; `is_active` hides a service without deleting history |
| `professionals` | one row per professional user; `verification_status` (admin only), `rating` / `total_reviews` / `completed_jobs` are **computed by the backend**, never accepted from a client |
| `bookings` | FKs to customer, professional, service; `estimated_price` (server-calculated), `final_price`, `status`, **`booking_source`** (`web` default, `admin`, `phone`, `whatsapp`), `contact_phone` (the phone typed in the booking form) |
| `reviews` | `UNIQUE(booking_id)` = one review per booking; `rating` 1-5 (CHECK constraint + validation) |

Extra columns beyond your spec (all deliberate): `users.is_active` (suspension), `bookings.contact_phone`.

### Booking status flow

```
pending ──accept──▶ accepted ──start──▶ in_progress ──complete──▶ completed
   │  ╲                 │  ╲
   │   reject──▶ rejected  ╲──(admin) confirm──▶ confirmed ──start──▶ in_progress
   └─cancel (customer)─▶ cancelled      (customer can cancel from pending / accepted / confirmed)
```

Who may do what is defined once in `utils/constants.js` (`ACTOR_TRANSITIONS`) and enforced by
`utils/bookingWorkflow.js` with an atomic `UPDATE ... WHERE status IN (...)` so double-clicks and races
cannot double-complete a job or double-count `completed_jobs`.
`confirmed` is reserved for admin/operator confirmation (phone/WhatsApp workflow, later payments).

### Business rules implemented on the backend

* Booking requires: logged-in **customer**, active service, **approved + active + `available`** professional that provides that service,
  valid future date (max 60 days ahead, IST), valid time slot (not already past if today), no clash with an accepted/in-progress job of that professional.
* Price: `estimated_price` = professional's `starting_price` (else service base price). **Any price sent by the browser is ignored.**
  `final_price` is set by the professional (`PUT /bookings/:id/price` or in `complete`) or admin. Response includes `price_status: "estimated" | "final"`.
* "Koi bhi available professional" (frontend option) = `professional_id` omitted → backend picks the best free match in the customer's city/pincode.
* Contact details are private: a customer sees the professional's phone, and the professional sees the customer's phone and full address, **only after the booking is accepted**.
* Reviews: only the customer of a **completed** booking, once per booking; rating is recalculated from the `reviews` table in the same transaction. Admin removal recalculates too.
* Professionals cannot change `verification_status`, `rating`, `total_reviews`, `completed_jobs`, or role (those fields are not read from the request at all).
* Suspending a user blocks their existing token immediately (the user is re-loaded from the DB on every request).

## 3. Setup (exact commands)

Requirements: Node.js 18+ and MySQL 8 (or MariaDB 10.5+).

```bash
# 1. Go into the backend folder (it is already created for you)
cd backend

# 2. Install dependencies  (package.json already lists them; this is what was used)
npm install
#   from scratch it would be:
#   npm init -y
#   npm install express@4 mysql2 bcryptjs jsonwebtoken cors dotenv helmet express-rate-limit express-validator multer
#   npm install --save-dev nodemon

# 3. Create the database + tables + demo data
mysql -u root -p < database.sql
#   (creates database `home_services`; safe to re-run, it does not drop anything)

# 4. Configure environment
cp .env.example .env            # Windows: copy .env.example .env
#   edit .env: DB_USER, DB_PASSWORD, and set a real JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5. Run
npm run dev        # auto-restart on changes (nodemon)
npm start          # plain node, for production

# 6. Check it
curl http://localhost:5000/api/health
npm run smoke      # optional: 151 end-to-end checks against the running server (dev database only)
```

**Recommended: use a dedicated MySQL user instead of root**
```sql
CREATE USER 'gharfix'@'localhost' IDENTIFIED BY 'a-strong-password';
GRANT ALL PRIVILEGES ON home_services.* TO 'gharfix'@'localhost';
```
then set `DB_USER=gharfix` / `DB_PASSWORD=...` in `.env`.

**Demo accounts** (created by `database.sql`; password for all: `Demo@1234`; **delete before going live**):

| Role | Login | Endpoint |
|---|---|---|
| Admin | `admin@gharfix.demo` | `POST /api/auth/login` |
| Customers | `neha@gharfix.demo`, `amit@gharfix.demo`, `sunita@gharfix.demo` | `POST /api/auth/login` |
| Professionals | `rajesh@` (Electrician), `imran@` (AC), `suresh@` (Plumber), `deepak@` (Carpenter, *busy*) `@gharfix.demo` | `POST /api/auth/professional/login` |
| Pending professional | `salim@gharfix.demo` (RO) - use it to try admin approval | `POST /api/auth/professional/login` |

### Connecting the frontend

1. Serve the frontend over HTTP so the browser sends a normal `Origin` header, e.g. VS Code **Live Server**
   (`http://127.0.0.1:5500`) or `npx serve`. That exact origin is already in `CORS_ORIGINS`.
2. CORS is an **allow-list** (`CORS_ORIGINS=origin1,origin2`), never `*`. Add your real domain(s) there for production.
3. Double-clicking `index.html` (`file://`) sends `Origin: null`. For local development only you may set `CORS_ALLOW_FILE_ORIGIN=true`; it is ignored when `NODE_ENV=production`.
4. Copy `frontend-integration/index.html` and `gharfix-api.js` next to each other. The API URL defaults to `http://localhost:5000/api`;
   change it with `<script>window.GHARFIX_API_URL="https://api.example.com/api"</script>` before loading `gharfix-api.js`.

## 4. Response format

```jsonc
// success                                     // list with pagination
{ "success": true, "message": "...", "data": {} }   { "success": true, "message": "...", "data": [], "pagination": { "page": 1, "limit": 10, "total": 20, "totalPages": 2 } }

// error (always this shape; `code` is present for machine-readable cases, `errors` for validation)
{ "success": false, "message": "Something went wrong", "code": "SLOT_TAKEN" }
{ "success": false, "message": "Enter a valid 10-digit Indian mobile number", "errors": [ { "field": "phone", "message": "..." } ] }
```

Status codes used: 200, 201, 400 (bad JSON / bad upload), 401 (no/invalid/expired token, wrong login), 403 (wrong role / suspended),
404, 409 (duplicate, slot taken, wrong booking state, unavailable/unverified professional), 413 (upload too large),
422 (validation), 429 (rate limited), 500, 503 (database unreachable).

## 5. API reference + Postman examples

Base URL `http://localhost:5000`. In Postman create an environment variable `token` and use `Authorization: Bearer {{token}}`
(Auth tab → Bearer Token → `{{token}}`). Protected requests below say **Auth: Bearer**. JSON requests need `Content-Type: application/json`.
Tip: in the *Tests* tab of the login request: `pm.environment.set("token", pm.response.json().data.token)`.

### Auth

| | |
|---|---|
| **Register customer** | `POST /api/auth/register` |
| Body | `{ "name":"Priya Singh", "email":"priya@example.com", "phone":"9876501234", "password":"Secret123", "city":"Delhi" }` (optional: `address`, `locality`, `pincode`) |
| Response 201 | `{ "success":true, "message":"Registration successful", "data":{ "user":{ "id":6, "role":"customer", ... }, "token":"eyJ..." } }` |
| Errors | 409 duplicate email/phone, 422 weak password / bad phone. A `role` in the body is ignored. |

| | |
|---|---|
| **Customer / admin login** | `POST /api/auth/login` |
| Body | `{ "email":"neha@gharfix.demo", "password":"Demo@1234" }` (`email` may also be a 10-digit phone, `+91` accepted) |
| Response 200 | `{ "success":true, "message":"Login successful", "data":{ "user":{...}, "token":"eyJ..." } }` |
| Errors | 401 `Invalid email/phone or password` (same message for unknown user / wrong password / wrong portal), 403 suspended |

| | |
|---|---|
| **Professional register** | `POST /api/auth/professional/register` - JSON **or** `multipart/form-data` (optional file field `profile_image`) |
| Body | `{ "name":"Ravi Kumar", "email":"ravi@example.com", "phone":"9876511111", "password":"Secret123", "service_id":1, "experience_years":5, "starting_price":249, "service_area":"Rohini, Pitampura", "city":"Delhi", "pincode":"110085", "bio":"..." }` |
| Response 201 | `data.professional.verification_status = "pending"`; message: *Registration received. Your profile will go live after admin verification.* |

| | |
|---|---|
| **Professional login** | `POST /api/auth/professional/login` - same body as login; response also contains `data.professional` |
| **Current user** | `GET /api/auth/me` - **Auth: Bearer** → `{ data:{ user, professional? } }` |
| **Logout** | Frontend deletes the token (`GharFixAPI.logout()`); JWTs are stateless |

### Services (public read, admin write)

```
GET    /api/services                      → active services (icon, description, starting_price)
GET    /api/services/3   or  /api/services/ac-repair
POST   /api/services      Auth: Bearer (admin)   { "name":"Water Tank Cleaning", "starting_price":599, "icon":"💧", "description":"..." }   → 201
PUT    /api/services/15   Auth: Bearer (admin)   { "starting_price":649, "is_active":true }
DELETE /api/services/15   Auth: Bearer (admin)   → deleted; if the service has professionals/bookings it is deactivated instead
```

### Professionals (public)

```
GET /api/professionals                    same filters as /search
GET /api/professionals/search?service=electrician&city=Delhi&pincode=110085
GET /api/professionals/service/2
GET /api/professionals/1
GET /api/professionals/1/reviews?page=1&limit=10
```
Query filters: `service` (slug / name / id), `city`, `locality` (tolerant: "Rohini Sector 23" matches "Rohini"), `pincode`,
`min_rating`, `availability` (available|busy|offline), `experience` (min years), `price` (max starting price),
`sort` (rating|experience|price|completed_jobs), `order` (asc|desc), `page`, `limit` (max 50).
Only **approved, active** professionals are returned. Phone/email are never public.

Example response item: `{ "id":1, "name":"Rajesh Kumar", "profession":"Electrician", "service":{"id":1,"name":"Electrician","slug":"electrician","icon":"⚡"}, "experience_years":8, "starting_price":299, "service_area":"Rohini, Pitampura, Shalimar Bagh", "city":"Delhi", "pincode":"110085", "rating":5, "total_reviews":1, "completed_jobs":2, "availability_status":"available", "is_verified":true, "profile_image":null }`

Professional's own profile (**Auth: Bearer, professional**):
```
GET /api/professionals/me/profile
PUT /api/professionals/me/profile   JSON or multipart (profile_image)
    { "bio":"...", "experience_years":9, "starting_price":349, "service_area":"Rohini, Pitampura", "availability_status":"busy", "name":"...", "phone":"9876500000" }
```
Sending `rating`, `completed_jobs`, `verification_status`, `total_reviews` is silently ignored.

### Customer profile (**Auth: Bearer**)
```
GET /api/users/me
PUT /api/users/me           { "name":"...", "phone":"...", "address":"...", "locality":"...", "city":"...", "pincode":"110085" }   or multipart with profile_image
PUT /api/users/me/address   { "address":"House 5, Sector 7", "locality":"Rohini", "city":"Delhi", "pincode":"110085" }
```

### Bookings - customer (**Auth: Bearer, customer**)

**Create:** `POST /api/bookings`
```json
{
  "service_id": 2,
  "professional_id": 3,
  "location": "Pitampura",
  "preferred_date": "2026-10-06",
  "preferred_time": "3 PM – 6 PM",
  "contact_phone": "9811122233",
  "problem_description": "Kitchen tap leaking",
  "customer_notes": "Please call before arriving"
}
```
* Service can be sent as `service_id` **or** `service` (name/slug). `professional_id` is optional (auto-assign).
* Location: send `location` (what the frontend has: one box) **or** `address`, `locality`, `city`, `pincode`. If none are sent, the customer's saved profile address is used.
* `preferred_time`: one of `9 AM – 12 PM`, `12 PM – 3 PM`, `3 PM – 6 PM`, `6 PM – 9 PM` (hyphen also accepted) or `HH:MM` (07:00-21:00).
* Any `estimated_price` / `status` / `booking_source` sent is ignored.

Response **201**:
```json
{ "success": true, "message": "Booking created successfully",
  "data": { "id": 11, "status": "pending", "booking_source": "web",
    "service": { "id": 2, "name": "Plumber", "slug": "plumber", "icon": "🚰" },
    "professional": { "id": 3, "name": "Suresh Yadav", "profile_image": null, "phone": null },
    "customer": { "id": 2, "name": "Neha Verma", "phone": "9811122233" },
    "address": "Pitampura", "locality": "Pitampura", "city": "Delhi", "pincode": null,
    "preferred_date": "2026-10-06", "preferred_time": "3 PM – 6 PM",
    "estimated_price": 199, "final_price": null, "price_status": "estimated",
    "can_review": false, "has_review": false } }
```
Typical errors: 401 not logged in · 403 not a customer · 404 service/professional not found, or `NO_PROFESSIONAL` · 409 `PROFESSIONAL_UNAVAILABLE`, `PROFESSIONAL_NOT_VERIFIED`, `SLOT_TAKEN` · 422 past/invalid date, invalid time, missing location, professional does not provide the service.

```
GET /api/bookings/my-bookings?status=pending&page=1&limit=10
GET /api/bookings/11                (customer owner, the assigned professional, or admin; anyone else gets 404)
PUT /api/bookings/11/cancel         (allowed from pending / accepted / confirmed)
```

### Bookings - professional (**Auth: Bearer, professional**)
```
GET /api/bookings/professional?status=pending      (customer phone + full address hidden until accepted)
PUT /api/bookings/11/accept
PUT /api/bookings/11/reject
PUT /api/bookings/11/start                          (from accepted / confirmed)
PUT /api/bookings/11/price      { "final_price": 450 }        (while accepted / confirmed / in_progress)
PUT /api/bookings/11/complete   { "final_price": 450 }        (body optional; falls back to the price already set, then the estimate)
```
`complete` also increments the professional's `completed_jobs` (once, atomically).

### Reviews
```
POST /api/reviews      Auth: Bearer (customer)     { "booking_id": 11, "rating": 5, "review": "Bahut accha kaam" }
```
Response 201: `{ "data": { "review": {...}, "professional": { "id":3, "rating":4.7, "total_reviews":3 } } }`
Errors: 404 not your booking · 409 `BOOKING_NOT_COMPLETED` / `DUPLICATE_REVIEW` · 422 rating outside 1-5.
Public list: `GET /api/professionals/3/reviews` (customer names are shown as "Neha V.").

### Admin (**Auth: Bearer, admin**)
```
GET  /api/admin/dashboard      → total_customers, total_professionals, verified_professionals, pending_professionals,
                                 rejected_professionals, total_bookings, pending_bookings, completed_bookings,
                                 cancelled_bookings, total_services, total_reviews
GET  /api/admin/users?role=customer&search=neha&page=1
GET  /api/admin/professionals?status=pending        (status: pending | approved | rejected | suspended)
PUT  /api/admin/professionals/5/approve | reject | suspend | reinstate
GET  /api/admin/bookings?status=pending
PUT  /api/admin/bookings/11     { "status": "confirmed" }   and/or   { "final_price": 499 }
GET  /api/admin/services        (includes inactive)   POST/PUT/DELETE /api/admin/services[/:id]  (same as /api/services)
GET  /api/admin/reviews
DELETE /api/admin/reviews/4     (removes it and recalculates the professional's rating)
```
Admin status changes still follow the allowed-transition table (e.g. cannot move a completed booking back to pending).

## 6. Security checklist (what is in the code)

* **Helmet** headers; `x-powered-by` removed; **CORS allow-list**; JSON body limit 100 KB.
* **Rate limiting:** 300 requests / 15 min per IP on `/api`, and 20 / 15 min on register/login (both configurable in `.env`).
* **bcrypt** (cost 12, `BCRYPT_ROUNDS`) - passwords are never stored or returned; login does a dummy hash compare for unknown users so timing does not reveal valid emails.
* **JWT** `{ id, role }`, expiry `JWT_EXPIRES_IN` (default 7d). The user and **role are re-read from the database on every request**; a token whose role no longer matches is rejected.
  The server refuses to start without `JWT_SECRET`, and in production without a 32+ character secret.
* **SQL injection:** every query is parameterized (`mysql2` prepared statements). The only interpolated pieces are whitelisted sort columns and clamped integers for `LIMIT/OFFSET`. `LIKE` input is escaped.
* **Validation:** express-validator on every route (422 with field list). Phone numbers are normalised (`+91 98765-43210` → `9876543210`).
* **Uploads:** JPG/PNG/WEBP only, 2 MB, random file names, real file-signature check, files removed when the request fails.
* **No raw errors:** unknown errors return `Something went wrong` and are logged server-side only.
* **Output escaping:** API text is stored as-is; the patched frontend HTML-escapes everything it renders (`esc()`), so a hostile professional name cannot inject script.

### Before real launch (not done by this MVP)
* Delete the demo users in `database.sql`, use HTTPS (put Nginx/Caddy in front, set `TRUST_PROXY=1`), set `NODE_ENV=production`.
* Add: password reset, email/phone OTP verification, refresh-token or shorter-lived tokens, admin audit log, database backups, structured logging, tests in CI.
* Local `uploads/` is fine for one server; use Cloudinary/S3 when you scale (swap the Multer storage in `middleware/uploadMiddleware.js`; the DB already stores a path/URL string).
* `created_at` / `updated_at` are in the database server's timezone (usually UTC); booking dates/times are interpreted in `APP_TIMEZONE` (default Asia/Kolkata).
* A professional has exactly one `service_id` (as in your spec). Multi-service professionals need a join table later.

## 7. Frontend integration - exactly what changed

Files (in `../frontend-integration/`): `gharfix-api.js` (new, ~100 lines), `index.html` (your page, patched), `index.original.html` (untouched), `index.html.diff` (every changed line).
**No CSS or layout was changed.** The only added markup is a small login/sign-up modal built from your existing `.ov / .mc / .in / .btn` classes.

| Frontend piece (element / function) | Before | Now calls | Fields |
|---|---|---|---|
| Service cards `renderSv()` (`#sg`) | hard-coded `SV` array | `GET /api/services` in `init()` | `icon, name, description, id` → `SV` rows `[icon, name, description, id]` |
| Professional cards `renderPros()` (`#pg`) | hard-coded `PR` | `GET /api/professionals/search?...` in `loadPros()` | `name→n, profession→s, rating→r ("New" if 0), experience_years→e, completed_jobs→j, starting_price→p, availability_status→a, id` |
| Service card click (`data-svc`) | local filter | `loadPros()` with `service=<name>` | `service` |
| Hero search `#hf` (`#hq`, `#hl`) | local match | match service name, then `loadPros({ locality })` | `service`, `locality` = selected area |
| Location search `#lf` (`#li`) | toast only | `loadPros({ pincode })` for 6 digits, else `{ locality }` | `pincode` / `locality` |
| Emergency button `#urg` | all pros | `loadPros({ availability:'available' })` | `availability=available` |
| Login link `#lg` + new modal `#am` | toast | `POST /api/auth/login` / `POST /api/auth/register`; token saved in `localStorage` | `email, password` / `name, email, phone, password` |
| Booking modal service/pro selects `#fs`, `#fp` | names | option **values are ids**; `#fp` is loaded with `GET /api/professionals/search?service=...` | `service_id`, `professional_id` (empty = any available) |
| Booking form submit `#f` → `submitBooking()` | fake success | `POST /api/bookings` (login required; opens the login modal and then continues the booking automatically) | see mapping below |
| Booking success view `#ok`/`#sm` | random ref | shows `Ref GF-<id>` and the **server-calculated** estimated price | `data.id`, `data.estimated_price` |

**Booking form → API field mapping**

| Form field | JS | API field |
|---|---|---|
| Service `#fs` | `Number($('#fs').value)` | `service_id` |
| Professional `#fp` | id or empty | `professional_id` (omit = auto-assign) |
| Location `#fl` | text | `location` (parsed into locality / pincode by the server) |
| Preferred Date `#fd` | `YYYY-MM-DD` | `preferred_date` |
| Preferred Time `#ft` | slot label | `preferred_time` |
| Phone Number `#fh` | text | `contact_phone` |

Minimal call, if you prefer to wire it into your own code (matches the example in your brief):
```js
fetch("http://localhost:5000/api/bookings", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify({ service_id, professional_id, location, preferred_date, preferred_time, contact_phone })
}).then(r => r.json());   // { success, message, data } or { success:false, message }
```
Errors from the server (`message`) are shown as toasts / inline in the login modal. A 401 clears the stored token and re-opens the login modal.

Not wired yet (API exists, UI would be new): professional registration/login screens, "My bookings" page, review form, "View Profile" page.
`View Profile` / `Join as a Professional` still show the demo toast so no UI was invented.

## 8. Future-ready hooks (nothing implemented beyond the structure)

| Later feature | Where it plugs in |
|---|---|
| Phone-call / WhatsApp / operator bookings | `bookings.booking_source` already exists; add `POST /api/admin/bookings` that calls the same create logic with `booking_source='phone'` (demo booking #5 shows it) |
| Payments / UPI / wallet / commission | new `payments` table keyed by `booking_id`; trigger from `utils/bookingWorkflow.js` (`confirmed` is already reserved for "payment received") |
| SMS / email / WhatsApp notifications | emit from `changeStatus()` after the transaction commits - one place covers every status change |
| Live tracking, maps | new table + routes; `bookings` already stores locality/pincode/city |
| Coupons, subscriptions | extra columns/tables read inside `calculateEstimatedPrice()` in `utils/bookingRules.js` |
| Emergency bookings | a flag on `bookings` + a priority branch in the auto-assign query (`findAvailableCandidates`) |
| AI support assistant | read-only endpoints already return clean JSON; add a separate `assistant` router |
