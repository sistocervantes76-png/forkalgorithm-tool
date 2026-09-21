# Lawns by Timmy: Master Operational SOP Playbook

Client: Lawns by Timmy
Contact: Sisto "Timmy" Cervantes — 323-333-0939
Prepared for: Fork Algorithm client reference (automation + CRM source of truth)

---

## 1. Staged Infrastructure & Local Lead Engine Roadmap

The foundational operational philosophy for Lawns by Timmy is predicated on a single truth: **"Density is the Product."** Profitability is not a function of how many lawns you cut, but how many you cut per square mile. To scale from a solo operation to a multi-crew engine, the "heroic" distance drive must be eliminated in favor of geographic route clustering.

### Geographic Route Clustering: The Growth Filter

Every lead must pass through the "Growth Filter" before a technician's wheels roll.

- **Neighborhood Triage:** Prioritize leads in zip codes where current route density is high.
- **The "Far" Lead Rule:** If a lead is outside an established "pocket," they are either waitlisted or assessed a mandatory trip fee. A low-priced "yes" in a distant neighborhood is toxic to the hourly margin.
- **Hourly Floor:** Every pin on the map must clear today's hourly rate floor. If it doesn't, we walk.

### The Tech Stack Core: Business OS

Efficiency is driven by a centralized Business Operating System. No paper or disparate apps — integrated infrastructure saves 15–20 hours per week in manual administration.

- **CRM (BusinessLaunchOS):** The absolute ground truth for all client data, property notes, and signed agreements.
- **24/7 AI Receptionist (SkipCalls):** Automated lead intake that captures and qualifies leads while crews are running equipment.
- **Automated Scheduling:** Digital route optimization via BusinessLaunchOS to ensure minimal drive time between stops.
- **Payment Gateway (Stripe):** Mandatory card-on-file for all accounts. No card = No visit.

### Operational Readiness Requirements

- **Equipment Maintenance Cycles:** Daily inspections for leaks, loose parts, and dull blades.
- **Inventory Tracking:** Real-time visibility into consumables — fuel, oil, mulch, plants, fertilizer. Shortages are a failure of planning.
- **Crew-Lead Certification:** Leads must be capable of executing service solely from digital property notes without office intervention.

---

## 2. Standardized Property Intake & Pre-Visit Checklist

A property is only "onboarded" once it has a digital record that a second crew could follow without a phone call.

### Field-Ready Property Audit Checklist

Before the first visit, the following must be verified and logged in the CRM:

- [ ] **Satellite Measurement:** Use online maps to calculate "mowable square footage" and estimate the quote from the truck.
- [ ] **Equipment Fit:** Verify the 36-inch Gate Rule. If the back gate is ≤ 36", a commercial zero-turn will not fit — triggers an automatic 25–50% price increase for push-mowing labor.
- [ ] **Standardized Mow Height:** Confirm the service standard of 3.5 to 4 inches. Prevents "scalping" complaints and ensures lawn health.
- [ ] **Hard Obstacles:** Identify and mark sprinkler heads, hidden stumps, and low-voltage lighting.
- [ ] **Underground Dog Fence:** Verify the location of any dog fences. Critical for aeration — failure to identify results in a $200 repair liability.
- [ ] **Hazard Markers:** Identify pet waste. Apply the $15 cleanup fee policy or skip the yard if waste is present.
- [ ] **Billing Security:** Confirm Stripe Card-on-File is active.

### First-Cut vs. Recurring Plan Decision Matrix

| Yard Condition | Action | Pricing Logic |
|---|---|---|
| Maintained (< 10 days since cut) | Start Plan | Standard recurring rate (Cash/Regular Dual Pricing). |
| Tall (one-pass job) | First-Cut Add-on + Plan | One-time "catch-up" fee; recurring plan starts next visit. |
| Overgrown "Jungle" | Cleanup Quote | Separate project billing; no recurring mows until cleanup is paid. |
| Spring Flush | Weekly Only | No bi-weekly service during heavy growth (March–May). |

### Worked Example: Hale Property (0.28 acre)

- **Intake:** Satellite map showed 0.28 acre, confirmed south gate code 4471, 38-inch width.
- **Plan:** Weekly service, $58 Cash / $62 Regular.
- **Visit 1:** 20-minute first-cut add-on because the yard was at 18 days growth. Plan visit 2 ran 38 minutes.

---

## 3. Missed-Call Auto-Reply & Instant SMS Qualification Scripts

Lead conversion velocity is the difference between a full route and a lost season. Use SkipCalls AI Receptionist logic to qualify leads within 60 seconds.

### The Instant Qualification Script (SkipCalls AI)

> "Hi, this is Timmy's AI assistant! To get you a fast quote, please reply with: 1) Address, 2) Is your back gate at least 36 inches wide? 3) Do you have pets? 4) Do you want weekly or bi-weekly service?"

### Onboarding Confirmation (Card-on-File Required)

> "You're on the route for [Day]! Service is $[Cash/Regular Pricing]. No service is scheduled until your card is secured in our portal. Please ensure gates are unlocked and pets/toys are inside by 8 AM. Reply YES to confirm."

### Access Failure (The No-Access, No-Mow Rule)

> "We arrived for service but could not gain access ([Gate Locked / Dog Out]). To stay on schedule, we have skipped service today. Per our policy, a trip fee has been applied. Please clear access for next week so we don't have to skip twice!"

---

## 4. Web Landing Page Structure & Copy Specifications

The website (lawnsbytimmy.com) must function as an automated lead-capture machine.

- **Primary Conversion Elements:** "Get Instant Quote" CTA buttons in the header. The New Client Form must require: Name, Email, Phone, Address, Gate Width, and Budget.
- **Unique Selling Proposition (USP) Copy:**
  - The Pro Look: "Crisp sidewalk edging and debris-free driveways, every time."
  - The Reliability Guarantee: "Density-based routing means we show up on your assigned day, rain or shine (within 24-48 hours of heavy rain)."
- **Trust Signals:** "Before & After" galleries. Mention the "Digital Door Hanger" with photo proof of every completed mow.

---

## 5. Post-Service SMS Satisfaction & Google Review Collection

### The "Digital Door Hanger" (Immediate)

Sent via BusinessLaunchOS immediately upon job completion:

> "Service Complete! [Attach Photo]. Timmy's crew just finished your stripes. Gate is locked and driveway is blown off. See you next week!"

### The 5-Star Review Trigger (2 Hours Post-Service)

> "How does the lawn look? If you love the look, would you mind leaving us a quick Google review? It helps us stay in your neighborhood! [Link]"

### Issue Resolution Protocol

Any complaint in the first 30 days requires a **Same-Day CRM Note** and a **Dated Fix** (crew returns within 24 hours). Consistency is the product; callbacks are the enemy.

---

## 6. 90-Day Seasonal Re-Engagement & Win-Back Campaign

| Timeline | Stage | Objective |
|---|---|---|
| Day 0 | Welcome | Intro the crew; re-state Access Rules (Card-on-File verified). |
| Day 14 | The Check-In | Collect feedback on the first two visits to stop early churn. |
| Day 30 | Review Request | Leverage the 1-month milestone for a public Google Review. |
| Day 45 | High-Margin Upsell | Aeration ($150) or Overseeding promotion. |
| Day 75 | Seasonal Transition | Spring Cleanup ($20 Discount) for new full-season signups. |
| Day 90 | Cold Lead Win-Back | "We Miss You" offer with a $20 discount on the next cleanup. |

---

## 7. Internal "Success Indicator" Performance Benchmarks

Management must track these KPIs through BusinessLaunchOS to ensure SOP compliance.

| Metric | Target Benchmark | Source of Data |
|---|---|---|
| Lead Response Time | < 60 Seconds | SkipCalls Logs |
| Conversion Velocity | 50% Faster than Industry | CRM Pipeline Stages |
| Task Error Rate | 0% Manual Errors | CRM Audit / Callbacks |
| Admin Time Saved | 15–20 Hours/Week | CRM vs. Manual Tracking |
| Route Density | 10+ Jobs per Zip/Pocket | Scheduling Software |
| Onboarding Speed | Quote to Board < 48 Hours | BusinessLaunchOS |
