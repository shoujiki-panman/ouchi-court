# おうち裁判 (Ouchi Court) — a 3-minute AI debate court for kids

> "Alexa, open the court." — a browser recreation of an Alexa+ experience, built for the
> Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ track).

Kids pick a topic ("Should summer vacation be longer?"), take a side, and argue it out
**by voice** against Kon-ta, a cheeky AI fox lawyer. A tanuki clerk runs the court live,
three AI judges vote, and the loser does a silly (never humiliating) penalty.
The look and flow borrow from Danganronpa-style class trials: flying statements, yellow
weak points, "それは違うよ！" cut-ins and shattering-glass "論破！".

Live: https://ouchi-court.panman.workers.dev/

## How a match goes (solo mode)

1. **Pick a topic** — today's trending news (Google Trends, filtered for kids), fresh
   AI-made topics, or classics. Shuffle until one looks fun.
2. **Evidence cards** — the AI hands the child three hint cards (コトダマ) for their side.
3. **Three rounds, three minutes** — the child speaks; each statement is scored in code:
   reason strength 0–3, +1 for an example, +1 for answering Kon-ta, −1 for repeating,
   final round ×2. A close game can trigger a "glitch roulette" overtime round.
4. **Nonstop Debate** — between rounds, Kon-ta's rebuttals fly across the screen with
   yellow weak points. Load the right evidence card and shoot the real weak point.
5. **Verdict** — three judges on three different models vote on slot reels; the chief
   judge reads the verdict aloud; a penalty roulette spins.
6. **Result card** — badges to collect, a rival that levels up, and a challenge image
   ("I scored 12 — can you beat it?") that opens the same topic for a friend.

There is also a two-player mode for settling real sibling arguments.

## Architecture

```
Browser (public/)                      Cloudflare Worker (src/worker.js)
 ├ mic ⇄ Gemini Live API (clerk)  ←──── /api/token   ephemeral token, model pinned
 ├ statement → /api/opponent ─────────► Workers AI (Mistral Small 3.1) → Gemini fallback
 ├ between rounds → /api/debate ──────► Gemini: rebuttal lines + weak point + answer
 ├ game end → /api/verdict ───────────► 3-judge panel (Gemini / Mistral / Llama 4 Scout)
 │                                       code counts the votes; solo follows the score
 │                                       └─ MCP (Streamable HTTP) → oyasumi-mcp
 │                                            get_precedents / file_case  (memory across sessions)
 └ /api/topics /api/kotodama /api/rival /api/penalty-image (FLUX on Workers AI)
```

- **MCP server**: [`oyasumi-mcp`](../oyasumi-mcp) exposes `get_precedents` and `file_case`
  (MCP 2025-11-25, Streamable HTTP). Each verdict is filed as a short precedent (names,
  issue, outcome only) and the next trial can cite it — the court remembers your family.
- **Decisions live in code, not in the model**: vote counting, scoring, who wins, which
  weak point is real, and the kid-safety topic filter are all deterministic.
- **Echo**: an Alexa custom skill version exists (`alexa-oyasumi`), but kids' free speech
  was misrecognized too often, so the web recreation became the main experience.

## Kid safety

- Topics pass an explicit blocklist (accidents, crime, politics, romance…) after the AI picks them.
- Penalties come from a fixed list of 12 harmless, silly actions.
- Sharing never includes the child's name or words — only the topic, side and score.
- Precedents store names, the issue and the outcome summary only.

## Credits

- BGM: 魔王魂 (maou.audio)
- Kon-ta / Pon-ko voices: AivisSpeech (まお・コハク, ACML 1.0)
- Character and courtroom art: generated with FLUX.1 [schnell] on Cloudflare Workers AI
- Sound effects: synthesized in the browser
