# Membership, quotas and manual beta payments

The beta provides finite trials, VIP plans, add-on packs, administrator gifts and manually verified orders. The member dialog is available from the workspace header and drive settings. Administrators manage the same ledger from `/admin`.

The personal center at `/account` consolidates membership, remaining time, grant sources and expiry, orders and the latest 100 task settlements. New VIP plan edits require a fixed 30-day term. Historical order snapshots and existing grants retain their values. Administrators still configure actual prices, conversation/video allowances and session caps before publishing. Renewal extends validity and adds time, without automatic charges or a currency wallet.

QuickTalk-eligible time is shown separately from total conversation time: free lightweight time cannot replace QuickTalk trials or purchased/gifted time. Active reservations are disclosed. `GET /billing/me` includes `grants`; `GET /billing/activity` returns only the current user's latest 100 reservations and settlements, including reserved/used seconds, state and trial status, without internal allocation or other users' information.

## Monthly VIP without a total usage allowance

The current monthly VIP costs CNY 100 per 30 days. Selecting the administrator option for unlimited total usage (`unlimited=true`) authorizes QuickTalk, lightweight conversation, video creation, previews and voice enrollment throughout the entitlement period without deducting total conversation/video balances. Trials, gifts and historical finite plans retain their rules. Plan changes apply to subsequent orders.

Per-task conversation limits, the deployment's `OPENTALKING_BILLING_VIDEO_MAX_SECONDS`, concurrency limits, input limits and request rate limits still apply. A task cannot outlive its funding VIP entitlement; members can start subsequent tasks while it remains valid. Provider usage and costs are still recorded.

`GET /billing/me` includes `unlimited` and `unlimited_until`; grants and activity records also identify unlimited access. The personal center and member dialog prioritize membership status, VIP expiry and remaining days, showing “不足 1 天” for the final partial day. Accounts without VIP have no invented expiry date. Unlimited VIP hides minute-balance cards; finite plans, trials and gifts still display their allowances separately. The backend checks the actual order grant without inventing a large minute balance. Expiry, revocation and disabling demo mode remove the applicable access.

## Demonstrating the member and administrator workflow

Set `OPENTALKING_BILLING_DEMO_ENABLED=true` in `.env`, keep authentication and billing enabled, rebuild the frontend and restart both API and workers. The flag is off by default and requires no payment-provider credentials.

1. Publish a VIP plan in `/admin` with a demonstration price, finite conversation/video allowances and session cap. VIP lasts 30 days.
2. Sign in as a member in a second tab, create an order and choose **模拟付款** (simulate payment). This does not activate VIP yet.
3. In the administrator tab, the order list refreshes automatically. Choose **确认演示开通** (approve demo activation), without a real payment or receipt number.
4. The member view checks pending demo orders every three seconds and refreshes VIP and quotas after approval. Conversations, video creation and quota deductions use the existing backend.
5. Use **撤销演示权益** (revoke demo entitlements) to repeat the demonstration. Finish active tasks before revoking.

Demo orders retain an immutable marker and never count toward actual revenue, refunds or paying users. Real confirmation/refund endpoints reject them. Disabling the flag and restarting API/workers makes demo grants unavailable, while preserving real orders and entitlements. Payment is simulated; model and speech service calls still run normally.

Opt-in routes: `POST /billing/orders/{order_id}/demo-pay`, `POST /admin/billing/orders/{order_id}/demo-confirm`, and `POST /admin/billing/orders/{order_id}/demo-revoke`. Ownership and administrator authorization remain enforced.

## Production configuration and orders

Authentication and `OPENTALKING_BILLING_ENABLED=true` enable billing. MySQL uses additive `billing_*` tables; existing accounts and media are preserved. Setting billing to `false` disables its backend enforcement and frontend entry through the `billing_enabled` capability in `/auth/status`.

After updating, rebuild the frontend and restart both API and workers on the same version. Older workers do not enforce the new quota timer or expiry cleanup; an already running copy does not upgrade when source files change.

Plans start unpublished with a zero price. An administrator must set a positive price, finite conversation/video seconds, validity and session limit before publishing. There is no invented default commercial price or unlimited plan. Changes affect new orders; pending orders retain their original price and entitlement snapshot. Gifts are separate from VIP and never count as revenue. Gifted conversation time can be used for QuickTalk. Add-on packs require active VIP and cannot outlive it. A VIP purchase issues a finite allocation once; another purchase adds quota and extends validity. There is no automatic renewal or monthly balance reset.

Set `OPENTALKING_BILLING_PAYMENT_INSTRUCTIONS` in the private backend environment to explain how to contact the operator and arrange payment. No merchant payment gateway is connected in this beta.

1. The user creates a pending order from a published plan. Retrying the same request ID returns the same order; each account can retain five pending orders and can cancel them.
2. The operator verifies the actual offline receipt, payer, amount and order, then enters its unique receipt reference in the administrator interface.
3. Marking an order paid and issuing its entitlement happen atomically. Duplicate confirmations cannot issue quota twice, and a receipt reference cannot pay multiple orders.
4. Member history and administrator revenue use the same records. Pending/cancelled orders, gifts and quota consumption do not create revenue.
5. After actually returning the full payment offline, an administrator can register a unique refund reference. Registration records the refund and revokes unused benefits; it does not transfer money. Active tasks must finish first. Refunding an earlier renewal recomputes later VIP validity and limits attached pack validity accordingly.

The dashboard reports confirmed receipts, registered refunds, net receipts, paying users, estimated known service costs and missing-cost counts. Net receipts are not profit; server, bandwidth and tax expenses are not included.

## Limits and settlement

- Each account initially receives 180 lightweight conversation seconds and two QuickTalk trials of up to 60 seconds each. Environment fields `BILLING_FREE_SECONDS`, `BILLING_TRIAL_COUNT` and `BILLING_TRIAL_SECONDS` set defaults; existing allocations are not reset when defaults change.
- Selecting a model does not consume a trial. Before initialization, MySQL reserves quota transactionally and permits one active billable task per account. Failed initialization restores the trial and quota. Once started, ending a trial early still uses one trial; ordinary unused seconds are returned.
- Conversation billing starts at the explicit session-start endpoint, using connected wall-clock seconds including silence and waiting, rounded upward. Initialization is excluded; its reservation lasts at most ten minutes and initialization waits at most two minutes. The server warns ten seconds before the limit and closes the runner at expiry. The client stops recording and retains its automatic-save workflow.
- Reservations survive refreshes and process failures. Expired unstarted work is refunded; abandoned started work consumes its bounded reserved allocation.
- Video consumes actual output audio duration. Failure/cancellation returns video quota, while service calls already made retain their cost records. Duration is checked before rendering, including accumulated dialogue segments. The default maximum is 60 seconds per video; a task lasts at most ten minutes and no longer than its funding grant. Each user can start ten videos per hour.
- Voice previews reserve up to 15 conversation seconds and consume generated audio duration. Voice cloning requires VIP or gifted beta access, consumes 60 conversation seconds on success, and permits three attempts daily. Both are serialized with other work.
- Defaults cap input at 1000 characters, model context at 12000 characters and each reply at 512 tokens. Input requests are spaced by at least two seconds. Speech/audio is bounded by remaining session duration. Lightweight rendering also requires quota.

## Usage and cost estimates

Usage stores account/task attribution, category, model, numeric quantities and timestamps, without prompts, audio or credentials. It records provider-reported LLM input/output tokens, TTS characters/audio seconds, STT audio seconds and renderer duration. Realtime rendering uses connection duration and video rendering uses audio duration; neither measures actual GPU execution time.

`OPENTALKING_BILLING_COST_RATES` is a JSON object with these rate keys:

- `llm:<model>`: `input_per_million` and `output_per_million`, CNY per million tokens.
- `tts:<provider>:<model>`: `per_million_chars`, CNY per million characters, or `per_minute` for audio-based pricing. Without an explicit model, the key is `tts:<provider>`; inspect the recorded model key.
- `stt:<provider>` and `render:<model>`: `per_minute`, CNY per minute.

Rates must be finite and nonnegative. Explicit zero means known free service; an absent rate means unknown cost. Records use rates at invocation time and are not retroactively repriced. Cached-token discounts, tiers and special provider billing require reconciliation with the actual provider invoice.

Streaming LLM requests use `stream_options.include_usage`. Missing final usage or interruption stays unknown rather than estimating tokens. Compatible endpoints must support streamed usage and `max_tokens`. See the [official streaming reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events/).

## API and tests

Member routes: `GET /billing/me`, `GET /billing/plans`, `GET/POST /billing/orders`, `POST /billing/orders/{id}/cancel`, `GET /billing/usage`. Orders accept `before=<created_at>` for older records, up to 100 per page.

Administrator routes: `GET /admin/billing`, `PUT /admin/billing/plans/{vip|pack}`, `POST /admin/billing/orders/{id}/confirm`, `POST /admin/billing/orders/{id}/refund`, `POST /admin/billing/gifts`. Confirmation/refund bodies contain `receipt`; order and gift creation require a unique `request_id`. Administrator/user sessions remain independent.

Run `pytest backend/tests/api/test_billing.py backend/tests/unit/test_metering.py`. Integration tests use the authentication tests' dedicated `_test` MySQL database and randomly prefixed tables, never the business database. Tests do not contact live SMS, model or payment providers.
