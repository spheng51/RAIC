# AI Governance Rollout

This checklist hardens the hybrid org-managed AI connectivity release before production.

## Environment readiness

- Set `RAIC_SECRET_ENCRYPTION_KEY` in every authenticated environment that should allow `/admin` org saves or `/studio` server-backed teacher overrides.
- Accepted key formats:
  - 64-character hex
  - Base64 that decodes to 32 bytes
  - Any passphrase, hashed server-side with SHA-256
- If the key is missing, env and `server-providers.yml` bootstrap providers still work, but `/api/admin/ai/config` and `/api/me/ai/overrides` reject secret writes.
- If you bootstrap a local LM Studio instance server-side, set `LMSTUDIO_BASE_URL` or `providers.lmstudio.baseUrl`.
- In production, localhost LM Studio still depends on `ALLOW_LOCAL_NETWORKS=true` if requests can originate from client-supplied base URLs.
- For Postgres deployments, confirm the server creates and uses:
  - `organization_ai_policies`
  - `organization_provider_configs`
  - `user_provider_overrides`
- For JSON-mode deployments, confirm `data/platform/platform-store.json` contains:
  - `organizationAiPolicies`
  - `organizationProviderConfigs`
  - `userProviderOverrides`

## Resolution rules

- Authenticated interactive precedence:
  - personal override
  - org config
  - env / `server-providers.yml` bootstrap
  - one-release legacy browser-key fallback when no server-backed config exists for that provider
- Background and async classroom jobs:
  - org config
  - env / `server-providers.yml` bootstrap
  - never browser-sent credentials
- Public `/` keeps the legacy local-storage demo flow for this release window.
- Authenticated `/studio` and `/admin` use governed resolution.

## Release gates

Run the release gates in this order:

```bash
pnpm test
pnpm test:e2e
pnpm build
```

Then wait for CI to pass on the isolated governance PR.

## Manual staging smoke

Verify with one `org_admin` user and one `teacher` user in the target organization.

- Admin can save org defaults for LLM, web search, TTS, ASR, PDF, image, and video.
- Teacher can use an org-managed LLM without entering a browser key.
- Teacher can use LM Studio through server bootstrap with base URL only, and with an optional token when one is configured.
- Teacher personal override beats org default when policy allows it.
- Teacher cannot save a custom base URL when `allowPersonalCustomBaseUrls` is off.
- Org-approved custom LLM is visible and selectable in `/studio`.
- Legacy local key still works with a warning when no server-backed config exists.
- Async classroom generation ignores browser-sent headers and resolves via org/bootstrap config only.

## Audit events

Check for these audit actions during staging:

- `organization_ai_policy.updated`
- `organization_provider_config.updated`
- `user_provider_override.updated`
- `provider_resolution.denied`
- `provider_resolution.legacy_fallback_used`

## Promotion

- Deploy to staging first with the one-release legacy fallback still enabled.
- Promote to production only after staging passes and at least one async classroom job succeeds with org-scoped resolution.
- Monitor audit logs and support reports for fallback usage and policy denials during the release window.
- Remove legacy browser-key fallback in the next release if telemetry shows low or no active reliance.
