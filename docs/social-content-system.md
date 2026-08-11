# Social Content System — Personal Brand Mode

Replaces the "advertising" posting mode in the Make.com scenario
(Sheets → Gemini → Router → Facebook/LinkedIn).

The scenario wiring does not change. Two things change:

1. **What the Sheet feeds the AI** — story seeds instead of topics.
2. **The prompt inside the Gemini module** — the block in Part 3 below.

---

## Why the current posts don't get clicks

Ad-mode posts are generated from a *topic*. "Write a post about missed-call
automation for restaurants" produces something true, generic, and skippable —
because a thousand accounts could have written it. There is no reason to
follow the person who posted it.

Personal-brand posts are generated from a *fact only you know*. Twenty years
on restaurant floors, South Beach, Darden, lawn crews, pools, trees. That
inventory is the moat. An AI cannot invent it, and a competitor cannot copy it.

So the input column changes from a keyword to a memory. **This is the whole
pivot.** If the Sheet keeps feeding topics, a better prompt just produces
better-written ads.

---

## Part 1 — The Sheet

Make a new tab called `content_seeds`. The Gemini module reads one row per run.

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

## Part 3 — The Gemini prompt

Paste this into the Gemini module in Make, replacing the current prompt.
Swap `{{seed}}`, `{{detail}}` etc. for your actual module mappings — if your
Sheets module is module 2, they become `{{2.seed}}`, `{{2.detail}}`, and so on.

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
- facebook: 60–120 words
- linkedin: 100–180 words, line breaks between short paragraphs
- instagram: 40–80 words
- pinterest: 30–50 words, plainly descriptive

OUTPUT
Return valid JSON only, no markdown fences:
{
  "caption": "the post text",
  "hashtags": "3 to 5 lowercase hashtags, space separated, no generic ones
   like #business or #entrepreneur",
  "first_comment": "if CTA mode is tool or book, the link goes here with one
   short line of context. Otherwise empty string.",
  "image_prompt": "one sentence describing a photo that matches this post —
   real, unstaged, work-in-progress. Never a stock-photo handshake or a
   person at a laptop."
}
```

---

## Part 4 — Two changes in the scenario

**1. Parse the JSON.** Add a *JSON → Parse JSON* module right after Gemini,
before the Router. Then map `caption`, `hashtags`, `first_comment`, and
`image_prompt` to the platform modules separately. Right now you're likely
posting the raw AI output as one blob.

**2. Put links in the first comment, not the post.** Facebook and LinkedIn
both suppress reach on posts containing outbound links. Post the caption
clean, then add a second module that comments on your own post with
`first_comment`. This alone usually moves click numbers more than the copy
does, because the post actually gets shown.

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
