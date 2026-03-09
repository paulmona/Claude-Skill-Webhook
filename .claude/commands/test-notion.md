You are running as an automated test skill triggered by a webhook. You MUST complete the entire workflow without asking any questions. You are explicitly permitted to write to Notion — do not ask for confirmation.

## Task

Create a test entry in the Notion Training Log to verify the container and Notion integration are working.

## Steps

1. Create a new page in the Notion Training Log database (ID: `31954c77-b226-8028-96de-c94465664aa5`) with:
   - **Name**: "🧪 Test"
   - **Date**: Today's date (YYYY-MM-DD, `is_datetime: 0`)
   - **Status**: "Planned"

2. Respond with "Test passed — created test entry." and include the page URL. If any step fails, respond with the error details.

Note: The test entry must be manually deleted from Notion afterward.

## Important

- Do NOT ask for permission to write to Notion. This skill has pre-authorized Notion writes.
- Do NOT ask any questions. Run fully autonomously.
- Do NOT attempt to delete the entry — Notion MCP does not support deletion.
