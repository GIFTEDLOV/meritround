import "./styles.css";

import {
  computeRoundId,
  computeSubmissionId,
  createBrowserTransactionStore,
  loadMeritRoundConfig,
  makeOperationId,
  MeritRoundClient,
  type ResultView,
  type RoundState,
  type RoundView,
  type SubmissionView,
  type EvidenceStatusView,
  type SelectionState,
  type TransactionRecord,
  type TransactionPhase,
  type WalletState,
  WalletError,
} from "./meritroundClient";
import { activityStepIndex, evidenceStatusMeta, selectionStateMeta, stateLabel as uiStateLabel } from "./uiModel";

const config = loadMeritRoundConfig();
const transactionStore = createBrowserTransactionStore();
const client = new MeritRoundClient(config, transactionStore);
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) throw new Error("MeritRound app root is missing");
const root: HTMLDivElement = appRoot;

let wallet: WalletState = { status: "disconnected" };
let notice: { message: string; tone: "info" | "error" | "success" } | undefined;
let renderVersion = 0;
const activeTrackers = new Set<string>();

const STATES: RoundState[] = [
  "DRAFT",
  "OPEN",
  "LOCKED",
  "EVALUATING",
  "FINALIZED",
  "INCONCLUSIVE",
];

const STATE_META: Record<RoundState, { label: string; title: string; description: string }> = {
  DRAFT: {
    label: "Draft",
    title: "Preparing this round",
    description: "Review the rubric, then open the round when you are ready to accept finalists.",
  },
  OPEN: {
    label: "Open",
    title: "Accepting finalists",
    description: "Submissions can be added while the organizer prepares the final set.",
  },
  LOCKED: {
    label: "Locked",
    title: "Finalists locked",
    description: "The rubric, finalist set, and evidence commitments are frozen for evaluation.",
  },
  EVALUATING: {
    label: "Evaluating",
    title: "Validators are reviewing",
    description: "The evaluation transaction is moving through decision and finality checks.",
  },
  FINALIZED: {
    label: "Finalized",
    title: "Decision finalized",
    description: "The contract has stored a canonical result against the locked evaluation universe.",
  },
  INCONCLUSIVE: {
    label: "Inconclusive",
    title: "No winner established",
    description: "Validators did not establish a canonical winner. No finalist was selected by default.",
  },
};

const TX_PHASE_META: Record<TransactionPhase, { label: string; short: string }> = {
  PREPARING: { label: "Preparing", short: "Preparing" },
  WAITING_FOR_WALLET: { label: "Waiting for wallet", short: "Wallet" },
  SUBMITTED: { label: "Submitted", short: "Submitted" },
  QUEUED: { label: "Validators processing", short: "Processing" },
  DECISION_AVAILABLE: { label: "Decision available", short: "Decision" },
  WAITING_FOR_FINALITY: { label: "Waiting for finality", short: "Finalizing" },
  EXECUTION_VERIFIED: { label: "Execution verified", short: "Verified" },
  RESOLVED: { label: "Result confirmed", short: "Completed" },
  FAILED: { label: "Action failed", short: "Failed" },
  TRACKING_INTERRUPTED: { label: "Tracking interrupted", short: "Recoverable" },
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shorten(value: string, length = 10): string {
  if (value.length <= length * 2 + 3) return value;
  return `${value.slice(0, length)}...${value.slice(-length)}`;
}

function formatDate(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(state: string): string {
  return uiStateLabel(state);
}

function stateClass(state: string): string {
  return `state state-${state.toLowerCase()}`;
}

function networkLabel(): string {
  if (config.network === "bradbury") return "Bradbury";
  if (config.network === "studio-dev") return "Studio Dev";
  return config.network === "studionet" ? "Studionet" : "Localnet";
}

function walletLabel(): string {
  if (wallet.status === "unavailable") return "Wallet unavailable";
  if (wallet.status === "wrong-network") return "Switch network";
  if (wallet.status === "connected" && wallet.address) return shorten(wallet.address, 6);
  return "Connect wallet";
}

function walletStatusCopy(): string {
  if (wallet.status === "unavailable") return "No browser wallet detected";
  if (wallet.status === "wrong-network") return `Switch to ${networkLabel()} to write`;
  if (wallet.status === "connected" && wallet.address) return "Connected for organizer actions";
  return "Read-only until a wallet connects";
}

function setNotice(message: string, tone: "info" | "error" | "success" = "info"): void {
  notice = { message, tone };
  void render();
}

function clearNotice(): void {
  notice = undefined;
}

function route(): { path: string; roundId?: string } {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app") return { path: "/" };
  if (parts[1] === "rounds" && parts[2] === "new") return { path: "/app/rounds/new" };
  if (parts[1] === "rounds" && parts[2] && parts[3] === "submit") {
    return { path: "/app/rounds/submit", roundId: parts[2] };
  }
  if (parts[1] === "rounds" && parts[2]) return { path: "/app/rounds/detail", roundId: parts[2] };
  if (parts[1] === "rounds") return { path: "/app/rounds" };
  if (parts[1] === "activity") return { path: "/app/activity" };
  return { path: "/app" };
}

function navigate(path: string): void {
  window.history.pushState({}, "", path);
  clearNotice();
  void render();
}

function pendingTransactions(): TransactionRecord[] {
  return transactionStore.list().filter((record) => !record.terminal);
}

function transactionIndicator(): string {
  const pending = pendingTransactions();
  if (!pending.length) return "";
  return `<a class="tx-indicator" data-link href="/app/activity" aria-label="Open transaction activity"><span class="pulse-dot"></span><span>${pending.length} transaction${pending.length === 1 ? "" : "s"} processing</span></a>`;
}

function shell(content: string, active = ""): string {
  const link = (href: string, label: string, key: string) =>
    `<a class="nav-link ${active === key ? "nav-link-active" : ""}" data-link href="${href}">${label}</a>`;
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" data-link href="/" aria-label="MeritRound home">
          <span class="brand-mark">MR</span>
          <span class="brand-name">MeritRound</span>
        </a>
        <nav class="desktop-nav" aria-label="Primary navigation">
          ${link("/app", "Overview", "app")}
          ${link("/app/rounds", "Rounds", "rounds")}
          ${link("/app/activity", "Activity", "activity")}
        </nav>
        <div class="topbar-actions">
          ${transactionIndicator()}
          <span class="network-chip"><span class="status-dot"></span><span>${networkLabel()}</span></span>
          ${active ? `<a class="button button-small button-top-action" data-link href="/app/rounds/new">New round <span>+</span></a>` : ""}
          <button class="button button-small button-wallet" data-action="${wallet.status === "wrong-network" ? "switch-network" : "connect-wallet"}">${escapeHtml(walletLabel())}</button>
          <details class="mobile-menu">
            <summary aria-label="Open navigation menu">Menu</summary>
            <div class="mobile-menu-panel">
              ${link("/app", "Overview", "app")}
              ${link("/app/rounds", "Rounds", "rounds")}
              ${link("/app/activity", "Activity", "activity")}
              <a class="nav-link" data-link href="/app/rounds/new">New round</a>
            </div>
          </details>
        </div>
      </div>
    </header>
    <main class="page-shell">
      ${notice ? `<div class="notice notice-${notice.tone}" role="status"><span class="notice-icon">${notice.tone === "error" ? "!" : notice.tone === "success" ? "OK" : "i"}</span><span>${escapeHtml(notice.message)}</span></div>` : ""}
      ${content}
    </main>
    <footer class="footer">
      <div><span class="footer-mark">MR</span><span>MeritRound</span></div>
      <span>Validator-backed selection rounds on ${networkLabel()} · Chain ${config.chainId}</span>
    </footer>
  `;
}

function pageHeader(eyebrow: string, title: string, description: string, action = ""): string {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(description)}</p>
      </div>
      ${action ? `<div class="page-header-action">${action}</div>` : ""}
    </section>
  `;
}

function configState(): string {
  return `
    <section class="config-state panel">
      <div class="state-icon state-icon-warning">!</div>
      <div>
        <p class="eyebrow">Configuration required</p>
        <h2>Connect the development contract</h2>
        <p>Reads and writes are disabled until <code>VITE_MERITROUND_CONTRACT_ADDRESS</code> is set for this environment.</p>
        <div class="config-meta"><span>${networkLabel()}</span><span>Chain ${config.chainId}</span><span>No fallback address</span></div>
      </div>
    </section>
  `;
}

function statePill(state: string): string {
  return `<span class="${stateClass(state)}"><span class="state-dot"></span>${escapeHtml(stateLabel(state))}</span>`;
}

function emptyState(title: string, description: string, action = "", icon = "0"): string {
  return `<div class="empty-state panel"><span class="empty-index">${escapeHtml(icon)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${action}</div>`;
}

function loadingState(label = "Reading committed state..."): string {
  return `<div class="loading-state panel"><span class="loader"></span><span>${escapeHtml(label)}</span></div>`;
}

function errorState(title: string, description: string, technical?: string): string {
  return `<section class="error-state panel"><div class="state-icon state-icon-danger">!</div><div><p class="eyebrow">Read interrupted</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${technical ? `<details><summary>Technical details</summary><code>${escapeHtml(technical)}</code></details>` : ""}</div></section>`;
}

function landingPage(): string {
  return `
    <section class="landing-hero">
      <div class="hero-copy">
        <div class="hero-kicker"><span class="kicker-line"></span><span>Decision infrastructure for serious selection</span></div>
        <h1>Choose winners<br /><em>without choosing the judge.</em></h1>
        <p class="hero-lede">MeritRound lets organizers commit a rubric, finalist set, and exact evidence before GenLayer validators independently determine the result.</p>
        <div class="hero-actions">
          <a class="button button-primary button-large" data-link href="/app/rounds/new">Launch MeritRound <span>→</span></a>
          <a class="button button-quiet button-large" data-link href="/app/rounds">Explore the workspace</a>
        </div>
        <div class="hero-proof"><span class="proof-mark">✓</span><span>Locked inputs. Small canonical result. Shared state.</span></div>
      </div>
      <div class="decision-map" aria-label="MeritRound evaluation flow">
        <div class="map-label">Illustrative evaluation flow</div>
        <div class="map-node map-node-primary"><span class="map-number">01</span><div><strong>Committed rubric</strong><small>Criteria written before judging</small></div><span class="node-state">SET</span></div>
        <div class="map-connector"><span></span></div>
        <div class="map-node"><span class="map-number">02</span><div><strong>Finalist evidence</strong><small>Exact bytes · SHA-256 commitment</small></div><span class="node-state">BOUND</span></div>
        <div class="map-connector"><span></span></div>
        <div class="map-node"><span class="map-number">03</span><div><strong>Evaluation lock</strong><small>Rubric and finalist universe frozen</small></div><span class="node-state">LOCKED</span></div>
        <div class="map-connector"><span></span></div>
        <div class="map-node map-node-result"><span class="map-number">04</span><div><strong>Validator decision</strong><small>WINNER or INCONCLUSIVE only</small></div><span class="result-check">✓</span></div>
      </div>
    </section>
    <section class="landing-section split-section">
      <div class="section-intro"><p class="eyebrow">The trust problem</p><h2>A fair decision starts before the vote.</h2></div>
      <div class="section-copy"><p>Organizers know the work. Participants know the stakes. The difficult question is whether the decision can be trusted after the finalist set is fixed.</p><p>MeritRound moves authority into a committed evaluation universe. The rubric, finalist submissions, and evidence commitments become inspectable shared state before semantic evaluation begins.</p></div>
    </section>
    <section class="landing-section flow-section">
      <div class="section-intro"><p class="eyebrow">How it works</p><h2>From brief to result, with the boundary visible.</h2></div>
      <div class="flow-grid">
        <article><span>01</span><h3>Define the rubric</h3><p>Write the criteria that the round will use. The organizer owns the brief, not the final verdict.</p></article>
        <article><span>02</span><h3>Collect submissions</h3><p>Register submissions with HTTPS evidence references and exact SHA-256 commitments; the organizer selects finalists afterward.</p></article>
        <article><span>03</span><h3>Lock the universe</h3><p>Freeze the rubric, finalist set, and evidence commitments so they cannot shift during judging.</p></article>
        <article><span>04</span><h3>Read the result</h3><p>GenLayer validators independently evaluate the same admissible evidence and store a tiny canonical outcome.</p></article>
      </div>
    </section>
    <section class="landing-section why-section">
      <div class="why-card"><p class="eyebrow">Why GenLayer</p><h2>Neutrality is a runtime property.</h2><p>MeritRound does not ask a backend, administrator, or single AI provider to choose a winner. The Intelligent Contract controls admissibility, consensus, strict result validation, and the final state transition.</p><a class="text-link" data-link href="/app">Open the live workspace →</a></div>
      <div class="example-card"><div class="example-card-top"><span class="eyebrow">Illustrative round</span><span class="example-tag">Example only</span></div><h3>Community impact awards</h3><p>Rubric: measurable reach, evidence quality, and durable contribution.</p><div class="example-row"><span>Finalists</span><strong>Locked before evaluation</strong></div><div class="example-row"><span>Authority</span><strong>Canonical contract result</strong></div><div class="example-row"><span>Failure mode</span><strong>Inconclusive is explicit</strong></div></div>
    </section>
    <section class="landing-cta panel"><div><p class="eyebrow">Make the boundary part of the product</p><h2>Give every finalist a decision they can inspect.</h2></div><a class="button button-primary" data-link href="/app/rounds/new">Create a round <span>→</span></a></section>
  `;
}

function roundCard(round: RoundView, result?: ResultView): string {
  const count = round.finalist_ids.length || round.selected_count || round.submission_ids.length;
  const resultCopy = result?.exists
    ? result.outcome === "WINNER"
      ? `Winner ${shorten(result.submission_id ?? "", 6)}`
      : "No winner established"
    : `${count} registered submission${count === 1 ? "" : "s"}`;
  return `
    <a class="round-card" data-link href="/app/rounds/${escapeHtml(round.round_id)}">
      <div class="round-card-top"><span class="round-id">${escapeHtml(shorten(round.round_id, 8))}</span>${statePill(round.state)}</div>
      <h3>${escapeHtml(round.title)}</h3>
      <p>${escapeHtml(round.description)}</p>
      <div class="round-card-meta"><span>${escapeHtml(resultCopy)}</span><span>${escapeHtml(shorten(round.organizer, 6))}</span></div>
    </a>
  `;
}

async function readRoundRegistry(): Promise<Array<{ round: RoundView; result?: ResultView }>> {
  const ids = await client.getRoundIds();
  const rounds = await Promise.all(ids.map((id) => client.getRound(id)));
  const terminal = await Promise.all(rounds.map(async (round) => {
    if (round.state !== "FINALIZED" && round.state !== "INCONCLUSIVE") return undefined;
    try {
      return await client.getResult(round.round_id);
    } catch {
      return undefined;
    }
  }));
  return rounds.map((round, index) => ({ round, result: terminal[index] }));
}

function transactionTimeline(record: TransactionRecord, compact = false): string {
  const meta = TX_PHASE_META[record.phase];
  return `<div class="tx-row ${record.terminal ? "tx-row-terminal" : "tx-row-live"}"><span class="tx-status-marker"></span><div class="tx-row-copy"><strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(record.method)} · ${escapeHtml(shorten(record.txId, 10))}</span></div>${compact ? "" : `<time>${escapeHtml(formatDate(record.updatedAt))}</time>`}</div>`;
}

function activityStrip(): string {
  const records = transactionStore.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!records.length) return "";
  return `<section class="activity-strip panel"><div class="section-heading"><div><p class="eyebrow">Browser activity</p><h2>Transaction trail</h2></div><a class="text-link" data-link href="/app/activity">View activity →</a></div>${records.slice(0, 3).map((record) => transactionTimeline(record)).join("")}</section>`;
}

function walletPanel(): string {
  const action = wallet.status === "wrong-network"
    ? `<button class="button button-small button-secondary" data-action="switch-network">Switch network</button>`
    : wallet.status === "connected"
      ? `<span class="connected-label"><span class="status-dot"></span>Connected</span>`
      : `<button class="button button-small button-quiet" data-action="connect-wallet">Connect wallet</button>`;
  return `<div class="wallet-panel panel"><div class="wallet-panel-icon">${wallet.status === "connected" ? "✓" : "◌"}</div><div><p class="eyebrow">Wallet access</p><strong>${escapeHtml(wallet.status === "connected" && wallet.address ? shorten(wallet.address, 8) : walletStatusCopy())}</strong><p>${escapeHtml(walletStatusCopy())}</p></div>${action}</div>`;
}

async function dashboardPage(): Promise<string> {
  if (!client.isConfigured) return pageHeader("Workspace", "A clear place to decide", "Connect the deployed MeritRound contract to begin.") + configState();
  let registry: Array<{ round: RoundView; result?: ResultView }>;
  try {
    registry = await readRoundRegistry();
  } catch (error) {
    return pageHeader("Workspace", "Unable to read the registry", "The app could not read the configured contract.") + errorState("The round registry is unavailable", "Check the network connection and try again.", error instanceof Error ? error.message : "Network read failed");
  }
  const rounds = registry.map((entry) => entry.round);
  const counts = STATES.reduce<Record<string, number>>((result, state) => {
    result[state] = rounds.filter((round) => round.state === state).length;
    return result;
  }, {});
  const mine = wallet.address ? rounds.filter((round) => round.organizer.toLowerCase() === wallet.address?.toLowerCase()) : [];
  return `
    ${pageHeader("Overview", "Selection, without the fog", `A live view of committed round state on ${networkLabel()}.`, `<a class="button button-primary" data-link href="/app/rounds/new">Create round <span>+</span></a>`)}
    ${walletPanel()}
    <section class="metric-grid">
      <div class="metric-card metric-card-feature"><span>Total rounds</span><strong>${rounds.length}</strong><small>Committed on-chain</small><i>Registry</i></div>
      <div class="metric-card"><span>Open</span><strong>${counts.OPEN ?? 0}</strong><small>Accepting finalists</small></div>
      <div class="metric-card"><span>In evaluation</span><strong>${(counts.LOCKED ?? 0) + (counts.EVALUATING ?? 0)}</strong><small>Locked or reviewing</small></div>
      <div class="metric-card"><span>Completed</span><strong>${(counts.FINALIZED ?? 0) + (counts.INCONCLUSIVE ?? 0)}</strong><small>Terminal results</small></div>
    </section>
    ${pendingTransactions().length ? `<section class="pending-panel panel"><div><p class="eyebrow">Needs attention</p><h2>${pendingTransactions().length} transaction${pendingTransactions().length === 1 ? "" : "s"} still processing</h2><p>MeritRound is tracking the same transaction ID. Refreshing will not create another write.</p></div><a class="button button-secondary" data-link href="/app/activity">Open activity</a></section>` : ""}
    <section class="dashboard-columns">
      <div><div class="section-heading"><div><p class="eyebrow">Live registry</p><h2>Recent rounds</h2></div><a class="text-link" data-link href="/app/rounds">Browse all →</a></div>${rounds.length ? `<div class="round-grid">${registry.slice(-4).reverse().map((entry) => roundCard(entry.round, entry.result)).join("")}</div>` : emptyState("Nothing committed yet", "Create the first round and give the judging universe a clear boundary.", `<a class="button button-primary" data-link href="/app/rounds/new">Create first round</a>`, "01")}</div>
      <aside class="aside-stack"><div class="organizer-card"><p class="eyebrow">Your workspace</p><strong>${mine.length}</strong><p>${wallet.address ? "rounds organized by this wallet" : "Connect a wallet to see organizer activity"}</p><a data-link href="/app/rounds" class="text-link">Browse the registry →</a></div>${activityStrip()}</aside>
    </section>
  `;
}

async function roundsPage(): Promise<string> {
  if (!client.isConfigured) return pageHeader("Registry", "Rounds", "Every card below comes from contract readback.") + configState();
  const filter = new URLSearchParams(window.location.search).get("state") || "ALL";
  try {
    const registry = await readRoundRegistry();
    const visible = filter === "ALL" ? registry : registry.filter((entry) => entry.round.state === filter);
    return `
      ${pageHeader("Registry", "Rounds", "A professional directory of committed selection rounds.", `<a class="button button-primary" data-link href="/app/rounds/new">New round <span>+</span></a>`)}
      <div class="filter-bar panel"><span class="filter-label">Round state</span><div class="filter-pills"><a data-link class="filter-pill ${filter === "ALL" ? "filter-pill-active" : ""}" href="/app/rounds">All <span>${registry.length}</span></a>${STATES.map((state) => `<a data-link class="filter-pill ${filter === state ? "filter-pill-active" : ""}" href="/app/rounds?state=${state}">${escapeHtml(stateLabel(state))} <span>${registry.filter((entry) => entry.round.state === state).length}</span></a>`).join("")}</div></div>
      ${visible.length ? `<div class="round-grid round-grid-wide">${visible.map((entry) => roundCard(entry.round, entry.result)).join("")}</div>` : emptyState(filter === "ALL" ? "No rounds yet" : `No ${stateLabel(filter).toLowerCase()} rounds`, "Try another state or create the next round.", `<a class="button button-primary" data-link href="/app/rounds/new">Create a round</a>`, "00")}
    `;
  } catch (error) {
    return pageHeader("Registry", "Rounds", "The contract registry could not be read.") + errorState("Rounds are unavailable", "The network did not return a usable registry read.", error instanceof Error ? error.message : "Network read failed");
  }
}

function newRoundPage(): string {
  return `
    ${pageHeader("New round", "Define the decision", "A focused workflow for writing the rubric that finalists will be judged against.", `<a class="text-link" data-link href="/app/rounds">Back to rounds</a>`)}
    <div class="workflow-steps"><div class="workflow-step workflow-step-active"><span>01</span><strong>Details</strong><small>What is being selected?</small></div><div class="workflow-step"><span>02</span><strong>Rubric</strong><small>How will it be judged?</small></div><div class="workflow-step"><span>03</span><strong>Review</strong><small>Commit the brief</small></div></div>
    <form class="form-layout panel" data-form="create-round">
      <div class="form-main">
        <div class="form-section-heading"><span class="section-number">01</span><div><h2>Round details</h2><p>Name the selection and give participants enough context to understand the brief.</p></div></div>
        <label>Round title<input required name="title" maxlength="160" placeholder="e.g. Spring design challenge" /></label>
        <label>Description<textarea required name="description" maxlength="4000" rows="4" placeholder="What is this round selecting, and who is it for?"></textarea></label>
        <div class="form-section-heading form-section-heading-spaced"><span class="section-number">02</span><div><h2>Committed rubric</h2><p>This text becomes part of the locked evaluation universe. Write criteria a validator can apply to evidence.</p></div></div>
        <label><span>Evaluation rubric</span><textarea required name="rubric" maxlength="12000" rows="9" placeholder="Describe what a strong submission demonstrates, how criteria relate, and what evidence should count."></textarea><small>Guidance is not authoritative. Only the submitted rubric enters contract state.</small></label>
        <div class="form-submit-row"><div><span class="form-footnote">${networkLabel()} · Chain ${config.chainId}</span><span class="form-footnote">Organizer: ${escapeHtml(wallet.address ? shorten(wallet.address, 8) : "Connect wallet at submit")}</span></div><button class="button button-primary button-large" type="submit">Review and create <span>→</span></button></div>
      </div>
      <aside class="review-aside">
        <div class="review-card"><p class="eyebrow">03 · Review</p><h3>Your committed brief</h3><div class="review-field"><span>Title</span><strong data-review="title">No title yet</strong></div><div class="review-field"><span>Description</span><strong data-review="description">No description yet</strong></div><div class="review-field"><span>Rubric</span><strong data-review="rubric">No rubric yet</strong></div></div>
        <div class="boundary-note"><span class="note-symbol">↗</span><div><strong>One clear universe</strong><p>MeritRound derives a deterministic round ID from the organizer and these fields. The frontend never chooses a winner.</p></div></div>
        <details class="technical-details"><summary>Technical details</summary><p>Contract method: <code>create_round(title, description, rubric)</code><br />Contract: <code>${escapeHtml(config.contractAddress ?? "not configured")}</code></p></details>
      </aside>
    </form>
  `;
}

function detailActions(round: RoundView, evidenceStatuses: Map<string, EvidenceStatusView>): string {
  const organizer = Boolean(wallet.address && wallet.address.toLowerCase() === round.organizer.toLowerCase());
  const actions: string[] = [];
  if (round.state === "DRAFT" && organizer) {
    actions.push(`<button class="button button-primary" data-action="contract-write" data-method="open_round" data-round-id="${escapeHtml(round.round_id)}">Open submissions <span>→</span></button>`);
  }
  if (round.state === "OPEN") {
    actions.push(`<a class="button button-primary" data-link href="/app/rounds/${escapeHtml(round.round_id)}/submit">Register submission <span>+</span></a>`);
    if (organizer) {
      const canLock = round.selected_count >= 2 && round.selected_count <= 16;
      actions.push(`<button class="button button-secondary" ${canLock ? "" : "disabled"} data-action="contract-write" data-method="lock_round" data-round-id="${escapeHtml(round.round_id)}">Lock selected (${round.selected_count}/16)</button>`);
    }
  }
  if (round.state === "LOCKED" && organizer) {
    const ready = round.finalist_ids.length > 0 && round.finalist_ids.every((id) => evidenceStatuses.get(id)?.status === "READY");
    actions.push(`<button class="button button-primary" ${ready ? "" : "disabled"} data-action="contract-write" data-method="resolve_round" data-round-id="${escapeHtml(round.round_id)}">${ready ? "Evaluate locked finalists" : "Await evidence snapshots"} <span>→</span></button>`);
  }
  return actions.length ? `<div class="detail-actions">${actions.join("")}</div>` : "";
}

function stateBanner(round: RoundView): string {
  const meta = STATE_META[round.state];
  const icon = round.state === "FINALIZED" ? "✓" : round.state === "INCONCLUSIVE" ? "—" : round.state === "LOCKED" ? "⌁" : "○";
  return `<section class="round-state-banner banner-${round.state.toLowerCase()}"><span class="banner-icon">${icon}</span><div><strong>${escapeHtml(meta.title)}</strong><p>${escapeHtml(meta.description)}</p></div>${round.state === "LOCKED" ? `<span class="banner-lock">Evaluation universe frozen</span>` : ""}</section>`;
}

function submissionCardV2(
  submission: SubmissionView,
  round: RoundView,
  organizer: boolean,
  evidenceStatus: EvidenceStatusView | undefined,
  index: number,
): string {
  const selectionState = submission.selection_state as SelectionState;
  const selectionMeta = selectionStateMeta[selectionState];
  const locked = selectionState === "LOCKED_FINALIST";
  const ready = evidenceStatus?.status === "READY";
  const control = round.state === "OPEN" && organizer
    ? `<button class="button button-small button-quiet" data-action="contract-write" data-method="set_finalist" data-round-id="${escapeHtml(round.round_id)}" data-submission-id="${escapeHtml(submission.submission_id)}" data-selected="${selectionState === "SELECTED" ? "false" : "true"}">${selectionState === "SELECTED" ? "Deselect" : "Select finalist"}</button>`
    : "";
  const evidence = locked
    ? `<div class="evidence-status ${ready ? "evidence-status-ready" : "evidence-status-recovery"}"><span>${escapeHtml(evidenceStatusMeta[ready ? "READY" : "NOT_PINNED"].label)}</span><small>${escapeHtml(ready ? "Authenticated snapshot stored; resolution can use these bytes." : "Pin the original or recover an exact-byte HTTPS mirror before resolving.")}</small>${!ready ? `<div class="evidence-actions"><button class="button button-small button-secondary" data-action="contract-write" data-method="pin_evidence" data-round-id="${escapeHtml(round.round_id)}" data-submission-id="${escapeHtml(submission.submission_id)}">Pin original</button><form data-form="recover-evidence" data-round-id="${escapeHtml(round.round_id)}" data-submission-id="${escapeHtml(submission.submission_id)}"><input required type="url" name="recoveryUrl" pattern="https://.*" placeholder="https://exact-byte-mirror.example/evidence.json" aria-label="HTTPS recovery mirror URL" /><button class="button button-small button-quiet" type="submit">Recover mirror</button></form></div>` : ""}</div>`
    : "";
  return `<article class="submission-card ${locked ? "submission-card-locked" : ""}"><div class="submission-card-top"><span class="submission-number">${String(index + 1).padStart(2, "0")}</span><span class="submission-role">${escapeHtml(selectionMeta.label)}</span><span class="evidence-committed">✓ SHA committed</span>${control}</div><h3>${escapeHtml(submission.title)}</h3><p class="submission-byline">Submitted by <code>${escapeHtml(shorten(submission.submitter, 8))}</code></p><p class="selection-copy">${escapeHtml(selectionMeta.description)}</p>${evidence}<div class="submission-card-footer"><a href="${escapeHtml(submission.evidence_url)}" target="_blank" rel="noreferrer">Open provenance URL ↗</a><details><summary>Technical details</summary><div class="evidence-details"><span>Submission ID</span><code>${escapeHtml(submission.submission_id)}</code><span>SHA-256 commitment</span><code>${escapeHtml(submission.expected_sha256)}</code>${evidenceStatus ? `<span>Snapshot</span><code>${escapeHtml(evidenceStatus.status)}</code>` : ""}</div></details></div></article>`;
}

function processPanel(round: RoundView, activity: TransactionRecord[]): string {
  const latest = activity[0];
  const evaluation = activity.find((record) => record.method === "resolve_round");
  const activeEvaluation = evaluation && !evaluation.terminal;
  const steps = [
    ["Rubric committed", true],
    ["Finalists locked", round.finalist_ids.length > 0 || round.selected_count >= 2],
    [activeEvaluation ? TX_PHASE_META[evaluation.phase].label : "Validators evaluate", ["EVALUATING", "FINALIZED", "INCONCLUSIVE"].includes(round.state) || Boolean(evaluation)],
    [round.state === "FINALIZED" || round.state === "INCONCLUSIVE" ? "Result read back" : "Result read back", round.state === "FINALIZED" || round.state === "INCONCLUSIVE"],
  ] as Array<[string, boolean]>;
  return `<div class="panel process-panel"><div class="section-heading"><div><p class="eyebrow">Decision path</p><h2>${activeEvaluation ? "Evaluation in progress" : "From brief to result"}</h2></div>${latest && !latest.terminal ? `<span class="live-label"><span class="pulse-dot"></span>Live</span>` : ""}</div><div class="process-list">${steps.map(([label, done]) => `<div class="process-step ${done ? "process-step-done" : ""}"><span class="process-marker">${done ? "✓" : ""}</span><span>${escapeHtml(label)}</span></div>`).join("")}</div>${evaluation?.error ? `<div class="inline-warning"><strong>Evaluation needs review</strong><p>${escapeHtml(evaluation.error)}</p><span>No winner was selected and the round was not blindly resubmitted.</span></div>` : ""}</div>`;
}

function resultPanel(result: ResultView, submissions: SubmissionView[], activity: TransactionRecord[]): string {
  const winner = result.submission_id ? submissions.find((submission) => submission.submission_id === result.submission_id) : undefined;
  const proof = [...activity].reverse().find((record) => record.method === "resolve_round" && record.terminal);
  if (result.outcome === "WINNER") {
    return `<section class="result-panel result-winner"><div class="result-eyebrow"><span class="result-star">✦</span><span>MeritRound decision</span></div><p class="result-label">Winner</p><h2>${escapeHtml(winner?.title ?? shorten(result.submission_id ?? "", 12))}</h2><p>Selected against the locked evaluation rubric. The canonical submission ID is the only winner value stored by the contract.</p><div class="winner-meta"><span>Submission ID</span><code>${escapeHtml(result.submission_id ?? "")}</code></div>${proof ? `<details class="proof-details"><summary>Transaction proof</summary><div><span>Transaction ID</span><code>${escapeHtml(proof.txId)}</code><span>Final execution</span><strong>${escapeHtml(proof.latestExecution ?? "Verified")}</strong></div></details>` : ""}</section>`;
  }
  return `<section class="result-panel result-inconclusive"><div class="result-eyebrow"><span class="result-symbol">—</span><span>MeritRound decision</span></div><p class="result-label">Inconclusive</p><h2>No winner was established.</h2><p>Validators could not establish a canonical winner from the committed rubric and evidence. The contract did not default to a finalist.</p>${proof ? `<details class="proof-details"><summary>Transaction proof</summary><div><span>Transaction ID</span><code>${escapeHtml(proof.txId)}</code><span>Execution state</span><strong>${escapeHtml(proof.latestStatus ?? "Final")}</strong></div></details>` : ""}</section>`;
}

function lockedEvaluationNotice(activity: TransactionRecord[]): string {
  const failed = [...activity].reverse().find((record) => record.method === "resolve_round" && record.phase === "FAILED");
  if (!failed) return "";
  return `<section class="evaluation-failure panel"><div class="state-icon state-icon-warning">!</div><div><p class="eyebrow">Evaluation did not complete</p><h2>Finalist evidence could not be established.</h2><p>The transaction reached a terminal non-success state. No winner was selected, the round remains locked, and MeritRound did not blindly resubmit.</p><details><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify({ transactionId: failed.txId, status: failed.latestStatus, result: failed.latestResult, error: failed.error }, null, 2))}</pre></details></div></section>`;
}

async function detailPage(roundId: string): Promise<string> {
  if (!client.isConfigured) return pageHeader("Round", "Not configured", "The round detail page needs a configured contract.") + configState();
  try {
    const round = await client.getRound(roundId);
    const submissions = await Promise.all(round.submission_ids.map((id) => client.getSubmission(id)));
    const result: ResultView = round.state === "FINALIZED" || round.state === "INCONCLUSIVE"
      ? await client.getResult(roundId)
      : { exists: false };
    const evidenceStatuses = new Map<string, EvidenceStatusView>();
    await Promise.all(round.finalist_ids.map(async (submissionId) => {
      evidenceStatuses.set(submissionId, await client.getEvidenceStatus(roundId, submissionId));
    }));
    const activity = transactionStore.list()
      .filter((record) => record.roundId === roundId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const organizer = Boolean(wallet.address && wallet.address.toLowerCase() === round.organizer.toLowerCase());
    const readyCount = round.finalist_ids.filter((id) => evidenceStatuses.get(id)?.status === "READY").length;
    const submissionMarkup = submissions
      .map((submission, index) => submissionCardV2(submission, round, organizer, evidenceStatuses.get(submission.submission_id), index))
      .join("");
    return `
      <div class="detail-top"><a class="back-link" data-link href="/app/rounds">← All rounds</a>${statePill(round.state)}<span class="detail-top-id">${escapeHtml(shorten(round.round_id, 12))}</span></div>
      <section class="detail-hero"><div><p class="eyebrow">Selection round</p><h1>${escapeHtml(round.title)}</h1><p class="detail-description">${escapeHtml(round.description)}</p><div class="organizer-line"><span>Organized by</span><code>${escapeHtml(shorten(round.organizer, 10))}</code></div></div>${detailActions(round, evidenceStatuses)}</section>
      ${stateBanner(round)}
      ${round.state === "LOCKED" ? lockedEvaluationNotice(activity) : ""}
      <section class="detail-grid"><div class="detail-main">
        <section class="panel rubric-panel"><div class="section-heading"><div><p class="eyebrow">Committed rubric</p><h2>The judging boundary</h2></div><span class="lock-mark">⌁</span></div><p class="rubric-text">${escapeHtml(round.rubric)}</p><div class="digest-line"><span>Evaluation universe digest</span><code>${escapeHtml(round.evaluation_universe_digest ? shorten(round.evaluation_universe_digest, 18) : "Pending lock")}</code></div></section>
        <section class="finalists-section"><div class="section-heading"><div><p class="eyebrow">Submission registry</p><h2>${submissions.length} registered submission${submissions.length === 1 ? "" : "s"}</h2></div>${round.state === "OPEN" ? `<span class="muted">Select finalists before lock</span>` : `<span class="muted">${round.finalist_ids.length} locked finalist${round.finalist_ids.length === 1 ? "" : "s"}</span>`}</div>${submissions.length ? `<div class="submission-list">${submissionMarkup}</div>` : emptyState("No submissions yet", "Open the round to begin accepting submissions.", "", "01")}</section>
      </div><aside class="detail-aside">
        <div class="panel fact-panel"><div class="section-heading"><div><p class="eyebrow">Round facts</p><h2>At a glance</h2></div></div><dl><div><dt>Organizer</dt><dd>${escapeHtml(shorten(round.organizer, 8))}</dd></div><div><dt>State</dt><dd>${escapeHtml(stateLabel(round.state))}</dd></div><div><dt>Registered</dt><dd>${round.submission_ids.length}</dd></div><div><dt>Selected</dt><dd>${round.selected_count}</dd></div><div><dt>Locked finalists</dt><dd>${round.finalist_ids.length || "Not locked"}</dd></div>${round.state === "LOCKED" ? `<div><dt>Evidence ready</dt><dd>${readyCount}/${round.finalist_ids.length}</dd></div>` : ""}<div><dt>Evidence rule</dt><dd>HTTPS + SHA-256</dd></div></dl></div>
        ${result.exists ? resultPanel(result, submissions, activity) : processPanel(round, activity)}
        <details class="panel technical-round-details"><summary>Technical details</summary><div><span>Round ID</span><code>${escapeHtml(round.round_id)}</code><span>Organizer</span><code>${escapeHtml(round.organizer)}</code><span>Evaluation digest</span><code>${escapeHtml(round.evaluation_universe_digest || "Not locked")}</code></div></details>
      </aside></section>
      ${activity.length ? `<section class="detail-activity"><div class="section-heading"><div><p class="eyebrow">Relevant activity</p><h2>Transaction history for this round</h2></div><a class="text-link" data-link href="/app/activity">View all →</a></div><div class="panel detail-activity-list">${activity.slice(0, 3).map((record) => transactionTimeline(record)).join("")}</div></section>` : ""}
    `;
  } catch (error) {
    return pageHeader("Round", "Round unavailable", "The requested round could not be read from the configured contract.") + errorState("This round is unavailable", "Check the round ID and network connection.", error instanceof Error ? error.message : "Network read failed");
  }
}

async function submitPage(roundId: string): Promise<string> {
  if (!client.isConfigured) return pageHeader("Submission", "Not configured", "The submission page needs a configured contract.") + configState();
  try {
    const round = await client.getRound(roundId);
    if (round.state !== "OPEN") return pageHeader("Submission", "Submissions are closed", "This round is no longer accepting additions.") + `<div class="closed-round panel"><span class="state-icon">${round.state === "LOCKED" ? "⌁" : "—"}</span><div><p class="eyebrow">${escapeHtml(stateLabel(round.state))}</p><h2>${escapeHtml(round.title)}</h2><p>The contract is currently ${escapeHtml(stateLabel(round.state).toLowerCase())}. The finalist set cannot be changed.</p><a class="button button-secondary" data-link href="/app/rounds/${escapeHtml(roundId)}">Back to round</a></div></div>`;
    return `
      ${pageHeader("Register submission", round.title, "Register a submission with an exact HTTPS evidence commitment. Registration does not make it a finalist; the organizer selects finalists before lock.", `<a class="text-link" data-link href="/app/rounds/${escapeHtml(roundId)}">Back to round</a>`)}
      <div class="submission-workflow"><div class="workflow-steps"><div class="workflow-step workflow-step-active"><span>01</span><strong>Evidence</strong><small>Reference exact bytes</small></div><div class="workflow-step"><span>02</span><strong>Commitment</strong><small>Bind the SHA-256</small></div><div class="workflow-step"><span>03</span><strong>Register</strong><small>Write shared state</small></div></div><form class="form-layout panel" data-form="submit-submission" data-round-id="${escapeHtml(roundId)}"><div class="form-main"><label>Submission name or title<input required name="title" maxlength="160" placeholder="Name the work, team, or proposal" /></label><label>Evidence URL<input required type="url" name="evidenceUrl" maxlength="512" pattern="https://.*" placeholder="https://example.com/exact-evidence.json" /><small>HTTPS only. This URL is provenance and transport; the SHA-256 is the evidence identity.</small></label><div class="hash-field"><label>Expected SHA-256<input required name="expectedSha256" minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" placeholder="64 lowercase hexadecimal characters" /></label><button class="button button-quiet" type="button" data-action="hash-evidence">Calculate locally</button></div><div class="assistance-note"><span>i</span><p>Local calculation is convenience only. The contract authenticates exact bytes before semantic evaluation. Browser CORS or source availability may prevent local calculation.</p></div><div class="submission-review"><p class="eyebrow">Review before registration</p><strong data-review="submission-title">Untitled submission</strong><span data-review="submission-url">No evidence URL yet</span><code data-review="submission-hash">No commitment yet</code></div><button class="button button-primary button-large" type="submit">Register submission <span>→</span></button></div><aside class="review-aside"><div class="review-card"><p class="eyebrow">Round boundary</p><h3>${escapeHtml(round.title)}</h3><div class="review-field"><span>Current state</span><strong>Open for submissions</strong></div><div class="review-field"><span>Round ID</span><strong>${escapeHtml(shorten(roundId, 10))}</strong></div><div class="review-field"><span>Evidence policy</span><strong>HTTPS + exact SHA-256</strong></div></div><div class="boundary-note"><span class="note-symbol">⌁</span><div><strong>Selection happens separately</strong><p>Registering a submission does not automatically make it a finalist. Only an organizer-selected submission enters the locked evaluation universe.</p></div></div><details class="technical-details"><summary>Technical details</summary><p><code>register_submission(round_id, title, evidence_url, expected_sha256)</code></p></details></aside></form></div>
    `;
  } catch (error) {
    return pageHeader("Submission", "Round unavailable", "The round could not be read.") + errorState("Submission is unavailable", "The network did not return the round state.", error instanceof Error ? error.message : "Network read failed");
  }
}

function activitySteps(record: TransactionRecord): string {
  const labels = record.method === "resolve_round"
    ? ["Evaluation submitted", "Validators reviewing finalists", "Decision available", "Finalizing", "Result confirmed"]
    : ["Transaction submitted", "Validators processing", "Decision available", "Finalizing", "State confirmed"];
  const current = activityStepIndex(record.phase);
  return `<div class="activity-steps">${labels.map((label, index) => `<div class="activity-step ${record.phase === "FAILED" && index === current ? "activity-step-failed" : index < current || record.phase === "RESOLVED" ? "activity-step-done" : index === current ? "activity-step-current" : ""}"><span>${index < current || record.phase === "RESOLVED" ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>${label}</strong></div>`).join("")}</div>`;
}

function activityPage(): string {
  const records = transactionStore.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `
    ${pageHeader("Activity", "A transparent transaction trail", "Every returned transaction ID stays visible. Refreshes reconcile the same ID instead of creating a blind retry.")}
    ${records.length ? `<section class="activity-list">${records.map((record) => `<article class="activity-card panel"><div class="activity-card-heading"><div><p class="eyebrow">${escapeHtml(record.method.replaceAll("_", " "))}</p><h2>${escapeHtml(record.roundId ? `Round ${shorten(record.roundId, 8)}` : "Registry action")}</h2><span class="activity-date">Submitted ${escapeHtml(formatDate(record.submittedAt))}</span></div><span class="phase-badge phase-${record.phase.toLowerCase()}">${escapeHtml(TX_PHASE_META[record.phase].short)}</span></div>${activitySteps(record)}<div class="activity-meta"><div><span>Transaction ID</span><code>${escapeHtml(record.txId)}</code></div><div><span>Protocol status</span><strong>${escapeHtml(record.latestStatus ?? "Not read yet")}</strong></div><div><span>Execution</span><strong>${escapeHtml(record.latestExecution ?? "Not read yet")}</strong></div><div><span>State readback</span><strong>${record.phase === "RESOLVED" ? "Expected state" : record.terminal ? "Not confirmed" : "Pending"}</strong></div></div>${record.error ? `<div class="activity-error"><strong>${record.phase === "TRACKING_INTERRUPTED" ? "Tracking interruption" : "Transaction not completed"}</strong><p>${escapeHtml(record.error)}</p>${record.phase === "TRACKING_INTERRUPTED" ? `<span>Your transaction remains recorded and recoverable.</span>` : ""}</div>` : ""}<details class="technical-details"><summary>Technical details</summary><div class="activity-details"><span>Network</span><code>${escapeHtml(record.network)} · ${record.chainId}</code><span>Contract</span><code>${escapeHtml(record.contractAddress)}</code><span>Arguments digest</span><code>${escapeHtml(record.argsDigest)}</code></div></details></article>`).join("")}</section>` : emptyState("No browser activity yet", "When you submit a state-changing action, its transaction ID and lifecycle will appear here.", `<a class="button button-primary" data-link href="/app/rounds">Browse rounds</a>`, "01")}
  `;
}

async function pageForCurrentRoute(): Promise<{ content: string; active: string }> {
  const current = route();
  if (current.path === "/") return { content: landingPage(), active: "" };
  if (current.path === "/app") return { content: await dashboardPage(), active: "app" };
  if (current.path === "/app/rounds") return { content: await roundsPage(), active: "rounds" };
  if (current.path === "/app/rounds/new") return { content: newRoundPage(), active: "rounds" };
  if (current.path === "/app/rounds/detail" && current.roundId) return { content: await detailPage(current.roundId), active: "rounds" };
  if (current.path === "/app/rounds/submit" && current.roundId) return { content: await submitPage(current.roundId), active: "rounds" };
  return { content: activityPage(), active: "activity" };
}

async function render(): Promise<void> {
  const version = ++renderVersion;
  const current = route();
  root.innerHTML = shell(loadingState(), current.path.startsWith("/app") ? (current.path.includes("activity") ? "activity" : current.path.includes("rounds") ? "rounds" : "app") : "");
  try {
    const page = await pageForCurrentRoute();
    if (version !== renderVersion) return;
    root.innerHTML = shell(page.content, page.active);
  } catch (error) {
    if (version !== renderVersion) return;
    root.innerHTML = shell(errorState("Something interrupted this read", "The application could not complete the current view.", error instanceof Error ? error.message : "Unknown application error"));
  }
}

function assertWalletAndConfig(): void {
  if (!client.isConfigured) throw new Error("Configure the development contract before writing.");
  if (wallet.status === "wrong-network") throw new Error(`Switch to ${networkLabel()} (chain ${config.chainId}) before writing.`);
  if (wallet.status !== "connected" || !wallet.address) throw new Error("Connect a wallet before writing.");
}

async function startTracking(record: TransactionRecord): Promise<void> {
  if (activeTrackers.has(record.operationId)) return;
  activeTrackers.add(record.operationId);
  try {
    await client.trackUntilTerminal(record, () => void render(), { intervalMs: 3_000, attempts: 40 });
  } finally {
    activeTrackers.delete(record.operationId);
    void render();
  }
}

async function handleContractWrite(method: string, roundId: string, submissionId?: string, selected?: boolean): Promise<void> {
  try {
    assertWalletAndConfig();
    if (!wallet.address) throw new Error("Connect a wallet before writing.");
    const round = await client.getRound(roundId);
    const organizer = round.organizer.toLowerCase() === wallet.address.toLowerCase();
    let args: unknown[] = [roundId];
    let expectedState: TransactionRecord["expectedState"];

    if (method === "open_round") {
      if (round.state !== "DRAFT" || !organizer) throw new Error("Only the organizer can open this draft round.");
      expectedState = { kind: "round-state", roundId, state: "OPEN" };
    } else if (method === "set_finalist") {
      if (round.state !== "OPEN" || !organizer || !submissionId || selected === undefined) throw new Error("Only the organizer can change selection while the round is open.");
      if (!round.submission_ids.includes(submissionId)) throw new Error("That submission is not registered in this round.");
      const alreadySelected = round.selected_ids.includes(submissionId);
      if (alreadySelected === selected) throw new Error("The requested finalist selection is already authoritative state.");
      args = [roundId, submissionId, selected];
      expectedState = { kind: "round-selection", roundId, submissionId, selected };
    } else if (method === "lock_round") {
      if (round.state !== "OPEN" || !organizer) throw new Error("Only the organizer can lock an open round.");
      if (round.selected_count < 2 || round.selected_count > 16) throw new Error("Select between 2 and 16 finalists before locking.");
      args = [roundId];
      expectedState = { kind: "round-locked", roundId, finalistIds: [...round.selected_ids].sort() };
    } else if (method === "pin_evidence") {
      if (round.state !== "LOCKED" || !submissionId || !round.finalist_ids.includes(submissionId)) throw new Error("Only locked finalists can be pinned.");
      const status = await client.getEvidenceStatus(roundId, submissionId);
      if (status.status === "READY") throw new Error("This finalist already has an authenticated evidence snapshot.");
      args = [roundId, submissionId];
      expectedState = { kind: "evidence-ready", roundId, submissionId };
    } else if (method === "resolve_round") {
      if (round.state !== "LOCKED" || !organizer) throw new Error("Only the organizer can resolve a locked round.");
      const statuses = await Promise.all(round.finalist_ids.map((id) => client.getEvidenceStatus(roundId, id)));
      if (statuses.some((status) => status.status !== "READY")) throw new Error("Resolve is disabled until every locked finalist has a READY evidence snapshot.");
      expectedState = { kind: "round-terminal", roundId, states: ["FINALIZED", "INCONCLUSIVE"] };
    } else {
      throw new Error("Unsupported contract action.");
    }

    const operationId = await makeOperationId(config, wallet.address, method, args);
    const record = await client.sendWriteOnce({ operationId, method, args, expectedState, roundId, ...(submissionId ? { submissionId } : {}) });
    setNotice(`${method === "resolve_round" ? "Evaluation" : "Transaction"} recorded as ${shorten(record.txId, 10)}. MeritRound will track this same ID.`, "success");
    void startTracking(record);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The action could not be submitted.", "error");
  }
}

async function handleRecoverEvidence(form: HTMLFormElement): Promise<void> {
  try {
    assertWalletAndConfig();
    if (!wallet.address || !form.dataset.roundId || !form.dataset.submissionId) throw new Error("Evidence recovery context is missing.");
    const roundId = form.dataset.roundId;
    const submissionId = form.dataset.submissionId;
    const recoveryUrl = String(new FormData(form).get("recoveryUrl") ?? "").trim();
    if (!recoveryUrl.startsWith("https://")) throw new Error("Only HTTPS recovery mirrors are accepted.");
    const round = await client.getRound(roundId);
    if (round.state !== "LOCKED" || !round.finalist_ids.includes(submissionId)) throw new Error("Recovery is allowed only for a locked finalist.");
    const status = await client.getEvidenceStatus(roundId, submissionId);
    if (status.status === "READY") throw new Error("This finalist already has an authenticated evidence snapshot.");
    const args = [roundId, submissionId, recoveryUrl];
    const operationId = await makeOperationId(config, wallet.address, "recover_evidence", args);
    const record = await client.sendWriteOnce({ operationId, method: "recover_evidence", args, expectedState: { kind: "evidence-ready", roundId, submissionId }, roundId, submissionId });
    setNotice(`Evidence recovery recorded as ${shorten(record.txId, 10)}.`, "success");
    void startTracking(record);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Evidence recovery failed.", "error");
  }
}

async function handleCreateRound(form: HTMLFormElement): Promise<void> {
  try {
    assertWalletAndConfig();
    if (!wallet.address) throw new Error("Connect a wallet before writing.");
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const rubric = String(data.get("rubric") ?? "").trim();
    const args = [title, description, rubric];
    const roundId = await computeRoundId(wallet.address, title, description, rubric);
    const operationId = await makeOperationId(config, wallet.address, "create_round", args);
    const record = await client.sendWriteOnce({ operationId, method: "create_round", args, expectedState: { kind: "round-created", roundId }, roundId });
    setNotice(`Round creation recorded as ${shorten(record.txId, 10)}.`, "success");
    void startTracking(record);
    navigate(`/app/rounds/${roundId}`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Round creation failed.", "error");
  }
}

async function handleSubmitSubmission(form: HTMLFormElement): Promise<void> {
  try {
    assertWalletAndConfig();
    if (!wallet.address) throw new Error("Connect a wallet before writing.");
    const roundId = form.dataset.roundId;
    if (!roundId) throw new Error("Round context is missing.");
    const round = await client.getRound(roundId);
    if (round.state !== "OPEN") throw new Error("The contract is no longer accepting submissions.");
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const evidenceUrl = String(data.get("evidenceUrl") ?? "").trim();
    const expectedSha256 = String(data.get("expectedSha256") ?? "").trim().toLowerCase();
    const args = [roundId, title, evidenceUrl, expectedSha256];
    const submissionId = await computeSubmissionId(roundId, wallet.address, title, evidenceUrl, expectedSha256);
    const operationId = await makeOperationId(config, wallet.address, "register_submission", args);
    const record = await client.sendWriteOnce({ operationId, method: "register_submission", args, expectedState: { kind: "submission-registered", roundId, submissionId }, roundId, submissionId });
    setNotice(`Submission registration recorded as ${shorten(record.txId, 10)}.`, "success");
    void startTracking(record);
    navigate(`/app/rounds/${roundId}`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Submission failed.", "error");
  }
}

function updateSubmissionReview(): void {
  const title = document.querySelector<HTMLInputElement>("input[name=title]");
  const url = document.querySelector<HTMLInputElement>("input[name=evidenceUrl]");
  const hash = document.querySelector<HTMLInputElement>("input[name=expectedSha256]");
  const titleReview = document.querySelector<HTMLElement>("[data-review=submission-title]");
  const urlReview = document.querySelector<HTMLElement>("[data-review=submission-url]");
  const hashReview = document.querySelector<HTMLElement>("[data-review=submission-hash]");
  if (titleReview) titleReview.textContent = title?.value.trim() || "Untitled finalist";
  if (urlReview) urlReview.textContent = url?.value.trim() || "No evidence URL yet";
  if (hashReview) hashReview.textContent = hash?.value.trim() || "No commitment yet";
}

async function calculateEvidenceHash(): Promise<void> {
  const urlInput = document.querySelector<HTMLInputElement>("input[name=evidenceUrl]");
  const hashInput = document.querySelector<HTMLInputElement>("input[name=expectedSha256]");
  if (!urlInput || !hashInput || !urlInput.value) return setNotice("Enter an HTTPS evidence URL first.", "error");
  if (!urlInput.value.startsWith("https://")) return setNotice("Only HTTPS evidence URLs are accepted.", "error");
  try {
    setNotice("Fetching exact bytes locally for a convenience hash...", "info");
    const response = await fetch(urlInput.value, { credentials: "omit" });
    if (!response.ok) throw new Error(`Evidence fetch returned HTTP ${response.status}.`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    hashInput.value = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    updateSubmissionReview();
    setNotice("Hash calculated locally. The contract will verify the bytes again.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The browser could not fetch those bytes.", "error");
  }
}

async function showEvaluationModal(roundId: string): Promise<void> {
  try {
    const round = await client.getRound(roundId);
    const submissions = await Promise.all(round.finalist_ids.map((id) => client.getSubmission(id)));
    const evidenceStatuses = await Promise.all(round.finalist_ids.map((id) => client.getEvidenceStatus(roundId, id)));
    if (round.state !== "LOCKED" || evidenceStatuses.some((status) => status.status !== "READY")) {
      setNotice("Resolve remains disabled until every locked finalist has a READY evidence snapshot.", "error");
      return;
    }
    const existing = document.querySelector("[data-modal]");
    existing?.remove();
    document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-modal role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-modal-title"><button class="modal-close" data-action="close-modal" aria-label="Close evaluation confirmation">×</button><p class="eyebrow">Begin evaluation</p><h2 id="evaluation-modal-title">Evaluate the locked finalist set?</h2><p class="modal-lede">This action asks GenLayer validators to inspect the same committed rubric and evidence. The result can be a canonical winner or an explicit inconclusive outcome.</p><div class="modal-summary"><div><span>Round</span><strong>${escapeHtml(round.title)}</strong></div><div><span>Locked finalists</span><strong>${submissions.length}</strong></div><div><span>Evaluation digest</span><code>${escapeHtml(shorten(round.evaluation_universe_digest, 16))}</code></div></div><div class="modal-callout"><span>⌁</span><p>The rubric, finalist set, and evidence commitments are already frozen. If evidence cannot be retrieved or verified, no winner will be selected.</p></div><div class="modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" data-action="confirm-evaluation" data-round-id="${escapeHtml(roundId)}">Begin evaluation <span>→</span></button></div></section></div>`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The locked round could not be read.", "error");
  }
}

function closeModal(): void {
  document.querySelector("[data-modal]")?.remove();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (link) {
    event.preventDefault();
    link.closest("details")?.removeAttribute("open");
    navigate(link.getAttribute("href") ?? "/");
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]");
  if (!action) return;
  const name = action.dataset.action;
  if (name === "close-modal") {
    closeModal();
  } else if (name === "confirm-evaluation" && action.dataset.roundId) {
    const roundId = action.dataset.roundId;
    closeModal();
    void handleContractWrite("resolve_round", roundId);
  } else if (name === "connect-wallet") {
    void client.connectWallet().then((next) => { wallet = next; setNotice("Wallet connected.", "success"); }).catch((error) => {
      if (error instanceof WalletError && error.code === "WRONG_NETWORK") wallet = { status: "wrong-network", address: client.walletAddress, chainId: undefined };
      setNotice(error instanceof Error ? error.message : "Wallet connection failed.", "error");
    });
  } else if (name === "switch-network") {
    void client.switchToConfiguredNetwork().then(async () => { wallet = await client.getWalletState(); setNotice(`Connected to ${networkLabel()}.`, "success"); }).catch((error) => setNotice(error instanceof Error ? error.message : "Network switch failed.", "error"));
  } else if (name === "contract-write" && action.dataset.method && action.dataset.roundId) {
    if (action.dataset.method === "resolve_round") void showEvaluationModal(action.dataset.roundId);
    else void handleContractWrite(action.dataset.method, action.dataset.roundId, action.dataset.submissionId, action.dataset.selected === "true");
  } else if (name === "hash-evidence") {
    void calculateEvidenceHash();
  }
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.form?.dataset.form === "create-round") {
    const review = target.form.querySelector<HTMLElement>(`[data-review="${target.name}"]`);
    if (review) review.textContent = target.value.trim() || `No ${target.name} yet`;
  }
  if (target.form?.dataset.form === "submit-submission") updateSubmissionReview();
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (form.dataset.form === "create-round") void handleCreateRound(form);
  if (form.dataset.form === "submit-submission") void handleSubmitSubmission(form);
  if (form.dataset.form === "recover-evidence") void handleRecoverEvidence(form);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

window.addEventListener("popstate", () => void render());

async function boot(): Promise<void> {
  wallet = await client.getWalletState();
  client.subscribeWallet(() => {
    void client.getWalletState().then((next) => { wallet = next; void render(); });
  });
  if (client.isConfigured) {
    const recovered = await client.recoverPending();
    for (const record of recovered.filter((item) => !item.terminal)) void startTracking(record);
  }
  await render();
}

void boot();
