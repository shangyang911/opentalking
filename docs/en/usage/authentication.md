# Phone authentication and administrator portal

The user entry is `/login`; first-time users verify their phone and set a password to register, then open the workspace at `/`. The administrator entry is `/admin`. Opening `/login` still shows user registration with an active administrator session. Both use the existing frontend and backend ports. Authorization is enforced by the backend.

## Phone registration and password login

Registration requires a phone number, SMS code, a 6–128 character password and its confirmation. The phone number is the account identifier; no separate username is needed. Passwords are stored as scrypt hashes.

Existing users select the text link below the form to sign in with their phone and password, without SMS. The password form links back to registration. Temporary username/password accounts and the two-tab control have been removed. The bootstrap CLI only initializes administrators and no longer accepts `--role user`.

`POST /auth/login` accepts `phone`, `code`, and `password` to register and sign in. Legacy phone users without passwords can verify their phone here to set their first password while retaining their user ID and assets. Repeat registration of an account with a password returns 409 and never overwrites the password. This form does not currently reset forgotten passwords.

`POST /auth/password/login` accepts `phone` and `password`, rejecting legacy test usernames. It reuses MySQL password hashes, HttpOnly session cookies and rate limits (ten attempts per IP or phone per fifteen minutes). It only accepts regular users and grants no administrator permissions. Administrators continue using `/auth/admin/login` with `username` and `password`.

Users and administrators share the `auth_users`, `auth_sessions` and other authentication tables. Removing a temporary account means deleting its exact row, sessions and account-specific rate limits; shared tables and password columns remain necessary for real accounts.

## MySQL and SMS configuration

Install the current backend dependencies, including `PyMySQL[rsa]`. Configure `OPENTALKING_MYSQL_HOST`, `PORT`, `USER`, `PASSWORD` and `DATABASE` in the repository-root `.env`. Create the database beforehand and grant the application permission to create and use its authentication tables. Initialization adds `auth_` tables without clearing existing business data.

When the backend runs in WSL and MySQL runs on Windows, use the Windows host address reachable from WSL rather than WSL's localhost. Limit the application database account to its database and client address; update these settings if WSL addresses change.

### Spug verification SMS

In the [Spug SMS console](https://push.spug.cc/console/verification/sms), select the official template containing `${number}` for its validity duration. Use its Copy button to obtain the full call URL, then place its final path segment in the private repository-root `.env`. The visible URL may contain `****`; never use that masked text or its visible prefix:

```dotenv
OPENTALKING_SMS_PROVIDER=spug
OPENTALKING_SPUG_SMS_TEMPLATE_CODE=
```

Set the second value to the code, not the full URL. It is a credential: never expose it in frontend code, public documentation or commits. Restart the backend; when `/auth/status` reports `sms_ready=true`, registration can request SMS at `/login`. Existing phone/password accounts can sign in even when SMS is unavailable.

The backend posts JSON to `https://push.spug.cc/sms/<TEMPLATE_CODE>` with one `to` phone number, the generated six-digit `code`, and `number: "5"`, matching the existing five-minute OTP expiry. Only successful HTTP responses with business `code=200` and a valid `request_id` activate the code. Acceptance means queued, not delivered; check Spug sending records for delivery. Backend logs retain only the request ID and redact template codes from normal httpx request logs.

Official templates require no custom signature or template approval. Real-name verification, SMS quota/balance and IP allowlists can still affect requests. See the [official SMS API](https://push.spug.cc/guide/sms). SMS and WeChat quotas are separate; automated tests do not send real messages or consume quota.

Initial setup also requires adding the backend's actual public egress IP to Spug's IP allowlist; an empty list rejects delivery requests. The console displays the browser's egress address, which can differ from WSL or the backend server. Verify the address from the sending process's environment and allow that exact IP or a controlled subnet. Update it when the local network's egress changes.

### Tencent compatibility

The default `OPENTALKING_SMS_PROVIDER=tencent` preserves existing deployments. Providers are explicitly selected; failed Spug requests never trigger fallback delivery. Configure these backend-only variables; never expose them through `VITE_` variables:

```dotenv
OPENTALKING_TENCENT_SMS_SECRET_ID=
OPENTALKING_TENCENT_SMS_SECRET_KEY=
OPENTALKING_TENCENT_SMS_SDK_APP_ID=
OPENTALKING_TENCENT_SMS_SIGN_NAME=
OPENTALKING_TENCENT_SMS_TEMPLATE_ID=
OPENTALKING_TENCENT_SMS_REGION=ap-guangzhou
```

Mainland China SMS requires an approved business qualification, signature and verification template. Individual accounts require suitable enterprise authorization for signatures. See Tencent's [signature requirements](https://cloud.tencent.com/document/product/382/39022) and [SendSms API](https://cloud.tencent.com/document/product/382/55981). Use a template with exactly one parameter: the six-digit code, valid for five minutes. Missing configuration disables code requests; there is no production test-code bypass.

## Concurrent user and administrator sessions

The workspace and administrator portal can stay signed in in separate tabs of the same browser. Signing in or out of either portal only replaces or revokes its own session. The user portal retains the HttpOnly `opentalking_session` cookie; the administrator portal uses a separate HttpOnly `opentalking_admin_session` cookie. Cross-tab authentication notifications are scoped to each portal.

`/admin/*` endpoints select the administrator session. Shared endpoints such as `/auth/me`, `/auth/logout`, and runtime configuration select it with `X-Opentalking-Portal: admin`; user tabs send `user`. Shared endpoints default to the user session and never fall back to administrator privileges. The backend verifies both the token and the account role, so changing this header cannot grant administrator access. Without an administrator session, `/admin` shows its login form even when a user is signed in.

After upgrading from shared sessions, sign in to the administrator portal once again using the existing credentials.

## Pre-provision an administrator

There is no administrator registration endpoint or default password. Activate the Python environment and run from `backend/`:

```bash
python -m apps.api.modules.auth.bootstrap --username admin
```

Enter and confirm a password of at least twelve characters at the hidden prompts. Existing credentials are preserved. Add `--reset-password` to reset them and invalidate previous administrator sessions.

Alternatively, set `OPENTALKING_ADMIN_USERNAME` and `OPENTALKING_ADMIN_PASSWORD` for initial provisioning. These variables do not overwrite an existing password.

## Accounts and revenue

Successful phone verification with a password registers a regular user; subsequent password logins reuse the account. Codes expire after five minutes, allow five incorrect attempts and are consumed once. Send limits are one attempt per phone per sixty seconds, ten per phone per twenty-four hours, ten per IP per ten minutes, and a configurable global `OPENTALKING_SMS_DAILY_LIMIT` (default one hundred per twenty-four hours). Failed sends consume rate-limit allowance.

Opaque session tokens use HttpOnly, SameSite=Lax cookies; only token digests are stored in MySQL. Sessions last twenty-four hours by default, configurable through `OPENTALKING_AUTH_SESSION_HOURS`. Sessions, exports, creation jobs, cloned voices and custom avatars are account-owned; system avatars remain shared. Existing demonstration assets remain intact and are not assigned to new users.

The administrator portal shows account counts, runtime settings and the membership order ledger. Beta payments require manual verification and a unique receipt reference before entitlements are issued. Confirmed receipts and registered refunds feed revenue from the same ledger. Plans remain unpublished until an administrator configures prices. See [membership, quotas and manual beta payments](membership.md).

## Deployment and tests

Use the same-origin `/api` proxy. Set `OPENTALKING_AUTH_COOKIE_SECURE=true` behind HTTPS. Vite and Nginx preserve the browser Host for Origin validation. The primary Compose files give Nginx a fixed private IP and configure Uvicorn's `FORWARDED_ALLOW_IPS` to trust only that proxy and loopback addresses, preserving per-client IP limits. Defaults are subnet `172.28.80.0/24` and proxy `172.28.80.10`; change `OPENTALKING_PROXY_SUBNET` and `OPENTALKING_PROXY_IP` together if necessary. Containers need a reachable MySQL host address; `localhost` inside a container refers to that container.

Explicit `OPENTALKING_AUTH_ENABLED=false` retains the old local demonstration mode without account isolation or the administrator portal. Do not expose that profile publicly.

## Personal center

The account avatar in the workspace header opens `/account`: account overview, membership and allowances, orders, task settlement history, profile and password settings. Opening it keeps the underlying workspace and media elements mounted; connected sessions continue to accrue time.

Profiles support a nickname (30 characters), signature (120) and account picture, separate from digital-human assets. The browser offers square crop/zoom. JPEG, PNG and WebP uploads are limited to 2 MiB and 16 million pixels, normalized to 256×256 WebP without metadata and stored in the additive `auth_profiles` table. All profile and image reads require the owner's session.

Password changes verify the current password, allow 6–128 characters and limit attempts to five per account per 15 minutes. Other login sessions are revoked; the current one is retained. Phone rebinding and device lists are not provided yet.

Endpoints: `GET/PUT /account/profile`, `GET/POST/DELETE /account/avatar`, `POST /account/password`. The authenticated session identifies the account; clients cannot supply another user ID.

Store `OPENTALKING_TEST_MYSQL_HOST/PORT/USER/PASSWORD` in the ignored repository-root `.env.test`, or override them through environment variables. Set `OPENTALKING_TEST_MYSQL_DATABASE=opentalking_test` and run from the repository root:

```bash
python -m pytest -c pytest.ini backend/tests/api/test_auth.py backend/tests/unit/test_auth_ownership.py
```

An explicitly configured database must end in `_test`. Tests create and remove only their own randomly prefixed `authtest_*` tables. Give the test account create/drop, references and data access privileges on that test database only; the application account does not need DROP privileges or access to the test database.

Without an existing test database, integration tests create uniquely named `opentalking_auth_test_*` databases and remove only those databases afterward, requiring a separate account with database create/drop privileges. SMS delivery is replaced at the HTTP boundary; real delivery requires separately configured credentials and verification for the selected provider.
