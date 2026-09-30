# Handoff — Insurance Policy Management System

Status as of 30 Sep 2026. Read this first, then
[backend/README.md](backend/README.md) (setup, architecture and a section per
module) and [frontend/README.md](frontend/README.md).

## Where things stand

| Module | Backend (FastAPI + MySQL) | Frontend | Commit |
|---|---|---|---|
| Auth + RBAC | done | demo role switcher signs in as dev users | `51fe24b` |
| 1 Policy Catalog & Issuance | done, migration `0003` | API-backed | `51fe24b` |
| 2 Premium Schedule & Payments | done, migration `0004` | API-backed | `6818980` |
| 3 Claim Filing & Approval | done, migration `0005` | API-backed | `b2f247c` |
| 4 Renewals | **not started** | mock (`renewalService.js`) | — |
| 5 Agent Commission | not started | mock (`commissionService.js`) | — |
| 6 MIS Reports | not started | mock (`reportService.js`) | — |

Everything is pushed to `origin/main` (github.com/Samrat-Reddy/DSE-DBD).
The top-level [README.md](README.md) is out of date: it still says no modules
are built.

Last verified (at `b2f247c`):
- Backend: 839 tests passed, including 240 against real MySQL; ruff is clean.
- Frontend: 561 tests passed; lint and build are clean.
- Module 3 in a real browser: 34/34 checks passed in Microsoft Edge.
- Alembic: upgrade → downgrade → upgrade round trip OK; `alembic check` reports no drift.

## Before you start: two copies of the project exist

- **The real repository** is `DSE_DBD/DSE-DBD/insurance-policy-management-system`.
- **`DSE_DBD/insurance-policy-management-system/insurance-policy-management-system-main`
  is an old copy.** It is not a git repo and stops at migration 0003. Don't edit
  it or run it; a uvicorn and a Vite started from there serve old code.
- Check which copy you are in with `git rev-parse --show-toplevel`.

## Running it

- **Backend:** follow [backend/README.md](backend/README.md) §§1–5. It runs on
  `:8000`; the frontend `.env` points at `http://localhost:8000/api/v1`.
- **Frontend:** in `frontend/`, run `npm install` then `npm run dev`. It runs on `:5173`.
- **Dev data:** these are idempotent, so they're safe to rerun and never delete data.
  ```bash
  python -m app.scripts.seed_dev_users
  python -m app.scripts.seed_dev_data
  ```
- **Dev logins:** `admin@`, `agent@` and `policyholder@example.com`. The
  dev-only password is in backend/README.md ("Development credentials").
- **Tests:**
  - Run `pytest` in `backend/`.
  - Set `TEST_DATABASE_URL` to a separate database (`ipms_test`); tests are
    marked `mysql` and are skipped without it.
  - Tests empty that database's data tables after each test, so **never point
    it at the dev database.**
  - Frontend: run `npm test`.

## Conventions every module follows (keep them)

- **Layers:** React components → frontend service → FastAPI route (kept
  thin) → service (business rules, often pure functions in a `*_rules.py`) →
  repository (all SQL, never commits) → SQLAlchemy → MySQL.
- **No `fetch` in components.** Each module has one service file in
  `frontend/src/services/`, and it calls `authApi`.
- **MySQL is the source of truth.**
  - A new Alembic migration per module; never edit an applied one.
  - Money is `DECIMAL(14,2)`; business codes use `utf8mb4_bin` collation.
  - CHECK constraints for statuses and amounts; every foreign key has exactly one index.
- **Scope is enforced in SQL** (`app/services/access.py::resolve_scope`):
  - Administrators see everything.
  - Agents see the policies they service.
  - Policyholders see their own records.
  - A record outside the caller's scope returns **404**, never 403.
- **Errors** come back as `{detail, code, errors}`:
  - 401 not signed in
  - 403 role not allowed
  - 404 missing or out of scope
  - 409 state conflict
  - 422 a rule is broken
- **Roles are exactly** `administrator`, `agent` and `policyholder`. "Claims Officer" is
  only the frontend's display title for administrators.
- **Workflows** use one endpoint per transition, never a generic status
  update. Each transition locks the row (`SELECT … FOR UPDATE`), re-reads it,
  validates, writes, appends history and commits in one transaction.
  `app/services/claims.py::_transition` is the reference implementation.
- **Business numbers** (`POL-`, `CUS-`, `PAY-`, `CLM-`, `SET-`) come from
  `repositories/policies.py::_next_value`. Add new families there.
- **Concurrency is tested against real MySQL** using threads plus
  `threading.Barrier`; see `tests/test_claims_mysql.py` (`_race`).

## How a module is migrated from mock to API

Modules 2 and 3 set the pattern:

1. Build the backend (migration, models, repository, rules, service, routes
   and seed data taken from the frontend mock data), with unit tests and
   real-MySQL tests.
2. Rewrite the module's frontend service to call the API, keeping the
   function signatures and return shapes the existing screens use. Don't
   redesign the UI.
3. Rename the old mock service to `mock<Name>Ledger.js` and point only the
   not-yet-migrated modules at it. Modules 4–6 currently read
   `mockPolicyStore`, `mockPremiumLedger` and `mockClaimLedger` this way;
   delete each ledger once nothing reads it.
4. Verify end to end in a browser with the real backend and MySQL.

## Next: Module 4 (Renewals)

- **Frontend reference:**
  - `frontend/src/services/renewalService.js`
  - `utils/renewalEngine.js`, `utils/reminderRules.js`, `utils/renewalQuery.js`
  - `data/reminderHistory.js`
  - tests `frontend/tests/module4.*`
- **Mock data it reads today:** `renewalService` reads policies from
  `mockPolicyStore` and premium standing from `mockPremiumLedger`. The backend
  already has both in MySQL (`policies`, `premium_schedules`, `installments`);
  reuse `premium_rules.summarise` for premium standing.
- **Migration:** the next one is `0006_…`, with `down_revision = "0005_claim_workflow"`.
- **Module 6 dependency:** `reportService.js` imports
  `getRenewalPolicies`/`getReminderRecords` from `renewalService`. Keep Module 6
  working when `renewalService` becomes async and API-backed, either through a
  `mockRenewalLedger` or by checking the call sites.

## Known limitations and pitfalls

- **Isolation level:** MySQL runs at REPEATABLE READ. An `INSERT … SELECT` or an
  `UPDATE` of a row that doesn't exist takes gap locks, which deadlocked
  concurrent issuance until `b2f247c` fixed `_next_value`. Keep locks on
  single existing rows.
- **Append-only history** (`claim_events`) is enforced by CHECK and UNIQUE
  constraints, the model and the absence of endpoints, not by a trigger (a
  trigger needs SUPER under binary logging).
- **Eligible-policies query:** `GET /claims/eligibility` runs a few queries per
  policy (capped at 200).
- **Listing limits:** list endpoints return at most 200 rows; there's no paging UI.
- **Extra dev data:** the dev database `ipms` has about 15 extra claims from
  browser verification runs (CLM-2026-0001xx). They have valid histories and
  are not part of the seed.
- **Claim documents** are stored as metadata only; no files are stored, and
  there's no OCR and no payment gateway, by design.
