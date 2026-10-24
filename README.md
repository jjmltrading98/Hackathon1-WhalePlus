# WhalePulse — Autonomous Institutional Options Flow & Self-Learning AI Execution Engine

WhalePulse is an end-to-end quantitative options flow discovery, risk-gated AI decision, smart limit execution, and self-learning attribution platform. It connects live institutional options flow from the **Unusual Whales API**, evaluates candidates using a **self-hosted NVIDIA DGX Spark AI server** (or any OpenAI-compatible local LLM / Gemini API), executes smart midpoint-walking limit orders via **Alpaca**, and recalibrates its own scoring weights from realized and counter-factual trade outcomes.

---

## Core 5-Stage Closed-Loop Architecture

1. **Stage 1 — Institutional Flow Discovery (`Unusual Whales API`)**
   - Ingests live options sweeps and block prints.
   - Scores candidates on a 100-point composite model: **Volume/OI Burst**, **Ask-Side Aggression**, **Gamma Exposure (GEX) Regime**, and **Market Tide Alignment**.
<img width="3962" height="3677" alt="image" src="https://github.com/user-attachments/assets/37a1c9f7-6849-4ca1-b436-2e4d2e08bf02" />
<img width="3960" height="5755" alt="image" src="https://github.com/user-attachments/assets/4b4bc581-bbd0-4c72-82ff-5214d943d0cc" />

2. **Stage 2 — AI Decision Gate (`Self-Hosted NVIDIA DGX Spark / Local LLM / Gemini`)**
   - Routes high-conviction candidates to a self-hosted **NVIDIA DGX Spark** local LLM inference server running concurrent evaluations in parallel.
   - Audits Implied Volatility (IV), bid-ask spread friction, underlying technical structure, and portfolio correlation to issue a strict `BUY`, `HOLD`, or `REJECT` verdict.
<img width="3960" height="4466" alt="image" src="https://github.com/user-attachments/assets/fb269958-b444-45c0-b0bf-94eafbaf144a" />

3. **Stage 3 — Smart Pegged Execution (`Alpaca Trading API`)**
   - Avoids market-order slippage on wide options spreads by placing limit orders at the bid-ask midpoint and automatically walking the limit price in configurable increments (`+$0.02` every `5s`) up to a strict max slippage cap.
<img width="3960" height="3577" alt="image" src="https://github.com/user-attachments/assets/8138ac39-6b8c-4f20-8fe1-ad4915a6c462" />

4. **Stage 4 — Automated Portfolio & Exit Management**
   - Continuously monitors open option positions and enforces automated exit rules: **Take-Profit (+50%)**, **Hard Stop-Loss (-25%)**, **Trailing High-Water Mark Stop**, and **DTE Time-Decay Exit**.
<img width="3962" height="8742" alt="image" src="https://github.com/user-attachments/assets/e4a171bb-af85-4042-a433-b2d5b11cd213" />


5. **Stage 5 — Closed-Loop Bake-Testing & Self-Learning Attribution**
   - Grades historical candidates (including rejected counter-factual signals) against realized post-signal option price bars.
   - Runs a **Baseline vs. Proposed Bake-Test** and automatically recalibrates Stage 1 scoring weights and Stage 2 AI decision thresholds.
<img width="3960" height="7104" alt="image" src="https://github.com/user-attachments/assets/374095c7-02df-4a19-af97-1023e218a30f" />


6. **Broker-Verified Account Overview**
   - Reconciles directly with Alpaca to display multi-timeframe equity and P/L curves, drawdown profiles, ticker leaderboards, and a **FIFO Closed Round-Trip Trade Ledger**.
<img width="3960" height="9633" alt="image" src="https://github.com/user-attachments/assets/bc7647f2-ff2d-4026-ac2d-1bfe7dcd8fcd" />

---

## Getting Started Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and add your API credentials:
```bash
cp .env.example .env
```

Required / Optional Environment Variables in `.env`:
- `UW_API_TOKEN` — Unusual Whales API Bearer token for live options flow & Market Tide data.
- `ALPACA_API_KEY` & `ALPACA_SECRET_KEY` — Alpaca Paper or Live API credentials for market data and smart option execution.
- `GEMINI_API_KEY` — Optional Gemini API key when using cloud LLM fallback.
- `LLM_API_KEY` / `LM_API_TOKEN` — Optional Bearer token if your self-hosted LLM server requires authentication.

*(Note: `.env` and local runtime snapshots in `data/` are excluded via `.gitignore` so API secrets are never committed.)*

### 3. Run the Application
```bash
# Start full-stack development server (Express + Vite on port 3000)
npm run dev

# Build and start for production
npm run build
npm start
```
### My self hosted DGX spark
<img width="1536" height="2048" alt="DGXspark" src="https://github.com/user-attachments/assets/35ca1930-695e-46bd-a6c4-60c8d24399de" />
