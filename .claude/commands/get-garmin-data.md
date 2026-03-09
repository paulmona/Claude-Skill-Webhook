You are running as an automated skill triggered by a webhook. You MUST complete the entire workflow without asking any questions. You are explicitly permitted to write to Notion — do not ask for confirmation.

## Task

Fetch the latest Garmin workout and log it to the Notion Training Log database.

## Steps

1. **Get the latest activity** from Garmin using the `get_last_activity` tool. Extract the activity ID.

2. **Get full activity details** using `get_activity_detail` with that activity ID. Also call `get_activity_split_summaries` for the same activity.

3. **Determine the Workout Type** by mapping the Garmin activity type:
   - HIIT, strength, or similar → **CrossFit**
   - Any running variant (treadmill, trail, track, outdoor, indoor) → **Run**
   - Snowboarding → **Snowboarding**
   - Backcountry skiing/snowboarding → **Snowboard Touring**
   - If no clear match, pick the closest from: CrossFit, Run, Hyrox Sim, Hyrox, Recovery, Snowboard Touring, Snowboarding.

4. **Check for existing entry**: Search the Notion Training Log database (ID: `31954c77-b226-8028-96de-c94465664aa5`) for an entry on the same date with the same Workout Type.
   - If a **"Done"** entry exists with the same Activity Duration → **skip**. Respond with "Duplicate detected, skipping." and stop.
   - If a **"Planned"** entry exists → **update** that entry with the Garmin data (step 5) and set Status to "Done".
   - If **no matching entry** exists → **create** a new entry (step 5).

5. **Map the Garmin data** to Notion properties:

   - **Name**: Emoji prefix + activity name. Running = "🏃", CrossFit = "🏋️", Snowboarding = "🏂", other = "💪". Example: "🏃 Morning Run"
   - **Date**: Activity start date (YYYY-MM-DD, `is_datetime: 0`)
   - **Status**: "Done"
   - **Workout Type**: As determined in step 3
   - **Activity Duration**: Format as "M:SS" or "H:MM:SS"
   - **Activity Calories**: Active calories burned
   - **Activity Distance (km)**: In kilometers, rounded to 2 decimal places
   - **Average Heart Rate**: Average HR in bpm
   - **Activity Max HR**: Max HR in bpm

   For **running activities**, also populate:
   - **Run Pace (min/km)**: Format as "M:SS/km"
   - **Run Avg Cadence**: Steps per minute
   - **Run Avg Power (W)**: If available
   - **Run Stride Length (cm)**: If available

6. **Write to Notion**:
   - If updating an existing Planned entry: use `notion-update-page` with the existing page ID.
   - If creating new: use `notion-create-pages` with database URL `https://www.notion.so/31954c77b226802896dec94465664aa5`.

7. **Respond** with a brief summary of what was logged (activity name, date, key metrics, whether it was a new entry or updated from Planned).

## Important

- Do NOT ask for permission to write to Notion. This skill has pre-authorized Notion writes.
- Do NOT ask any questions. Run fully autonomously.
- If Garmin returns no recent activity, respond with "No recent activity found." and stop.
- If any step fails, respond with the error details so the calling system can log it.
