# Social Content System — Personal Brand Mode

Replaces the "advertising" posting mode in the Make.com scenario
(Sheets → Gemini → Router → Facebook/LinkedIn).

The scenario wiring does not change. Two things change:

1. **What the Sheet feeds the AI** — story seeds instead of topics.
2. **The prompt inside the Gemini module** — the block in Part 3 below.

---

## Why the current posts don't get clicks

The current instructions tell the agent to find a bottleneck, show the
financial loss ("Agitation"), feature a trending product, bridge to Fork
Algorithm, and drive to the site. That is a competent ad. It is structurally
an ad, and it will read as one no matter how good the writing gets.

Ad-mode posts are generated from a *topic*. "Find a bottleneck in the roofing
industry" produces something true, generic, and skippable — because a thousand
accounts could have written it. There is no reason to follow the person who
posted it.

Personal-brand posts are generated from a *fact only you know*. Twenty years
on restaurant floors, South Beach, Darden, lawn crews, pools, trees. That
inventory is the moat. An AI cannot invent it, and a competitor cannot copy it.

So the input column changes from a keyword to a memory. **This is the whole
pivot.** If the Sheet keeps feeding topics, a better prompt just produces
better-written ads.

---

## Part 1 — The Sheet

Your scenario already points at the **`Content`** tab of the `Leads (Responses)`
spreadsheet, which currently runs:

> Timestamp · Category · Segment · Facebook · Linkedin · Image Link ·
> Instagram · Image Link · Pinterest · Status

That's an *output* layout — columns the scenario writes into. There's nowhere
for you to put the raw material, which is why the agent has to invent the
subject of every post from a hardcoded instruction.

Add these input columns to the left of the existing ones (or start a clean tab
and keep the old one for history). The agent reads one row per run.

| Col | Name | What goes in it | Example |
|-----|------|-----------------|---------|
| A | `id` | Row number, for tracking | `047` |
| B | `pillar` | One of the five in Part 2 | `Floor Stories` |
| C | `seed` | **Your own words, 1–3 sentences.** Rough is fine. Don't polish it — the AI polishes, you supply truth. | `Friday night at Darden, phone rings during a rush, nobody picks up. Found out later it was a 40-top asking about catering.` |
| D | `detail` | One concrete specific: a number, a time, a dish, a tool, a name | `40-top` |
| E | `takeaway` | What an owner should actually do with it | `The call you miss at your busiest hour is worth more than the one you catch at your slowest.` |
| F | `audience` | `trades` / `restaurant` / `both` | `restaurant` |
| G | `cta` | `none` / `soft` / `tool` / `book` | `none` |
| H | `platform` | `facebook` / `linkedin` / `instagram` / `pinterest` / `all` | `all` |
| I | `status` | `ready` / `generated` / `posted` | `ready` |
| J | `generated_caption` | Write-back column — the scenario fills this | *(blank)* |

Filter the Sheets module on `status = ready` so it only picks up rows you've
finished writing.

**Fill 20 rows of column C in one sitting.** That is roughly a month of
content, and it's the only part nobody can do for you. Everything downstream
is automated.

---

## Part 2 — The five pillars

Built on the Brand OS layers: Identity → Authority → Business Asset.

**1. Floor Stories** *(Identity)*
A moment from the 20 years. A rush, a bad night, a save, a customer, a boss.
No lesson forced on the end — the story carries it. These build the person.

**2. The Tell** *(Authority)*
A small observable detail that reveals how a business is really run. "You can
tell how a kitchen is managed by where the tickets pile up." Proves you see
what others miss. These build the expert.

**3. Uncounted Numbers** *(Authority)*
The costs nobody tracks: missed calls, response time, the lead that hired the
guy who answered first. Illustrative estimates only, never guarantees.

**4. Building It** *(Business Asset)*
What you're building at Fork Algorithm right now, in public. Something that
broke, something that worked, something you're deciding. This is where the
tool gets mentioned — as a thing you're making, not a thing you're selling.

**5. Straight Talk** *(Business Asset)*
Direct advice to an owner, with no pitch at the end. Giving away the answer
for free is what makes people trust you enough to click.

### Weekly rotation

| Day | Pillar | `cta` |
|-----|--------|-------|
| Mon | Floor Stories | `none` |
| Tue | The Tell | `none` |
| Wed | Uncounted Numbers | `soft` |
| Thu | Building It | `tool` |
| Fri | Straight Talk | `none` |

**Four of five posts ask for nothing.** That ratio is what separates a brand
from a feed of ads. The one post that does ask converts far better than five
that all ask, because by then you've earned it.

---

## Part 3 — The prompt

Goes in the **Instructions** box of the AI Agent module (module 3,
"Lead Qualification Agent") — replacing what's there now.

Swap `{{seed}}`, `{{detail}}` etc. for your actual module mappings once the
Sheets trigger is wired up (see Part 4). Until then you can paste a seed
directly into the **Input** field to test.

```
You are writing a social post AS Sisto Cervantes. First person. You are not
writing about him and you are not a brand account.

WHO YOU ARE
Twenty-plus years running restaurant floors and service crews — Darden, South
Beach nightlife, property operations, lawn care, pools, trees. Owner-operator,
Broward County, Florida. You now build automation systems for trade-service
and food businesses under the name Fork Algorithm. You are an operator who
learned to build, not a tech person with opinions about restaurants.

THE MATERIAL
Pillar: {{pillar}}
Seed (your actual memory, in your words): {{seed}}
Concrete detail that must survive into the post: {{detail}}
Takeaway: {{takeaway}}
Audience: {{audience}}
CTA mode: {{cta}}
Platform: {{platform}}

HOW TO WRITE IT
- Open with the concrete moment. No question hooks ("Ever wonder...?"), no
  "Here's the thing", no "Let me tell you a story", no throat-clearing.
- The exact detail in {{detail}} must appear literally in the post. It is the
  proof you were actually there.
- Short sentences. Plain words. The way you'd explain it to another owner
  standing in a parking lot, not the way LinkedIn talks.
- One idea per post. Do not stack three lessons.
- You may be blunt. You may be funny. Do not be inspirational.
- End on the takeaway or on the story itself. Do not summarize what you just
  said.

CTA MODE
- none: no link, no ask, no "DM me". The post ends and that's it.
- soft: end with a genuine question to the reader about their own operation.
- tool: mention the free AI recipe tool at forkalgorithm.com as something you
  built and are still working on. One sentence. No feature list, no benefits
  language. "Free, no signup" is allowed.
- book: one plain line that you help trade and food businesses stop losing
  calls, and they can message you. No urgency, no scarcity.

NEVER
- Never call yourself or the work "AI-powered", "AI-driven", "cutting-edge",
  "innovative", "game-changing", "revolutionary", or "next level".
- Never lead with the technology. It runs in the background. Lead with the
  outcome: calls answered, leads that don't leak, follow-up that happens.
- Never promise a specific result, revenue figure, or percentage as a
  guarantee. Illustrative examples must be labeled as examples.
- Never say "in today's fast-paced world", "leverage", "unlock", "elevate",
  "seamless", "solutions", "empower", "delve", "supercharge", "transform".
- No emoji bullet lists. No hashtag walls. No "🚀".
- No fake statistics. If the seed has no number, don't invent one.
- Never write "As someone who..." or "I've seen firsthand".

LENGTH
- facebook_post_text: 60–120 words
- linkedin_post_text: 100–180 words, blank line between short paragraphs

FACEBOOK VS LINKEDIN
These are two different posts about the same seed, not one post copied twice.
Facebook is the parking-lot version: looser, funnier, more personal.
LinkedIn is the same story told to other owners and operators: same voice,
slightly tighter, the takeaway carries a bit more weight. Neither one is
corporate. If the two drafts could be swapped without anyone noticing, you
have written them wrong.

OUTPUT
Fill every field in the response structure. Do not wrap anything in markdown
fences. If a field does not apply, return an empty string rather than
inventing content for it.
```

---

## Part 4 — Fixes needed in the scenario

Read from the exported blueprint of **"Lead Qualification Agent (copy)"**.
Some of these are the personal-brand pivot; some are bugs that are breaking
the scenario right now regardless of what the prompt says.

### 4.1 — LinkedIn is posting the Facebook copy *(bug)*

Module 19 (LinkedIn → Create a Post) maps:

```
content: {{3.jsonResponse.facebook_post_text}}
```

The instructions ask the model for a LinkedIn post with a different tone, but
there is no LinkedIn field in the response structure, so LinkedIn receives the
Facebook text verbatim. Two platforms, one identical post.

**Fix:** add the fields below to the AI Agent's **Response structure**, then
change module 19's Content mapping to `{{3.jsonResponse.linkedin_post_text}}`.

### 4.2 — Response structure

Current fields are `icp_match_score`, `icp_match_reason`, and
`facebook_post_text`. The first two are leftovers from the lead-qualification
scenario this was copied from — nothing downstream reads them, so the model is
spending effort scoring an ICP that no module consumes.

Delete those two. Set the structure to:

| Name | Type | Description |
|------|------|-------------|
| `facebook_post_text` | text, multiline | The Facebook post. |
| `linkedin_post_text` | text, multiline | The LinkedIn post — same seed, different telling. Not a copy. |
| `first_comment` | text, multiline | Link + one line of context, for CTA modes `tool` and `book`. Empty otherwise. |
| `image_prompt` | text | One sentence describing a real, unstaged photo. Never a stock handshake or a person at a laptop. |
| `pillar_used` | text | Which of the five pillars this came from. For your own tracking. |

### 4.3 — The Sheets write-back is broken *(bug)*

Both Google Sheets "Update a Row" modules (10 and 27) map from `{{2.*}}` —
including `rowNumber: {{2.__ROW_NUMBER__}}`. **Module 2 does not exist in the
scenario.** Make already flags this on both:

> 'Google Sheets - Update a Row' [module ID 10] references non-existing
> module [module ID 2].

Module 2 was the Sheets trigger in the scenario this was copied from, and it
didn't come across. So every run either fails at the write-back or updates
nothing, and the `Status` column never advances.

**Fix:** add a Google Sheets **Search Rows** module at the front of the flow,
pointed at the `Content` tab of the `Leads (Responses)` spreadsheet
(`1C-2bEj-128eVy1oru7h7Fc9XvfdQj_b3x1FbPsXavos`), filtered to rows where
Status is `ready`, limit 1. Then re-map both update modules to it.

This is also what makes the story-seed system in Parts 1–2 actually work — the
seed comes from the row instead of from the hardcoded Input.

I'd treat this as its own sitting, separate from the prompt swap. Tell me when
you want to do it and I'll walk it through step by step.

### 4.4 — The Input is hardcoded to roofing

Module 3's **Input** field is:

> `Find a current operational bottleneck in the roofing industry and select a trending product.`

Every single run is about roofing. Once 4.3 is done, map this to the seed
column instead. Until then, paste a different seed in by hand to test.

### 4.5 — The Web Search tool is pointed at the wrong industry

The Web Search tool's prompt describes "an expert Market Intelligence Agent
specializing in the culinary creator space" and asks it to enrich lead
profiles for ICP matching — another leftover.

For personal-brand content you mostly don't want web search running at all:
the material comes from your seed, not the internet. Either remove the tool
from the agent, or replace its prompt with something narrow:

```
Only use this tool when the post needs a fact checked — a date, a name, a
number, an industry term. Return the fact and nothing else. Never return
marketing copy, trend reports, or product recommendations.
```

### 4.6 — Put links in the first comment, not the post

Facebook and LinkedIn both suppress reach on posts containing outbound links.
Post the caption clean, then add a module that comments on your own post with
`first_comment`. This usually moves click numbers more than the copy does,
because the post actually gets shown.

### 4.7 — Small ones

- The MCP Tools module (8) shows a setup error: *"MCP server: Value must not
  be empty."* It'll fail if the agent tries to call it.
- Module 32 (`FunctionIncrement`) increments a counter nothing reads. Harmless,
  but it's dead weight — it was probably the row cursor in the original.
- Rename the scenario. It posts social content; it's still called
  "Lead Qualification Agent (copy)".

### Order I'd do them in

1. **4.1 + 4.2** — prompt and response structure. Biggest change, lowest risk,
   about ten minutes. This alone gets you personal-brand posts and stops
   LinkedIn duplicating Facebook.
2. **4.5 + 4.7** — quick cleanup.
3. **4.3 + 4.4** — the Sheets rebuild. Do this when you have an hour.
4. **4.6** — once the rest is stable.

---

## Part 5 — What to watch

Don't judge this on likes. Track two numbers weekly:

- **Profile visits** — the real personal-brand signal. People who want to know
  who you are.
- **Clicks on the Thursday post** — the only post asking for anything.

If profile visits climb and Thursday clicks stay flat, the CTA needs work.
If profile visits stay flat, the seeds are too generic — go back to column C
and get more specific about what actually happened.

Give it four weeks before changing anything. Personal brand compounds; it does
not spike.
