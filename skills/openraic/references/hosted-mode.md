# Hosted Web App

Hosted Open-RAIC is available at `https://open-raic.com`, but this OpenClaw skill must not call the hosted generation API directly in the current cutover.

## Why The Skill Cannot Use Hosted Generation Yet

- Hosted access currently depends on the browser-set `openraic_access` cookie and the normal teacher web session flow.
- `GET /api/health` is allowlisted and cannot prove that an access code is valid for generation.
- The classroom-generation submission and polling routes require the browser/session flow and will return auth errors if the skill calls them directly.

## What To Tell The User

1. If they want hosted Open-RAIC, tell them to open `https://open-raic.com` in a browser and finish sign-in or access-code entry there.
2. If they want OpenClaw to drive generation, switch them to local mode and continue with the self-hosted flow.

## Do Not Do

- Do not ask the user to paste an access code into chat.
- Do not send `Authorization: Bearer <access-code>` to hosted Open-RAIC.
- Do not call hosted generation or polling routes from the skill.
