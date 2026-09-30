# Backend — Insurance Policy Management System

FastAPI + SQLAlchemy 2.x + MySQL 8. Implemented so far:

- **Foundation:** configuration, database access, migrations, error handling,
  logging and health checks.
- **Authentication and RBAC:** `users` and `roles` tables, Argon2 passwords, JWT
  login, the current-user dependency and role checks.
- **Module 1, Policy Catalog & Issuance:** product catalog, agents, customers
  and policies in MySQL. The API handles the catalog, the scoped policy register
  and transactional issuance, and the frontend's Module 1 screens use it.

- **Module 2, Premium Schedule & Payments:** a premium schedule and instalments
  for every issued policy (created in the issuance transaction), transactional
  payment recording with row locking and duplicate protection. The frontend's
  Module 2 screens use it.

- **Module 3, Claim Filing & Approval Workflow:** claims with an explicit state
  machine, one endpoint per workflow action, row-locked transactional
  transitions and an append-only history. The frontend's Module 3 screens use it.

Modules 4–6 (renewals, commissions, MIS reports) are not on the backend yet.
Their frontend screens still use mock data.

## Architecture

```
React (Vite, :5173)
   │  JSON over HTTP, base URL http://localhost:8000/api/v1
   ▼
FastAPI  ── routers (app/api) → services → SQLAlchemy Session (per request)
   │
   ▼
SQLAlchemy 2.x ORM  (PyMySQL driver, pooled engine)
   │
   ▼
MySQL 8  ◄── schema managed by Alembic, inspected with MySQL Workbench
```

| Path | Purpose |
| --- | --- |
| `app/main.py` | App factory: CORS, exception handlers, routers, startup/shutdown |
| `app/core/config.py` | The single `Settings` object, loaded from env / `.env` |
| `app/core/exceptions.py` | `AppError` hierarchy + handlers producing one JSON error shape |
| `app/core/logging.py` | JSON-lines logging to stdout |
| `app/core/security.py` | `hash_password` / `verify_password` (Argon2id), JWT create/decode |
| `app/db/session.py` | Engine, `SessionLocal`, `get_db` dependency |
| `app/db/base.py` | `Base`, naming convention, `IntPK`, `Money`, `TimestampMixin`, `code_string` |
| `app/models/` | ORM models: `Role`, `User`, `Product` (+ options/features), `Agent`, `Customer`, `Policy`, `IdSequence`; `enums.py` |
| `app/schemas/` | Pydantic request/response models (`policies.py` for Module 1) |
| `app/repositories/` | Queries, never commit: `users.py`, `catalog.py`, `policies.py` (incl. number sequences) |
| `app/services/` | `auth.py`, `users.py`, `catalog.py`, `policies.py` (scope + issuance), `pricing.py` |
| `app/api/deps.py` | `get_current_user`, `CurrentUser`, `require_role`, `require_any_role` |
| `app/api/routes/` | `health.py`, `auth.py`, `users.py`, `products.py`, `policies.py` |
| `app/scripts/` | `seed_dev_users.py`, `seed_dev_data.py` (+ `seed_data/module1.json`, `module2.json`), `backfill_premium_schedules.py` |
| `alembic/` | Migrations: `0001_baseline` (empty), `0002_roles_users`, `0003_policy_catalog`, `0004_premium_payments` |
| `sql/create_database.sql` | One-off MySQL Workbench script: schemas + app user |
| `tests/` | pytest: unit tests + real-MySQL integration tests |

**Layering rule.**
- **Routes** stay thin: parse the request, call a service, return a schema.
- **Services** own business rules and the transaction boundary. Each public
  service function commits exactly once.
- **Repositories** only query and never commit. A domain gets a repository only
  when it has real query logic worth reusing or testing on its own. Wrapping
  `session.add()` is not a reason to add one.

## Prerequisites

- Python 3.12+ (developed on 3.13)
- MySQL Server 8.0+ running locally (Windows service `MySQL80`)
- MySQL Workbench 8.0

## Development workflow

All commands run from `backend/`. Examples are PowerShell. In Git Bash, activate
the virtualenv with `source .venv/Scripts/activate`.

### 1. Start MySQL

MySQL runs as a Windows service. Check it with `Get-Service MySQL80`, and start
it with `Start-Service MySQL80` (from an admin shell) if it is stopped.

### 2. Create the database and application user (MySQL Workbench, once)

1. Open MySQL Workbench and connect to **Local instance MySQL80** as `root`.
2. **File → Open SQL Script…** → `backend/sql/create_database.sql`.
3. Replace every `CHANGE_ME` with a password of your own. Don't save the
   edited file back into the repo.
4. **Query → Execute (All or Selection)** (`Ctrl+Shift+Enter`).
5. Refresh the **Schemas** panel: `ipms` and `ipms_test` now appear.

This creates:
- `ipms`: the application database (utf8mb4).
- `ipms_test`: a disposable schema for integration tests.
- `ipms_app`: a non-root user with privileges on those two schemas only.

### 3. Configure `.env`

```powershell
Copy-Item .env.example .env
```

Edit `backend/.env` and set:

```
DATABASE_URL=mysql+pymysql://ipms_app:<password>@127.0.0.1:3306/ipms
TEST_DATABASE_URL=mysql+pymysql://ipms_app:<password>@127.0.0.1:3306/ipms_test
```

URL-encode special characters in the password (`@` → `%40`, `#` → `%23`,
`%` → `%25`, `/` → `%2F`). `.env` is git-ignored. Never commit it.

Also set a JWT signing secret. It must be random, at least 32 characters, and
different for every environment:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
# paste the output into .env as JWT_SECRET_KEY=...
```

Settings are validated at startup:
- a missing or non-MySQL `DATABASE_URL`, or a missing or short `JWT_SECRET_KEY`,
  stops the app with a clear error.
- secrets are held as `SecretStr`. The DB password is masked (`***`) in logs, and
  invalid values are never echoed in error messages.

### 4. Install dependencies and run migrations

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt     # requirements.txt alone for runtime only

alembic upgrade head                    # applies 0001 → 0003
alembic current                         # -> 0004_premium_payments (head)

python -m app.scripts.seed_dev_data     # dev users + Module 1 and 2 demo data (see below)
python -m app.scripts.backfill_premium_schedules  # any environment: schedules for pre-0004 policies
```

- **`0002_roles_users`** creates `roles` and `users`, and inserts the three roles.
- **`0003_policy_catalog`** creates the Module 1 tables. It inserts no data.
- **`seed_dev_data`** adds, in this order:
  1. the development login accounts;
  2. the frontend's own demo catalog, agents, customers and policies, keeping
     their original codes and policy numbers;
  3. the links from `agent@example.com` → agent `AGT-2207` and
     `policyholder@example.com` → customer `CUS-100241`.

  It is deterministic and idempotent, and refuses to run when `APP_ENV=production`.

### 5. Start FastAPI

```powershell
uvicorn app.main:app --reload --port 8000
```

The startup log shows `"Application starting"` with the masked database URL,
followed by either `"Database connection verified"` or `"Database connection
failed at startup"`. A failed database connection is not fatal: the API still
starts and readiness reports the outage.

### 6. Open the API docs

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

### 7. Verify health and readiness

| Endpoint | Touches MySQL | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/v1/health` | no | `200 {"status":"ok",...}` | — |
| `GET /api/v1/health/live` | no | `200 {"status":"ok",...}` | — |
| `GET /api/v1/health/ready` | yes (`SELECT 1`) | `200 {"status":"ready","database":"ok"}` | `503 {"status":"unavailable","database":"unavailable"}` |

```powershell
curl.exe http://localhost:8000/api/v1/health/ready
```

To see readiness change, stop the service (`Stop-Service MySQL80`, admin
shell). Readiness goes to 503 while liveness stays at 200. Start the service
again and readiness recovers without restarting the API.

### 8. Run tests and lint

```powershell
pytest            # all tests; MySQL tests are skipped if TEST_DATABASE_URL is unset
pytest -m mysql   # only the real-MySQL integration tests
ruff check .
ruff format --check .
```

Unit tests never touch your real database. They point `DATABASE_URL` at a closed
port and use a test-only JWT secret, so they need no credentials.

The integration tests use `TEST_DATABASE_URL`:
- they migrate that schema to head;
- they delete all `users` rows after each test;
- the Alembic test downgrades to base and upgrades again.

Never point `TEST_DATABASE_URL` at `ipms`.

## Authentication and RBAC

### Roles

The roles are exactly the ones the frontend already uses (`ROLES` in
`frontend/src/utils/constants.js`). They are stable identifiers seeded by the
migration.

| `roles.name` | Frontend constant | Who |
| --- | --- | --- |
| `administrator` | `ROLES.ADMINISTRATOR` | Internal staff: issues policies, adjudicates claims, manages renewals and commissions, views MIS reports |
| `agent` | `ROLES.AGENT` | Sells and services policies, files claims for policyholders, sees own commission |
| `policyholder` | `ROLES.POLICYHOLDER` | Customer: holds policies, pays premiums, files own claims |

"Claims Officer" is not a fourth role. On claim screens the frontend titles the
administrator "Claims Officer" (`DEMO_ROLE_TITLES`), which is a display label only.

### Flow

```
POST /api/v1/auth/login {email, password}
   → look up user by email (lower-cased)
   → verify the Argon2id hash
   → check the user is active
   → 200 {access_token, token_type: "bearer", expires_in}

Any protected route, with header  Authorization: Bearer <token>
   → get_current_user:
       decode the JWT (signature, algorithm, exp, iss, sub)
       → load the user and role from MySQL
       → 401 if the user is missing or inactive
   → require_role / require_any_role
       → 403 if the role is not allowed
```

- **Token claims:** only `sub` (user id), `iss`, `iat` and `exp`.
- **Why the role is not in the token:** role and active status are read from MySQL
  on every request, so a deactivation or role change takes effect immediately
  rather than when the token expires.
- **Login failures:** wrong password, unknown email and inactive account all
  return the same `401 "Invalid email or password."`. An unknown email still runs
  a dummy hash, so response time doesn't reveal which emails exist.

### Protecting a route

```python
from typing import Annotated
from fastapi import Depends
from app.api.deps import CurrentUser, require_role, require_any_role
from app.models import RoleName, User

@router.get("/mine")
def mine(user: CurrentUser): ...                      # any signed-in, active user

@router.post("/payouts")
def payout(user: Annotated[User, Depends(require_role(RoleName.ADMINISTRATOR))]): ...

@router.post("/policies", dependencies=[Depends(require_any_role(RoleName.AGENT, RoleName.ADMINISTRATOR))])
def issue(...): ...
```

### Endpoints

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/login` | public | Email + password → access token |
| `GET /api/v1/auth/me` | any active user | Safe profile: id, email, names, is_active, role |
| `POST /api/v1/users` | administrator | Create a user (409 if the email exists). There is no public registration |
| `PATCH /api/v1/users/{id}/status` | administrator | `{"is_active": false}` revokes access on the user's next request. You cannot deactivate yourself |
| `GET /api/v1/auth/test/admin` | administrator | **Development-only** RBAC check. Not mounted when `APP_ENV=production` |
| `GET /api/v1/auth/test/agent` | agent | **Development-only** RBAC check. Not mounted when `APP_ENV=production` |

To call protected endpoints in Swagger UI (`/docs`):
1. Call `POST /auth/login` and copy the `access_token` from the response.
2. Click **Authorize** and paste the token (just the token, without the word "Bearer").

### Development credentials

These are **development-only** accounts created by
`python -m app.scripts.seed_dev_users`. They are fake and publicly documented.
Never create them in a real deployment. The script refuses to run when
`APP_ENV=production`.

| Email | Role | Password |
| --- | --- | --- |
| `admin@example.com` | administrator | `DevOnly-Password-1` |
| `agent@example.com` | agent | `DevOnly-Password-1` |
| `policyholder@example.com` | policyholder | `DevOnly-Password-1` |

### Schema: `roles` and `users`

```
roles                                   users
-----                                   -----
id           BIGINT PK AUTO_INCREMENT   id             BIGINT PK AUTO_INCREMENT
name         VARCHAR(32)  NOT NULL UQ   role_id        BIGINT NOT NULL  FK → roles.id (RESTRICT), indexed
description  VARCHAR(255) NOT NULL      email          VARCHAR(254) NOT NULL UQ
created_at   DATETIME NOT NULL          password_hash  VARCHAR(255) NOT NULL   (Argon2id)
updated_at   DATETIME NOT NULL          first_name     VARCHAR(100) NOT NULL
                                        last_name      VARCHAR(100) NOT NULL
                                        is_active      TINYINT(1) NOT NULL DEFAULT 1
                                        created_at / updated_at DATETIME NOT NULL
```

| Constraint | Enforces |
| --- | --- |
| `pk_roles`, `pk_users` | Primary keys |
| `uq_roles_name` | Role names are unique |
| `ck_roles_name_format` | Role names are lower snake_case identifiers |
| `uq_users_email` | One account per email. Case-insensitive, because the column collation is `utf8mb4_0900_ai_ci` |
| `fk_users_role_id_roles` | Every user has an existing role. A role in use cannot be deleted (RESTRICT) |
| `ix_users_role_id` | Index backing the FK (only one; MySQL doesn't add a duplicate) |
| `ck_users_is_active_boolean` | `is_active` is 0 or 1 |
| `ck_users_email_format` | Basic `x@y` shape, as a database-level safety net |

### Verify in MySQL Workbench

1. Connect as `ipms_app` (see below). In the *Schemas* panel, right-click `ipms` → **Refresh All**.
   `ipms → Tables` now shows `alembic_version`, `roles` and `users`.
2. Right-click `users` → **Table Inspector**:
   - **Columns** tab: types and nullability as in the diagram above.
   - **Indexes** tab: `PRIMARY`, `uq_users_email`, `ix_users_role_id`.
   - **Foreign keys** tab: `fk_users_role_id_roles` → `roles.id`.
3. Or run these in a query tab:
   ```sql
   SHOW CREATE TABLE users;          -- full DDL, including CHECK constraints
   SELECT id, name FROM roles;       -- administrator, agent, policyholder
   SELECT id, email, role_id, is_active, LEFT(password_hash, 10) FROM users;  -- hashes start with $argon2id$
   ```
4. **Database → Reverse Engineer…** → `ipms` draws the `roles` 1—* `users` relationship.

## Module 1: Policy Catalog & Issuance

### Entities and relationships

```
roles 1 ─── * users
users 1 ─── 0..1 agents      (agents.user_id, nullable + unique)
users 1 ─── 0..1 customers   (customers.user_id, nullable + unique)

products 1 ─── * product_term_options          (PK product_id + term_years)
products 1 ─── * product_premium_frequencies   (PK product_id + frequency)
products 1 ─── * product_features              (benefits, coverage items, exclusions, eligibility criteria)

products  1 ─── * policies
customers 1 ─── * policies
agents    1 ─── * policies   (nullable: a policy may have no servicing agent)
users     1 ─── * policies   (issued_by_user_id: who issued it through the API)

id_sequences   (counters for policy numbers and customer codes)
```

- **Business records vs. logins.**
  - Agents and customers are business records. `users` are login accounts.
  - A record may exist without a login, for example a customer who never signs in.
  - A login is linked to at most one record, through a nullable unique `user_id`.
  - The account's role decides which kind of record it may be linked to. This is
    enforced in the service and seed layer, because a CHECK constraint can't look
    at another table.
- **Identifiers.**
  - Every table has a surrogate `BIGINT` primary key.
  - Business identifiers are separate unique columns with format CHECKs:
    `PRD-HLT-001`, `AGT-2207`, `CUS-100241`, `POL-2024-000148`.
- **Normalisation.**
  - Offered terms, frequencies and descriptive lists are child rows, not JSON (1NF).
  - The nominee is 1:1 with the policy, so its fields live on `policies`.
  - Contact email and phone are deliberately *not* unique, because family members
    can share them.
- **No duplicated derived data.**
  - `end_date` is a stored generated column,
    `(start_date + INTERVAL term_years YEAR) - INTERVAL 1 DAY`, and it's indexed.
  - Only the rated `annual_premium` is stored. The per-instalment amount is
    derived in the response.
- **Products are never deleted once policies use them.** The foreign key is
  RESTRICT; a withdrawn product is set to `status = 'inactive'` instead.
- **Statuses** are only the ones Module 1 uses: `pending`, `active`, `expired`.
  Later modules (renewals, lapses) extend the CHECK in their own migrations.

### Constraints enforced by MySQL

| Table | Constraints |
| --- | --- |
| `products` | `uq_products_code`, `uq_products_name`; CHECKs on code format, type, status, `min ≤ reference ≤ max` coverage, base premium > 0, term 1–50, entry age range |
| `product_term_options` / `_premium_frequencies` | composite PKs (no duplicate options); CHECKs on term range / allowed frequency |
| `product_features` | `uq_product_features_product_id_kind_position`; kind allowed; `limit_text` present exactly for coverage items |
| `agents` | `uq_agents_agent_code`, `uq_agents_email`, `uq_agents_user_id`; code format |
| `customers` | `uq_customers_customer_code`, `uq_customers_user_id`; code, phone (`^[6-9][0-9]{9}$`), PIN and email formats |
| `policies` | `uq_policies_policy_number`, `uq_policies_customer_id_product_id_start_date` (duplicate-proposal guard); FKs to products, customers, agents, users (all RESTRICT); CHECKs on number format, status, frequency, nominee relationship, coverage/premium > 0, term, `status = 'pending' OR issue_date IS NOT NULL`, `issue_date ≤ start_date` |

**Collation.** Codes and controlled values use `utf8mb4_bin`, via `code_string()`.
Under MySQL's default case-insensitive collation, `'ACTIVE'` would pass
`status IN ('active')` and `'prd-hlt-001'` would pass the code REGEXP. The tests
guard this, because `alembic check` doesn't compare collations.

**Indexes.** Every foreign key is backed by exactly one index:
- `ix_policies_product_id`, `ix_policies_agent_id` and `ix_policies_issued_by_user_id`
  are created before their FKs, so MySQL doesn't add duplicate indexes.
- `customer_id` is covered by the leading column of the duplicate-proposal unique key.

Filter indexes: `ix_policies_status`, `ix_policies_end_date` (for the future
renewals module), `ix_products_status_product_type`.

### Issuance transaction (`services/policies.py::issue_policy`)

```
product (exists, active)
  → product rules: coverage band, offered term and frequency, entry age
  → agent: an agent issues as themselves; an admin may name one or none
  → customer: existing (customer_code + matching date of birth) or new (next CUS- code)
  → premium: base annual premium × coverage / reference coverage, rounded half-up to rupees
  → policy number: next POL-<year>-NNNNNN
  → INSERT policy → COMMIT
```

- **Transaction boundary:** one per issuance, and only the service commits.
- **On any failure** the transaction rolls back, including a newly created
  customer and both number counters. The tests prove this.
- **Duplicate proposal** (same customer, product and start date) → 409.
- **Rule violations** → 422, with field-level `errors`.
- **Premium:** the client never sends one. The backend rates it.

### Policy-number generation

MySQL has no `SEQUENCE`, and `MAX()+1` races under concurrency. Each identifier
family instead has a counter row in `id_sequences` (for example `policy:2026` or
`customer`). The next value is taken inside the issuing transaction in three steps:

1. **Create the counter if missing** (`INSERT … ON DUPLICATE KEY`). A new counter
   starts from the highest number already in use, so seeded or imported records
   are never reissued.
2. **Increment it** (`UPDATE … +1`). This takes an exclusive row lock held until
   COMMIT or ROLLBACK, so concurrent issuers queue.
3. **Read it back** under that lock.

The result has no gaps: a rolled-back issuance also rolls back its number. The
`UNIQUE` constraints on `policy_number` and `customer_code` remain the final
guarantee.

### Endpoints

| Method and path | Who | Notes |
| --- | --- | --- |
| `GET /api/v1/products` | any signed-in user | `search` (code/name/type), `type`, `status`, `sort` (`name-asc`, `name-desc`, `premium-asc`, `premium-desc`, `coverage-desc`, `type-asc`), `limit` ≤ 100, `offset`. Returns `items`, `total`, `summary` (whole-catalog counts) |
| `GET /api/v1/products/{product_code}` | any signed-in user | 404 if unknown |
| `GET /api/v1/policies` | any signed-in user, **scoped** | `search` (policy number, customer name/ID), `status`, `product_code`, `agent_code` (admins only, else 403), `sort` (`newest`/`oldest`), `limit` ≤ 200 (default 50), `offset` |
| `GET /api/v1/policies/{policy_number}` | any signed-in user, **scoped** | 404 if missing *or* out of scope |
| `POST /api/v1/policies` | agent, administrator | 201 with the created policy; 403 for policyholders |

Money is returned as decimal strings (`"27750.00"`).

### Authorization scope

Every request resolves the caller's role, then their business identity, then a
scope, in the service layer. The client can't widen it.

| Role | Sees | Issues |
| --- | --- | --- |
| administrator | every policy | yes, with any (or no) servicing agent |
| agent | policies where they are the servicing agent (via `agents.user_id`) | yes, always as themselves |
| policyholder | policies of the customer linked to their login (via `customers.user_id`) | no (403) |
| login without a linked record | nothing | no (403) |

- **Out-of-scope policies return 404, not 403.** Policy numbers are sequential,
  so a 403 would confirm to anyone probing that a number exists.
- **An existing customer ID must come with the matching date of birth.** Unknown
  IDs and mismatched dates get the same 422, so the ID can't be used to discover
  someone's date of birth.

### Frontend integration (Module 1 only)

- **Service layer only.** `frontend/src/services/policyService.js` calls the API
  through `services/authSession.js` and maps responses into the shape the
  existing components already render. No component makes HTTP calls.
- **Development-only sign-in bridge.** The demo-role switcher signs in as the
  matching development account, using `VITE_DEMO_AUTH_PASSWORD` from the
  git-ignored `frontend/.env.development.local`. The backend still decides what
  each account sees. Production builds never read the password.
- **Modules 2–6 still read the mock policy register.** Policies issued through the
  API don't appear in premiums, claims, renewals, commissions or MIS until those
  modules migrate. The seed keeps the frontend's original policy numbers, so the
  seeded policies line up across all modules.

### Verify in MySQL Workbench

1. Refresh `ipms`. The tables now include `products`, `product_term_options`,
   `product_premium_frequencies`, `product_features`, `agents`, `customers`,
   `policies` and `id_sequences`.
2. `SHOW CREATE TABLE policies;` shows:
   - the generated `end_date`;
   - the four RESTRICT foreign keys;
   - both unique keys;
   - the CHECK constraints.
3. **Database → Reverse Engineer…** → `ipms` draws the diagram above.
4. Useful queries:
   ```sql
   SELECT policy_number, status, start_date, end_date FROM policies ORDER BY id;
   SELECT a.agent_code, u.email FROM agents a LEFT JOIN users u ON u.id = a.user_id;
   SELECT * FROM id_sequences;
   ```

## Module 2: Premium Schedule & Payments

### Tables (migration `0004_premium_payments`)

```
policies 1 --- 0..1 premium_schedules   (uq_premium_schedules_policy_id: one per policy)
premium_schedules 1 --- * installments  (unique on schedule+number and schedule+due_date)
installments 1 --- * payments           (every FK RESTRICT: financial history is never cascaded away)
users 1 --- * payments                  (recorded_by_user_id)
```

- **`premium_schedules`** stores only what it adds to the policy: `installment_count`
  and `total_premium` (annual premium × term). Frequency, term, start date and
  annual premium stay on `policies`.
- **`installments`**: `installment_number`, `due_date`, `amount_due`, `amount_paid`
  and `status`.
- **`payments`**: `payment_number` (server-generated `PAY-YYYY-NNNNNN`),
  `payment_reference` (supplied by the payer, UNIQUE), `amount`, `status`,
  `payment_method`, `paid_at` (UTC), `failure_reason` and `recorded_by_user_id`.

### Rules enforced by MySQL

| Constraint | Enforces |
| --- | --- |
| `ck_installments_amount_paid_within_due` | `0 <= amount_paid <= amount_due`: an instalment can never be overpaid |
| `ck_installments_status_matches_amount` | `pending` = nothing paid; `partially_paid` = `0 < paid < due`; `paid` = `paid = due` |
| `ck_installments_status_allowed` | Only `pending`, `partially_paid` or `paid` is stored |
| `uq_payments_payment_reference` | A payment attempt can be recorded only once (duplicate protection) |
| `ck_payments_failure_reason_for_failed` | A failure reason exactly on failed payments |
| `ck_payments_status_allowed`, `ck_payments_method_allowed` | Controlled values (binary collation) |

- **`overdue` is never stored.** It depends on today's date, which a MySQL CHECK
  can't use, and a stored value would go stale. The API reports it: anything not
  fully paid whose due date has passed is `overdue`.
- **Payment immutability.** After insert, a payment's instalment, amount, number
  and reference can't change; only a `pending` status may settle. The `Payment`
  model enforces this rather than a trigger: `CREATE TRIGGER` needs SUPER while
  binary logging is on (MySQL error 1419), which the app account must not have.

### Money

- `regular = (annual × term) / count`, rounded **down** to the paisa.
- The **final instalment** absorbs the remainder (0 to count−1 paise).
- The instalments therefore always sum exactly to `annual × term`. For example,
  ₹18,500 a year paid monthly is 11 × ₹1,541.66 plus ₹1,541.74.
- Due dates run every 12 ÷ (instalments per year) months from the start date,
  with end-of-month clamping (31 Jan → 28/29 Feb).
- The policy's displayed `instalment_premium` (Module 1) is the regular instalment.

### Recording a payment (`services/premiums.py::record_payment`)

```
SELECT installment ... FOR UPDATE      (locking read: always the latest committed row)
-> SELECT pending payments ... FOR UPDATE
-> validate: amount > 0 and <= remaining balance; not already paid; no pending payment;
   payable window open (from 30 days before the due date)
-> INSERT payment -> UPDATE amount_paid / status (successful payments only) -> COMMIT
```

- **Concurrency:** concurrent payments on one instalment queue on the row lock. The
  tests pay one instalment from two sessions at once: exactly one succeeds.
- **Rollback:** any failure rolls back the payment row, the balance and the
  payment-number counter.
- **Outcomes:** `outcome` is `successful`, `failed` or `pending`. There's no gateway
  yet, so the payer states it. Failed and pending attempts never move money.
- **Pending payments:** a pending payment blocks new payments until an administrator
  settles it with `PATCH /payments/{number}`. Successful and failed are final.

### Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/premium-schedules` | Accounts in scope: `search`, `standing` (`overdue`/`due`/`up_to_date`/`fully_paid`), `sort`, `limit`/`offset`; plus portfolio totals |
| `GET /api/v1/policies/{policy_number}/premium-schedule` | Schedule + financial summary (409 if the policy isn't issued yet) |
| `GET /api/v1/policies/{policy_number}/installments` | Instalments with status, balance, `payable`, pending/failed attempts |
| `GET /api/v1/installments/{id}` | One instalment |
| `GET /api/v1/installments/{id}/payments` | Its payment attempts |
| `POST /api/v1/installments/{id}/payments` | Record a payment: `amount`, `payment_method`, `payment_reference`, `outcome` |
| `GET /api/v1/payments` | Payment history: `search`, `status`, `method`, `policy_number`, `sort`, paging; plus a scope-wide summary |
| `GET /api/v1/payments/{payment_number}` | One payment |
| `PATCH /api/v1/payments/{payment_number}` | Settle a pending payment (administrators) |

### Authorization

| Role | Read schedules / instalments / payments | Record a payment | Settle pending |
| --- | --- | --- | --- |
| administrator | everything | yes | yes |
| agent | policies they service | **no (403)** | no (403) |
| policyholder | own policies | own instalments only | no (403) |
| login without a linked record | nothing | no (404) | no (403) |

Anything outside the caller's scope is 404, as in Module 1.

### Backfill

Policies issued before migration 0004 have no schedule. Run
`python -m app.scripts.backfill_premium_schedules` once; it is idempotent and runs
in one transaction. `seed_dev_data` also runs it. New policies always get their
schedule in the issuance transaction.

### Verify in MySQL Workbench

```sql
-- The ledger invariant: every balance equals its successful payments (expect 0 rows).
SELECT i.id, i.amount_paid, COALESCE(SUM(p.amount), 0) AS successful
FROM installments i LEFT JOIN payments p ON p.installment_id = i.id AND p.status = 'successful'
GROUP BY i.id, i.amount_paid HAVING i.amount_paid <> successful;

-- Every schedule sums to annual premium x term (expect 0 rows).
SELECT s.id FROM premium_schedules s JOIN policies p ON p.id = s.policy_id
JOIN (SELECT schedule_id, SUM(amount_due) due FROM installments GROUP BY schedule_id) i
  ON i.schedule_id = s.id
WHERE i.due <> s.total_premium OR s.total_premium <> p.annual_premium * p.term_years;

-- One policy's account.
SELECT installment_number, due_date, amount_due, amount_paid, status FROM installments
WHERE schedule_id = (SELECT s.id FROM premium_schedules s JOIN policies p ON p.id = s.policy_id
                     WHERE p.policy_number = 'POL-2024-000519') ORDER BY installment_number;
```

## Module 3: Claim Filing & Approval Workflow

### Tables (migration `0005_claim_workflow`)

| Table | Purpose |
| --- | --- |
| `claim_types` | Claim catalog: product type, the coverage item it draws on, % of coverage, optional cap |
| `claim_type_documents` | Documents each claim type requires (unique per type) |
| `claims` | One row per claim: `CLM-YYYY-NNNNNN`, policy, type, dates, amounts, status |
| `claim_documents` | Document **metadata** (type, file name, status). No files are stored |
| `claim_events` | Append-only workflow history, numbered 1..n per claim |
| `claim_verifications` | Outcome of the verification checklist (one per claim) |
| `claim_assessments` | Assessed amount against the illustrative limit (one per claim) |
| `claim_settlements` | Settlement reference `SET-YYYY-NNNNNN` and amount. The PK is `claim_id`, so a claim settles at most once |

Rules enforced by MySQL CHECKs:

- status in the allowed set
- `claimed_amount > 0`
- `incident_date <= filing_date`
- description 30–1000 characters
- `approved_amount` present exactly when approved or settled, and never above the claimed amount
- `rejection_reason` present exactly when rejected
- every `claim_events` row is a legal `(from_status, to_status, action)` triple
- assessed amount never above the illustrative limit

### State machine (`services/claim_transitions.py`)

| Action | From → To | Roles |
| --- | --- | --- |
| submit | draft → submitted | policyholder, agent |
| cancel_draft | draft → cancelled | policyholder, agent |
| start_review | submitted → under_review | administrator |
| withdraw | submitted → cancelled | policyholder, administrator |
| verify | under_review → verified | administrator |
| assess | verified → assessed | administrator |
| approve / reject | assessed → approved / rejected | administrator |
| settle | approved → settled | administrator |

`rejected`, `settled` and `cancelled` are terminal. "Claims Officer" is the
administrator's display title, not a separate role. An illegal move returns
**409**. A legal move by the wrong role returns **403**. The move is checked
first, then the role.

### A transition (`services/claims.py::_transition`)

1. Commit, which ends the read snapshot that authentication opened.
2. Lock the claim: `SELECT … FOR UPDATE`.
3. Check scope. A claim outside the caller's scope returns 404.
4. Check the state machine and the caller's role, then the action's own rules.
   For example, verification fails if the checklist has blocking checks, and an
   assessment must be at most the claimed amount and at most the limit.
5. Update the claim and its verification, assessment or settlement row.
6. Append the next `claim_events` row, with the actor's user id plus a snapshot
   of their name and role.
7. Commit. Any failure rolls back the whole transition.

Concurrent requests serialise on the row lock. The loser re-reads the new status
and gets 409, whether the race is approve against reject or two settlements.

Decisions are deterministic rules (`services/claim_rules.py`), with no scoring
or AI:

- **Eligibility:** policy active, cover in force on the incident date, filing
  within 90 days of cover ending, and a compatible claim type. Overdue premiums
  only produce a warning.
- **Illustrative limit:** coverage × % of coverage, capped at the type's maximum.
- **Explanation:** every detail response carries `decision.reasons`.

### Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/claim-types` | Claim catalog and required documents |
| `GET /api/v1/claims` | Scoped list with `search`, `status`, `claim_type`, `policy_number`, `sort`; status counts |
| `GET /api/v1/claims/eligibility` | Caller's policies with eligibility checks (for filing) |
| `GET /api/v1/policies/{n}/claim-eligibility` | Filing context: eligibility, compatible types, limits |
| `POST /api/v1/claims` | File a claim (policyholder or agent; `submit=false` keeps a draft) |
| `GET /api/v1/claims/{n}` | Detail: documents, checklist, assessment, decision, settlement, history, allowed actions |
| `GET /api/v1/claims/{n}/timeline` | History only |
| `POST /api/v1/claims/{n}/submit` · `cancel` · `withdraw` · `start-review` · `verify` · `assess` · `approve` · `reject` · `settle` | One endpoint per action. There is no generic status endpoint |

Scope follows Module 1. An administrator sees every claim, an agent sees claims
on the policies they service, and a policyholder sees claims on their own
policies. Anything else returns 404.

### History is append-only

Once a `claim_events` row is written, the ORM refuses to change it (`ValueError`
on flush). A MySQL trigger would need SUPER, as in Module 2. The dev seed
replays every seeded history through the state machine before writing it.
Seeded events have a NULL `actor_user_id` and keep the name and role snapshot.

### Verify in MySQL Workbench

```sql
-- Every claim's latest event matches its status (expect 0 rows).
SELECT c.claim_number, c.status, e.to_status FROM claims c
JOIN claim_events e ON e.claim_id = c.id
 AND e.sequence_no = (SELECT MAX(sequence_no) FROM claim_events WHERE claim_id = c.id)
WHERE e.to_status <> c.status;

-- Sequence numbers have no gaps (expect 0 rows).
SELECT claim_id FROM claim_events GROUP BY claim_id HAVING MAX(sequence_no) <> COUNT(*);

-- Every settled claim has exactly its approved amount settled (expect 0 rows).
SELECT c.claim_number FROM claims c LEFT JOIN claim_settlements s ON s.claim_id = c.id
WHERE (c.status = 'settled') <> (s.claim_id IS NOT NULL) OR s.amount <> c.approved_amount;

-- One claim's history.
SELECT e.sequence_no, e.action, e.from_status, e.to_status, e.actor_name, e.actor_role, e.occurred_at
FROM claim_events e JOIN claims c ON c.id = e.claim_id
WHERE c.claim_number = 'CLM-2026-000071' ORDER BY e.sequence_no;
```

## MySQL Workbench usage

- **Connect as the app user.** Click **+** next to *MySQL Connections* and fill in:
  - Hostname `127.0.0.1`, port `3306`, username `ipms_app`.
  - Default schema `ipms`.
  - Store the password in the vault.

  Then click **Test Connection**. This checks the same credentials the backend uses.
- **Inspect the schema.** Use the *Schemas* panel, then right-click a table →
  *Table Inspector* for columns, indexes and foreign keys. Constraint names follow
  the naming convention below, so they are easy to recognise.
- **ER diagram.** Use **Database → Reverse Engineer…**, select `ipms`, and it
  draws the ER diagram from the live schema. This is useful once business tables
  exist.
- **Don't edit the schema by hand in Workbench.** Every schema change goes
  through an Alembic migration, or the models, migrations and database drift apart.

## Alembic workflow

`alembic/env.py` reads `DATABASE_URL` from the app settings. `alembic.ini` holds
no credentials. `target_metadata` is `Base.metadata`, populated by importing
`app.models`.

```powershell
# 1. Add or modify a model in app/models/ and import it in app/models/__init__.py
# 2. Generate a migration from the model diff
alembic revision --autogenerate -m "create policy products"
# 3. READ the generated file in alembic/versions/ and fix what autogenerate misses
#    (renames look like drop+add; CHECK constraints and data migrations are manual)
# 4. Apply / roll back
alembic upgrade head
alembic downgrade -1
# Useful
alembic current          # revision the database is at
alembic history          # all revisions
alembic upgrade head --sql   # print the SQL without running it
```

## Schema conventions (`app/db/base.py`)

- **Tables:** plural snake_case (`policies`, `premium_payments`).
- **Primary keys:** `id BIGINT AUTO_INCREMENT` (`id: Mapped[IntPK]`). Business
  identifiers such as a policy number are separate columns with a unique constraint.
- **Foreign keys:** `<entity>_id`, with the same type as the referenced PK and an
  explicit `ondelete` (RESTRICT unless there is a reason).
- **Money:** `DECIMAL(14,2)` (`Mapped[Money]`). Never FLOAT.
- **Timestamps:** `TimestampMixin` adds `created_at` and `updated_at`, both
  maintained by MySQL (`ON UPDATE CURRENT_TIMESTAMP`). Every connection runs with
  `time_zone = '+00:00'`, so stored DATETIMEs are UTC.
- **Constraint and index names:** generated by the naming convention:

  | Kind | Name pattern |
  | --- | --- |
  | Unique constraint | `uq_<table>_<cols>` |
  | Index | `ix_<table>_<cols>` |
  | Foreign key | `fk_<table>_<col>_<reftable>` |
  | Check constraint | `ck_<table>_<name>` |

  MySQL allows at most 64 characters, so give an explicit `name=` if a generated
  name would be longer.
- **Status fields:** `VARCHAR` plus a CHECK constraint (enforced by MySQL 8.0.16+),
  not `ENUM`.
- **Engine and charset:** InnoDB, utf8mb4 (both MySQL 8 defaults; the driver
  connection forces `charset=utf8mb4`).

The frontend's mock objects describe behaviour, not tables. Each module's schema
is derived from entities, relationships and constraints, and normalised before it
is migrated.

## API conventions

- **Prefix:** all routes live under `API_PREFIX` (default `/api/v1`).
- **Error shape:** every error response looks like this:

  ```json
  {"detail": "Human readable message.", "code": "not_found", "errors": [...]}
  ```

  - `detail` is always a string. The frontend `apiClient` shows it directly.
  - `errors` appears only for field-level problems:
    `[{"field": "body.amount", "message": "...", "type": "greater_than"}]`.

| Situation | Status | `code` |
| --- | --- | --- |
| Request body/query invalid | 422 | `validation_error` |
| `UnauthorizedError` | 401 | `unauthorized` (+ `WWW-Authenticate: Bearer`) |
| `ForbiddenError` | 403 | `forbidden` |
| `NotFoundError` / unknown route | 404 | `not_found` |
| Wrong HTTP method | 405 | `method_not_allowed` |
| `ConflictError` / unhandled DB `IntegrityError` | 409 | `conflict` |
| `UnprocessableError` (business-rule violation) | 422 | `unprocessable` |
| MySQL unreachable (connection error codes only) | 503 | `database_unavailable` |
| Anything else | 500 | `internal_error` |

Services raise these exceptions from `app.core.exceptions`, for example
`raise NotFoundError("Policy POL-104 was not found.")`.

Responses never include SQL, stack traces, file paths, credentials or the
submitted input. Those details go to the server log only.

## Security baseline

- **Secrets:** all secrets come from the environment or `.env`. Nothing is in
  source or `alembic.ini`.
- **Database user:** the backend connects as a dedicated non-root user
  (`ipms_app`) that has privileges on its own schemas only.
- **CORS:** allows only the origins listed in `CORS_ORIGINS`, and a fixed set of
  methods and headers.
- **Queries:** all SQL goes through SQLAlchemy parameter binding. Never build SQL
  by string concatenation or f-strings.
- **Logging:**
  - SQL echo is off by default (`DB_ECHO`).
  - The DB password is masked.
  - Driver error messages and integrity-error row values are not logged. Only the
    exception type or MySQL error number is recorded.
- **Passwords:**
  - Hashed with Argon2id using a unique salt, and compared in constant time.
  - Never logged, returned or placed in a token.
  - Request fields are `SecretStr`.
- **JWT:**
  - Signed with HS256 by default. The algorithm is pinned on decode, which blocks
    `alg: none` and algorithm-confusion attacks.
  - `exp`, `iat`, `iss` and `sub` are all required.
  - The secret comes only from the environment.
- **Auth logging:** records the user id and the failure reason. Emails, passwords
  and tokens are never logged.

## Configuration reference

See `.env.example`. Every variable maps to a field on `Settings` (case-insensitive).

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_NAME` | Insurance Policy Management System API | OpenAPI title |
| `APP_ENV` | `development` | `development` / `test` / `production` |
| `DEBUG` | `false` | `true` sets log level to DEBUG |
| `LOG_LEVEL` | `INFO` | |
| `API_PREFIX` | `/api/v1` | |
| `DATABASE_URL` | — (required) | must be `mysql+pymysql://…/<schema>` |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `5` / `10` | |
| `DB_POOL_RECYCLE_SECONDS` | `1800` | below MySQL `wait_timeout` |
| `DB_CONNECT_TIMEOUT_SECONDS` | `5` | bounds readiness latency when MySQL is down |
| `DB_ECHO` | `false` | logs SQL; development only |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated |
| `JWT_SECRET_KEY` | — (required, ≥ 32 chars) | signs access tokens |
| `JWT_ALGORITHM` | `HS256` | `HS256` / `HS384` / `HS512` |
| `JWT_ISSUER` | `ipms-api` | `iss` claim, verified on decode |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | 1–1440 |
| `TEST_DATABASE_URL` | unset | pytest integration tests only |

## Known limitations

- **Modules 4–6 aren't on the backend yet.** They still read the frontend's
  frozen mock ledgers, so policies, payments and claims created through the API
  don't appear in renewals, commissions or MIS (including MIS claim reports)
  until those modules migrate.
- **Claim documents are metadata only.** A file name is recorded, but no file is
  uploaded or stored.
- **Claim history immutability is enforced by the ORM, not a trigger** (same
  reason as payments).
- **No payment gateway.** The payer states a payment's outcome; no money moves.
- **Payment immutability is enforced by the ORM model, not a trigger.** A
  trigger needs SUPER under binary logging. To add one, a DBA must enable
  `log_bin_trust_function_creators` first.
- **Policy status isn't time-driven yet.** Statuses are stored, so a seeded
  policy past its end date stays `active` until the renewals module adds expiry
  processing.
- **No document store.** Policy details show an empty documents list.
- **The issued-policy register has no paging UI.** The frontend requests the
  first 200 policies, which is the API maximum.
- **`roles.name` uses the case-insensitive default collation.** It comes from
  0002, which wasn't edited. Its REGEXP check therefore allows case variants.
  The next auth-related migration can switch it to `utf8mb4_bin`.
- **No refresh tokens.** When the 30-minute access token expires, the user logs
  in again. Logout is client-side: the frontend discards the token.
- **Deactivation, not token revocation.** Deactivating a user blocks their
  existing tokens on the next request. There is no list of individually revoked
  tokens.
- **Users aren't linked to business records yet.** For example, an `agent` user
  isn't yet tied to an agent record such as the frontend's `AGT-2207`, and a
  `policyholder` user isn't tied to a customer. Those links belong to the business
  schema design.
- **No password reset, email verification, MFA or login rate limiting.**
- **The frontend isn't wired to login yet.** It still uses the demo role switch.
- **Endpoints are synchronous (`def`),** and FastAPI runs them in a threadpool.
  That is fine at this scale, and it is the standard pairing with PyMySQL.
