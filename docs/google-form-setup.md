# Building the onboarding Google Form

This is the fast route. No webhook, no deploy — about five minutes and you have a link you can
text a client today.

You don't type the questions in by hand. A script does it. **Apps Script** is just Google's
name for a bit of code that runs inside your own Google account — the same way a spreadsheet
formula runs inside a sheet. This one builds the form, all forty-odd questions, and the
response spreadsheet, in one go.

---

## Do this once

**1. Open the script editor.** Go to [script.google.com](https://script.google.com) and click
**New project**. You'll get a mostly-empty code window with `function myFunction() {}` in it.

**2. Paste the script in.** Select everything in that window and delete it, then copy the whole
of `tools/create-onboarding-form.gs` and paste it in. Give the project a name at the top —
"Fork Algorithm onboarding" works.

The easiest place to copy it from is the raw file, which is always the current version and is
plain text with nothing to mangle the code:

```
https://raw.githubusercontent.com/sistocervantes76-png/forkalgorithm-tool/claude/onboarding-text-missed-calls-p18tkr/tools/create-onboarding-form.gs
```

Open that, select all, copy. (After this branch merges, swap
`claude/onboarding-text-missed-calls-p18tkr` for `main` in that link.) Don't keep a copy in a
Google Doc — it goes out of date the moment the script changes, and you'd have no way to tell.

**3. Run it.** In the toolbar there's a dropdown showing a function name. Choose **buildForm**,
then click **Run**.

**4. Approve the permissions.** The first run asks for permission, and the warning screen looks
scarier than it is. Click **Review permissions**, pick your Google account, then
**Advanced** → **Go to Fork Algorithm onboarding (unsafe)** → **Allow**. Google shows that
warning for every script that isn't published to their store, including your own. It's asking
to create forms and sheets in your account, which is exactly what you want it to do.

**5. Grab your links.** When it finishes, the **Execution log** at the bottom prints three
links:

- **Send this to clients** — the live form
- **Edit the form here** — where you change wording later
- **Your responses sheet** — where the answers land

Copy all three somewhere safe.

---

## No Google account needed

The form deliberately does **not** require respondents to sign in. Google Forms has a "collect
email addresses" setting that verifies the sender, but switching it on locks out anyone without
a Google account — which would be a client on a plain work email finding they can't submit at
all. The form asks for their email as an ordinary question instead.

---

## Check it before you send it to anyone

1. Open the client link and submit one junk response. Fill in the required fields with
   anything.
2. Open the responses sheet. You'll see two tabs.
   - **Form Responses 1** — Google's raw copy. Leave it alone; it's your backup.
   - **Onboarding** — the tidy one, with short column names like `display_name` and
     `alert_sms_numbers`. This is the one you build from.
3. Confirm your junk submission created a row on the **Onboarding** tab.
4. Delete that junk row before the link goes to a real client.

If the **Onboarding** tab stayed empty, the trigger didn't attach. Go back to the script editor,
click the clock icon (**Triggers**) in the left sidebar, and check there's one for
`onFormSubmit`. If there isn't, add it: **Add Trigger** → function `onFormSubmit`, event source
**From form**, event type **On form submit**.

---

## Changing questions later

Two options, and it matters which you pick.

**Small wording tweaks** — edit the form directly in Google Forms. Fast, but with one catch:
the tidy tab matches answers to columns **by question title**, so if you reword a question's
title, that column stops filling in. Change help text freely; leave titles alone.

**Adding or removing a question** — edit the `FIELDS` list in the script instead, then delete
the old form and run `buildForm` again. Running it twice without deleting gives you two live
forms, which is how a client ends up filling in the wrong one.

---

## Why there are two tabs

A Google Form names its spreadsheet columns after the full question text — "What name do
customers know you by?" — which is no good for building a client's system, where you need a
short name like `display_name` you can drop into a template.

So the script keeps Google's raw tab as-is and writes a second tidy one with the short names.
Those short names are identical to what `onboarding.html` produces, so a client who fills in
the web page and a client who fills in the Google Form land on the same tab in the same shape.
The `intake_source` column says which route each row came through.

See the field reference table in `onboarding-setup.md` for what each column feeds.

---

## What this form does not do

It collects setup information only. There's no agreement and no signature in it — a Google Form
can't show terms assembled from the client's own answers, so faking it with a "type your name"
box would be a weaker record than it looks.

Sign separately: use `onboarding.html` once the Make scenario is wired up, or handle signing
however you do now. The agreement columns on the tidy tab stay blank for form submissions,
which makes it easy to spot who still owes you a signature.
