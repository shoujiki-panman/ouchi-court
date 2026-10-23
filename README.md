# おうち裁判 (Ouchi Court) — a 3-minute AI debate court for kids

> A **web simulation** of an Alexa+-style voice experience, built for the
> Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ track).
> It is not connected to Alexa+ directly.

Kids pick a topic ("Should summer vacation be longer?"), take a side, and argue it out
**by voice** against Kon-ta, a cheeky AI fox lawyer. A tanuki clerk runs the court live,
three AI judges vote, and the loser does a silly (never humiliating) penalty.

Live: https://ouchi-court.panman.workers.dev/

## How a match goes (solo mode)

1. **Pick a topic** — today's trending topics (filtered for kids), fresh AI-made topics, or classics.
   Shuffle until one looks fun, then pick a side.
2. **Hint cards** — the AI prepares a few short hint chips for the child's side, shown under the topic.
3. **Three rounds by voice** — the clerk (Gemini Live API) runs the court. For each statement an LLM
   judges whether there is a claim, a reason, an example, whether it is on topic, whether it answers
   Kon-ta, whether it repeats an earlier point, and a reason strength 0–3.
   **Code** turns those judgments into points: reason strength, +1 example, +1 for answering the rival,
   −1 for repeating; a claim with no reason gives Kon-ta +2, an off-topic answer gives Kon-ta +3,
   ignoring Kon-ta's rebuttal gives Kon-ta +1; the final round counts double.
4. **Kon-ta rebuts** — after each statement Kon-ta answers back. The rebuttal stays on screen, the clerk
   restates it in simple words and asks the child how they will answer.
5. **Close games** — a tie goes to sudden death. When the score is within 2 points, a "glitch roulette"
   overtime round happens at random (50%).
6. **Verdict** — three judge personas vote and a chief judge reads the verdict aloud; a penalty roulette spins.
   In solo mode the winner is the one with more points: the judges' votes are overwritten with that result.
7. **Result card** — badges, a rival that levels up, and a challenge image ("I scored 12 — can you beat it?")
   that opens the same topic for a friend.

There is also a two-player mode (plaintiff and defendant seats). There, code counts the three judges' votes
(two or more for the same side wins; otherwise a draw).

## Architecture

```
Browser (public/)                      Cloudflare Worker (src/worker.js)
 ├ mic ⇄ Gemini Live API (clerk)  ←──── /api/token   short-lived ephemeral token (single use)
 ├ statement → /api/opponent ─────────► Workers AI (Mistral Small 3.1) → Gemini fallback
 ├ rebuttal fallback → /api/debate ───► Workers AI (Mistral Small 3.1) → Gemini fallback
 ├ game end → /api/verdict ───────────► judge panel + chief judge
 │                                       └─ MCP (Streamable HTTP) → oyasumi-mcp
 │                                            get_precedents / file_case
 └ /api/topics /api/kotodama (hint cards) /api/rival /api/penalty-image (FLUX on Workers AI)
```

- **Judge panel**: three personas, normally on three models (Gemini flash-lite, Mistral Small 3.1,
  Llama 4 Scout on Workers AI). When Workers AI fails or its quota is used up, those seats fall back to
  Gemini, so all three personas can end up on the same model.
- **Chief judge's speech**: requests to Gemini and Mistral start at the same time. Gemini's answer is used
  if it arrives within 6 seconds; otherwise Mistral's (up to 9 seconds); otherwise a fixed template.
- **Ephemeral token**: single use, must connect within 1 minute, expires in 30 minutes. It does **not**
  carry a model constraint; the worker only tells the browser which Live model to use.
- **MCP server**: [`oyasumi-mcp`](https://github.com/shoujiki-panman/oyasumi-mcp) exposes `get_precedents`
  and `file_case` (Streamable HTTP). Each verdict is filed as a short precedent (names, issue, outcome) and
  later verdicts look up precedents **by the names entered**. There is no per-family separation of precedents.
- **Rival record**: kept per device. The browser makes a random ID; the worker stores only its SHA-256 hash
  as the key and only the win/loss/draw counts, level and last result (no topics, no statements).
- **What code decides**: points from the LLM's judgments, the solo winner, vote counting, and the
  kid-safety topic blocklist. What the LLMs decide: the per-statement judgments, rebuttals, judges' votes
  in two-player mode, and all speech.
- **Echo**: an Alexa custom skill prototype exists (`alexa-oyasumi`), but kids' long free-form speech was
  often misrecognized, so the web simulation became the main experience.

## Kid safety

- Topics pass an explicit blocklist (accidents, crime, politics, romance…) after the AI picks them.
- Penalties come from a fixed list of harmless, silly actions.
- Sharing never includes the child's name or words — only the topic, side and score.
- AI and topic text is escaped before it is shown on the page.
- Precedents store names, the issue and the outcome summary only.

## Run it yourself

```bash
npx wrangler deploy   # Cloudflare Workers (static assets + API)
```

Secrets: `GEMINI_API_KEY`, `MCP_TOKEN` (`wrangler secret put …`). Bindings are in `wrangler.toml`
(Workers AI, a KV namespace, and a service binding to the MCP server).

The BGM files are **not included** in this repository: 魔王魂's terms do not allow
redistributing the audio files themselves. Download 「サイバー38」「サイバー40」「サイバー42」
from https://maou.audio and save them as `public/bgm/calm.mp3`, `debate.mp3` and `hot.mp3`.

## License

The original source code in this repository is released under the MIT License (see `LICENSE`).
Third-party dependencies, code, music, images, voice recordings and other assets are not covered
and keep their own terms.

## Credits

- BGM: 魔王魂 (maou.audio)
- Kon-ta / Pon-ko voices: Gemini TTS (pre-recorded lines)
- Character and courtroom art: generated with FLUX.1 [schnell] on Cloudflare Workers AI
- Sound effects: synthesized in the browser
