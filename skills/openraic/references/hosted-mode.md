# Hosted Mode

Use this when the user has an access code from `https://open-raic.com` and wants to skip local setup.

## Access Code Setup

1. Read `accessCode` from skill config (`~/.openclaw/openclaw.json` -> `skills.entries.openraic.config.accessCode`).
2. If found, use it directly. Do not ask the user to paste the code into chat.
3. If not found, tell the user to add their access code to the config file:

   ```
   Edit ~/.openclaw/openclaw.json and set skills.entries.openraic.config.accessCode to your access code (starts with sk-).
   ```

   Wait for the user to confirm before continuing. Do not ask them to paste the code in chat.

4. Verify connectivity: `GET https://open-raic.com/api/health` with `Authorization: Bearer <access-code>`
   - On success: confirm connection and proceed to generation.
   - On failure (`401`): access code is invalid. Ask the user to check or regenerate it at `https://open-raic.com` and update the config file.
   - On failure (network): suggest checking network access or trying local mode.

## Generating A Classroom

Follow the same generation flow as [generate-flow.md](generate-flow.md) with these differences:

- **Base URL**: `https://open-raic.com` (hardcoded, not configurable)
- **Authorization**: Include header `Authorization: Bearer <access-code>` on all API requests
- **Classroom URL**: `https://open-raic.com/classroom/{id}`

### Feature Detection In Hosted Mode

Before generating, query `GET https://open-raic.com/api/health` (with auth header) to check `capabilities`. Automatically include optional feature flags (`enableWebSearch`, `enableImageGeneration`, etc.) based on what the server supports. Do not send new fields if the server does not return `capabilities` (older version). This keeps the skill forward-compatible with the hosted deployment.

## Quota

- 10 generations per day, independent of web UI quota
- If generation returns `403` with `Daily quota exhausted`, inform the user of the daily limit and that it resets at midnight.

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 401 | Invalid access code | Ask the user to check their code or generate a new one at `https://open-raic.com` |
| 403 | Quota exhausted | Inform the user of the daily limit and suggest trying tomorrow |
| 500 | Server error | Suggest retrying later or switching to local mode |