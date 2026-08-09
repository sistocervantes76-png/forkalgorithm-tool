# Setting up the onboarding pages

Two pages, two steps of the same journey.

| Page | Who it's for | What it does |
|---|---|---|
| `start.html` | Anyone who hasn't bought yet | Six questions → a report showing their missed-call leak and three options. Texted to them. |
| `onboarding.html` | Clients who already said yes | Full setup intake plus the service agreement they sign. |

`start.html` links to `onboarding.html` at the bottom, so the whole thing runs front to back.

---

## What you need before you start

- A Make account (free tier is fine to test with)
- A Google account for the Sheet
- An SMS sending account connected to Make (Twilio, ClickSend, or whatever you already use)

---

## Step 1 — Make the Google Sheet

Create a new Google Sheet called **Fork Algorithm — Leads & Onboarding**. Give it two tabs.

**Tab 1, name it `Reports`** — paste this into row 1:

```
form_type	submission_id	submitted_at	first_name	business_name	mobile	mobile_e164	email	consent_sms	business_type	missed_calls_band	missed_calls_estimate	customer_value_band	customer_value_estimate	callback_speed	channels	wants	weekly_loss	annual_loss	recovery_rate	recoverable_annual	recommended_tier	recommended_setup	recommended_monthly	recommended_year_one	report_sms	report_options
```

**Tab 2, name it `Onboarding`** — paste this into row 1:

```
submission_id	submitted_at	legal_business_name	display_name	business_type	website	service_area	timezone	main_business_number	current_phone_provider	who_answers_now	alert_sms_numbers	alert_emails	business_hours	after_hours_message	services	services_count	qualification_questions	custom_question	pricing_policy	approved_price_ranges	never_say	minimum_job_size	jobs_not_accepted	offers_recurring	escalation_contact_name	escalation_contact_phone	urgent_triggers	backup_contact	lead_outcome	existing_crm	lead_destination	google_business_profile_url	facebook_url	instagram_url	logo_url	brand_tone	missed_calls_per_week	avg_customer_value	current_callback_time	estimated_annual_loss	ein	tier	business_address	authorized_rep_name	authorized_rep_title	authorized_rep_email	target_go_live_date	consent_authorize_sms	consent_info_accurate	agreement_version	agreement_tier	agreement_setup_fee	agreement_monthly_fee	agreement_term_months	agreement_notice_days	agreement_year_one_total	signature_name	signature_title	signature_agreed	consent_case_study	signature_date	user_agent
```

Those are tab-separated, so pasting into cell A1 spreads them across the columns automatically.

---

## Step 2 — Build the Make scenario

A "scenario" is Make's word for an automation. Yours has four modules.

**Module 1 — Webhooks › Custom webhook.** Click *Add*, name it `Fork Algorithm forms`, and copy the URL it gives you. Leave the scenario sitting on "Determine data structure" — it's waiting for a first submission so it can learn the shape of your data.

**Module 2 — Flow Control › Router.** This splits the flow in two, because the two forms go to different tabs.

**Route A — the report form.** Set the filter to: `form_type` **equals** `fit_report`.
- **Google Sheets › Add a Row** → your Sheet → the `Reports` tab. Map each column to the matching field from the webhook.
- **Your SMS app › Send a message** → *To* = `mobile_e164`, *Message* = `report_sms`. That's it. The page already wrote the whole message, so Make just passes it along.

**Route B — the onboarding form.** Set the filter to: `form_type` **does not exist**.
- **Google Sheets › Add a Row** → your Sheet → the `Onboarding` tab.
- **Email › Send me an email** → subject `Signed: {{legal_business_name}}`, so you know a contract came in.

Turn the scenario **ON** when you're done.

---

## Step 3 — Paste the webhook URL into both pages

Open `start.html`, find this near the bottom:

```js
const MAKE_WEBHOOK_URL = "";
const BOOKING_URL = "";
```

Paste your webhook URL between the first pair of quotes, and your scheduling link (Calendly or similar) in the second. Leave `BOOKING_URL` empty and the "Book a call" button falls back to an email link.

Do the same in `onboarding.html` — same webhook URL, same spot.

---

## Step 4 — Teach Make your data shape

Open `start.html` in a browser, fill it in with junk, submit. Go back to Make, click **Determine data structure** on the webhook, and it'll pick up every field. Do the same with `onboarding.html`. Now finish mapping the Google Sheets columns.

Test both once more for real and confirm a row lands on each tab.

---

## Field reference — where each answer ends up

These field names are the placeholders. When you build a client's sub-account, these are what you drop into your templates.

| Field | Where it's used |
|---|---|
| `display_name` | The `[Company Name]` slot: "Hi, this is **[Company Name]**. Sorry we missed your call." |
| `services` | The service options the customer picks from in the first text |
| `qualification_questions` | Which follow-up questions the flow asks, in order |
| `custom_question` | Their one extra question, asked last |
| `main_business_number` | The line you watch for missed calls |
| `alert_sms_numbers` | Who gets the "new lead" text |
| `alert_emails` | Who gets the "new lead" email |
| `business_hours` | Format is `Mon 08:00-17:00; Tue …; Sun closed` — drives the after-hours branch |
| `after_hours_message` | What sends outside those hours |
| `pricing_policy` + `approved_price_ranges` | Whether the bot may quote, and what it's allowed to say |
| `never_say` | Hard blocks for the knowledge base |
| `urgent_triggers` | Conditions that skip the bot and text a human |
| `escalation_contact_phone` | Who that human is |
| `lead_outcome` | Whether the flow ends in a booking, an estimate request, or a callback |
| `ein`, `business_address`, `authorized_rep_*` | Straight into the A2P 10DLC carrier registration |
| `missed_calls_per_week`, `avg_customer_value` | The "before" numbers for their results report |

---

## A note on the agreement

The service agreement inside `onboarding.html` is a plain-language template written to match how you actually sell — the tiers, the no-guarantee language, the Florida venue. **Have an attorney read it before you use it with a paying client.** The terms in there (3-month initial term, 30-day notice, liability cap at three months of fees) are sensible defaults, not legal advice. Once your attorney blesses a version, bump `AGREEMENT_VERSION` in the file so you can tell signed copies apart later.

The case-study permission is a separate, optional tick box. If a client leaves it unticked, you don't have permission to use their name — the signed row in your Sheet records which way they went, so check the `consent_case_study` column before you publish anything.

---

## Testing without touching Make

Want to see the payload before wiring anything up? Go to [webhook.site](https://webhook.site), copy the URL it gives you, paste it in as `MAKE_WEBHOOK_URL`, and submit the form. You'll see exactly what arrives.
