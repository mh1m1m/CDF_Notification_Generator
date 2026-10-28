# Owner step — connect staging to the database (about 5 minutes)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Task V13-ARCH-003 (plan §6, step 6).

## Why you are asked

The staging app needs two secret values: the database address with the app's password, and the key that signs
sign-in cookies. Claude must not create, see or paste secrets, so the database creates them and you paste them into
Vercel. Nothing else changes.

## What the script changes

It changes exactly one thing in Supabase: the password of the V13 app login `cdf_v13_app`. It does not touch the GC
Review application, its tables, its users or its data.

The password is generated inside the database. Only its SCRAM-SHA-256 fingerprint is stored, and the plain value is
never written to any log.

The script was tested on a local copy built like your project, and all 16 checks passed (`docs/TEST_EVIDENCE.md` §1.3):
- the login works with the new password;
- the old and wrong passwords are refused;
- no password reaches the log;
- the script refuses to run if the login role is not the expected one;
- the rest of the database is unchanged.

## Part A — Supabase (2 minutes)

1. Open **supabase.com/dashboard**, choose the project **CDF_GC_Review**, then **SQL Editor** in the left menu →
   **New query**.
2. Open the script
   [`database/hosted/owner_set_app_login.sql`](https://github.com/mh1m1m/CDF_Notification_Generator/blob/develop/database/hosted/owner_set_app_login.sql),
   click **Copy raw file** (the copy icon above the code), and paste it into the SQL editor.
3. Click **Run**. If Supabase asks you to confirm a destructive operation, confirm. The warning refers to the two
   temporary helper functions that the script removes after itself.
4. The result shows two rows: **V13_DATABASE_URL** and **V13_SESSION_SECRET**. Keep this tab open for Part B.
5. Check the server name in the first value. In Supabase, click **Connect** (top bar), then **Transaction pooler**,
   and look at the host in the connection string:
   - If it is `aws-1-eu-central-1.pooler.supabase.com`, there is nothing to do.
   - If it is different (for example `aws-0-…`), replace that part of the V13_DATABASE_URL value when you paste it in
     Part B.

## Part B — Vercel (3 minutes)

1. Open **vercel.com**, then the project **cdf_notification_generator** → **Settings** → **Environment Variables**.
2. Add the first variable:
   - **Key:** `V13_DATABASE_URL`
   - **Value:** the first value from Supabase.
   - **Environments:** untick **Production** and **Development**; keep only **Preview**, and set its branch to
     `develop`.
   - Turn on **Sensitive**.
   - Click **Save**.
3. Add the second variable the same way: Key `V13_SESSION_SECRET`, the second value, Preview on branch `develop`
   only, **Sensitive** on. Save.
4. While you are in Settings, open **Git** and check that **Git Fork Protection** is on. It is on by default.
5. Close the Supabase tab. The two values are not stored anywhere else.
6. Write **done** in the thread. Claude then redeploys `develop` and checks the database connection and the isolation
   probe from the live app. Claude never reads the values back.

## Good to know

- **Running it again** gives a new password and secret. Paste both into Vercel again. Everyone signed in to staging is
  signed out.
- **Production gets nothing**, because production is blocked by the hosting gate (ADR-005).
- The two plain switches `V13_PERSONA_SIGNIN` and `V13_ISOLATION_PROBE` are not secrets. Claude sets them.

## Optional — protect `main` on GitHub (OPEN_ISSUES OI-016)

On GitHub, go to **mh1m1m/CDF_Notification_Generator** → **Settings** → **Branches** → **Add branch ruleset**. Create
a ruleset for `main` with these rules:
- **Require a pull request before merging**;
- **Require status checks to pass** (add `CI` once it has run);
- **Block force pushes**.

Only you merge `develop` into `main`.
