# Phone encryption setup

Reviewed 2026-10-30 against `api/src/config/env.ts`, `api/src/modules/bookings/phone-security.ts`, `booking.repository.ts`, `booking.route.ts` and `api/src/auth/session-security.ts`. These are operator instructions; no environment file or deployment key was changed during this review.

## Configuration contract

| Variable | Actual validation and use |
| --- | --- |
| `PHONE_ENCRYPTION_KEYS` | Comma-separated `keyId:base64` entries; each id must be a positive integer and each decoded key exactly 32 bytes. AES-256-GCM encryption/decryption key ring. Empty means an empty ring. |
| `PHONE_ACTIVE_ENCRYPTION_KEY_ID` | Optional positive integer; must exist in the encryption ring when set. Used for new/updated phones. |
| `PHONE_HMAC_KEYS` | Same format and length as the encryption ring, with independently generated keys. HMAC-SHA256 of the normalized E.164 phone. |
| `PHONE_ACTIVE_HMAC_KEY_ID` | Optional positive integer; must exist in the HMAC ring when set. Both active ids must be configured together. |
| `PHONE_REVEAL_RATE_LIMIT_MAX` | Optional positive integer; maximum reveal attempts per configured window, scoped by user and booking in the current in-process limiter. |
| `PHONE_REVEAL_RATE_LIMIT_WINDOW_MS` | Optional positive integer in milliseconds; must be supplied together with the maximum. Without both, reveal returns 503 `PHONE_REVEAL_POLICY_UNAVAILABLE`. |
| `SESSION_CSRF_SECRET` | UTF-8 string, at least 32 characters in production. HMAC-SHA256 secret for CSRF tokens, separate from both phone keys. In development an absent secret uses fresh process-local random bytes. |
| `NODE_ENV` | Defaults to `development`; `production` enables the strict session-secret and secure-cookie requirements. |
| `SESSION_COOKIE_NAME` | Non-empty string, default `21gam_session`. A name, not a secret. |
| `SESSION_TTL_HOURS` | Positive integer, default 12. |
| `SESSION_COOKIE_SECURE` | Literal `true`/`false`; defaults to true in production and false otherwise. Production requires true. |
| `SESSION_COOKIE_SAME_SITE` | `lax`, `strict` or `none`, default `lax`; `none` requires secure cookies. |
| `WEB_ORIGIN` | One exact URL origin, default `http://localhost:5173`; wildcard, comma-separated origins and path-bearing URLs fail validation. |

Session bearer tokens are fresh random 32-byte base64url strings, stored only as SHA-256 hashes in `auth_sessions`; there is no configured session encryption/signing key. CSRF uses the session token plus `SESSION_CSRF_SECRET`. Keep that secret stable across process restarts and instances. Changing it invalidates previously issued CSRF tokens, rather than decrypting or changing phone data; clients must restore their session or log in again.

Current parser limitations: duplicate ring ids silently use the last entry, Node's base64 decoder is permissive, and positive integer ids are not bounded to the database `SMALLINT UNSIGNED` range. Use unique ids from 1 through 65535 and canonical base64. Do not depend on the parser to detect malformed-but-decodable or duplicate entries.

## Initial generation without displaying secrets

Only use this for initial setup after the aggregate queries below show no existing ciphertext in the target database. If ciphertext exists, restore its original keys first; generating replacement keys will not recover those records. The source finalization report observed zero encrypted dev phones on 2026-10-30; this port did not inspect dev, so verify the actual target before initialization. Existing E2E ciphertext uses independent test keys; retain the original keys for those records.

From the target repository `api/` directory, run the operator command only when ready to configure that environment:

```powershell
pnpm secrets:init
# Optional explicit target:
node -- scripts/init-local-secrets.mjs --env-file C:\secure-local\gam-api.env
```

The package command and explicit-target command put `--` before the script so Node does not consume the initializer's `--env-file` option during startup. Use the direct Node command for a custom target on this Windows installation: its `pnpm.ps1` launcher also exposes arguments to Node before the package script starts.

`scripts/init-local-secrets.mjs` defaults to `./.env` relative to the working directory. It generates independent 32-byte encryption and HMAC keys at id 1, both active ids, a default reveal policy of 30 per 3600000 ms, and an independent 48-byte CSRF secret. Non-empty values are kept exactly as written; missing values are appended and a single blank assignment is replaced on its existing line with `NAME=value`. Other lines and existing line endings are preserved. Duplicate managed assignments are always rejected, including dotenv's `NAME: value`, whitespace, optional `export` and quoted forms, even when the last value is non-empty. Managed assignments that cannot be safely verified against a single parsed line are also refused; an error names only the variable, never its value.

The target is read as bytes and must be valid UTF-8 without NUL bytes. Malformed UTF-8 and UTF-16/UTF-32 BOM encodings are refused before any temporary file is created, with the original bytes unchanged. A UTF-8 BOM is preserved. After all assignment checks and a final dotenv parse of the prepared output succeed, a temporary file in the same directory is written with exclusive creation and mode 0600, then atomically renamed over the target. Standard output contains only variable names followed by `set` or `kept`; errors withhold values. Do not place the target or its temporary files in Git.

The initializer does not validate or rotate values marked `kept`. Check active ids and ring consistency with the validation command below before starting the API. Preserve old rings and active ids when ciphertext already exists. Its 37 regression tests use only temporary files outside Git, covering default-target, repeat-run, assignment forms, duplicate/ambiguous assignment refusal, encoding refusal and UTF-8 BOM preservation; it was not run against `api/.env`.

The example reveal policy is 30 attempts per hour per user/booking, not a deployment-wide quota. Review it with the operator. The current limiter is process-local; multi-instance operation needs a shared limiter as a separate change. On Windows `mode: 0o600` does not replace an ACL review. Persist keys in the deployment secret store and provision them consistently to every API instance. Environment variables already present in the process override dotenv values, so avoid stale exported settings.

## Verification without keys or phone output

From `api/`, load and validate configuration with a fixed output:

```powershell
@'
import { env } from './src/config/env.ts';
const ready = env.phone.activeEncryptionKeyId !== undefined
  && env.phone.activeHmacKeyId !== undefined
  && env.phone.revealRateLimitMax !== undefined
  && env.phone.revealRateLimitWindowMs !== undefined;
if (!ready) throw new Error('Phone configuration is incomplete.');
console.log('Phone key rings and reveal policy validated; values withheld.');
'@ | node --import tsx --input-type=module
```

Use read-only aggregate SQL to establish existing data/key-id requirements; never select ciphertext bytes, HMACs, last-three digits or raw phone data:

```sql
SELECT 'customers' AS entity, COUNT(phone_ciphertext) AS encrypted_rows FROM customers
UNION ALL
SELECT 'reservations', COUNT(phone_ciphertext) FROM reservations;

SELECT phone_key_id, phone_hmac_key_id, COUNT(*) AS encrypted_rows
FROM reservations WHERE phone_ciphertext IS NOT NULL
GROUP BY phone_key_id, phone_hmac_key_id;
SELECT phone_key_id, phone_hmac_key_id, COUNT(*) AS encrypted_rows
FROM customers WHERE phone_ciphertext IS NOT NULL
GROUP BY phone_key_id, phone_hmac_key_id;
```

The focused unit tests exercise normalized phone round-trip, random nonces, separate deterministic HMAC, missing keys and tampered authentication tags. Test fixtures use synthetic phones and random ephemeral keys; passing test output does not print values. Run them using `pnpm exec vitest run test/phone-security.test.ts`. For HTTP/database validation, use only `gam21_platform_it_test`:

```powershell
$env:DB_NAME = 'gam21_platform_it_test'
$env:RUN_MYSQL_INTEGRATION = '1'
pnpm exec vitest run test/booking-phone.mysql.test.ts
```

The setup file rejects any other integration database and replaces phone keys with test-only random keys. It does not validate deployment ciphertext decryptability. A restored production-key check must run privately under an operator, emit only success/failure and counts, and discard decrypted data from memory. Never log reveal response bodies or enter real phones in screenshots or test fixtures. The endpoint requires both `booking.phone.reveal` and `customer.phone.reveal`; current effective authorization is owner-only even before the pending dev grant cleanup. It commits the audit record before returning a phone and sends `Cache-Control: no-store, private, max-age=0` and `Pragma: no-cache`.

## Rotation and restore

Ciphertext format is nonce (12 bytes), encrypted normalized phone, GCM tag (16 bytes). Each stored phone retains `phone_key_id` and `phone_hmac_key_id`; reads decrypt using its stored encryption id, not the active id. New/updated phones use the active ids. There is no automatic key rotation or re-encryption job.

1. Back up the database and current rings to separate, access-controlled locations before changing anything. Confirm aggregate counts and key ids for both reservations and customers.
2. Add fresh independently generated keys under new unique ids, retaining every old id and its exact bytes. Update both active-id settings together only after the expanded rings are provisioned to all instances. Never replace bytes under an existing id.
3. New phones use the new ids. Existing ciphertext stays unchanged and decrypts while its old encryption key remains present. A missing old key returns 500 `PHONE_KEY_NOT_FOUND`; a wrong replacement key returns 500 `PHONE_DECRYPTION_FAILED`. With absent active ids, phone operations return 503 `PHONE_KEYS_UNAVAILABLE`. Merely adding keys without active ids does not enable phone operations.
4. Plan an explicit, separately reviewed backfill before retiring old keys. No current multi-id HMAC search/backfill mechanism is implemented. Changing the active HMAC key changes deterministic digests for the same phone; do not assume old and new hashes are interchangeable for lookup/deduplication.
5. Retain old encryption keys for as long as any live data or retained backup refers to them. Retain relevant HMAC keys with the same policy. Test restoration of database plus matching secret versions in an isolated environment. Never copy test keys to dev/production or regenerate keys on each restart/container recreation.

The current implementation does not attach tenant/customer AAD to GCM, and its HMAC input is the normalized phone alone. The tenant-bound AAD/HMAC design described in database doc 08 is not implemented by these helpers. Record this difference in future hardening work; do not treat key configuration as resolving it.

## Git and leak checks

Repository `.gitignore` ignores `.env`, `.env.*` (except `.env.example`) and `.backups/`. `git check-ignore api/.env` returned `api/.env` during review. Ignore rules do not untrack an already tracked secret or erase history.

From the repository root, these commands display filenames or fixed summaries only:

```powershell
git check-ignore api/.env
git ls-files --error-unmatch api/.env 2>$null
# Expected: no filename and nonzero status from ls-files (not tracked).
git diff --cached --name-only
```

Before staging a document or source change, run a secret scanner configured to redact findings. For an exact current-value check on staged content without printing matches:

```powershell
@'
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { parse } = createRequire(new URL('./api/package.json', import.meta.url))('dotenv');
const config = parse(readFileSync('api/.env'));
const names = ['PHONE_ENCRYPTION_KEYS', 'PHONE_HMAC_KEYS', 'SESSION_CSRF_SECRET'];
const secrets = names.flatMap(name => {
  const value = config[name];
  if (!value) return [];
  return name === 'SESSION_CSRF_SECRET' ? [value]
    : value.split(',').map(entry => entry.slice(entry.indexOf(':') + 1));
}).filter(value => value.length >= 24);
const staged = execFileSync('git', ['diff', '--cached', '--no-ext-diff', '--no-color'], { encoding: 'utf8' });
if (secrets.some(secret => staged.includes(secret))) throw new Error('Secret detected in staged content; values withheld.');
console.log('No configured secret value found in staged diff.');
'@ | node --input-type=module
```

An exact-value scan cannot detect every secret or a previous leak. If a real key was exposed, preserve recovery keys securely, rotate under new ids, assess affected ciphertext/backups and follow the incident process; deleting a line from Git alone is insufficient.
