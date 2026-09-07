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
  type TransactionRecord,
  type WalletState,
  WalletError,
} from "./meritroundClient";

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
  return `${value.slice(0, length)}…${value.slice(-length)}`;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function stateLabel(state: string): string {
  return state.replaceAll("_", " ").toLowerCase().replace(/(^| )\w/g, (character) => character.toUpperCase());
}

function stateClass(state: string): string {
  return `state state-${state.toLowerCase()}`;
}

function networkLabel(): string {
  return config.network === "studionet" ? "Studionet" : "Localnet";
}

function walletLabel(): string {
  if (wallet.status === "unavailable") return "Wallet unavailable";
  if (wallet.status === "wrong-network") return "Wrong network";
  if (wallet.status === "connected" && wallet.address) return shorten(wallet.address, 6);
  return "Connect wallet";
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

function shell(content: string, active = ""): string {
  const link = (href: string, label: string, key: string) =>
    `<a class="nav-link ${active === key ? "nav-link-active" : ""}" data-link href="${href}">${label}</a>`;
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" data-link href="/">
          <span class="brand-mark">MR</span>
          <span>MeritRound</span>
        </a>
        <nav class="desktop-nav" aria-label="Primary navigation">
          ${link("/app", "Overview", "app")}
          ${link("/app/rounds", "Rounds", "rounds")}
          ${link("/app/activity", "Activity", "activity")}
        </nav>
        <div class="topbar-actions">
          <span class="network-chip"><span class="status-dot"></span>${networkLabel()}</span>
          <button class="button button-small button-quiet" data-action="connect-wallet">${escapeHtml(walletLabel())}</button>
        </div>
      </div>
    </header>
    <main class="page-shell">
      ${notice ? `<div class="notice notice-${notice.tone}" role="status">${escapeHtml(notice.message)}</div>` : ""}
      ${content}
    </main>
    <footer class="footer">
      <span>MeritRound · Validator-backed selection rounds</span>
      <span>Chain ${config.chainId} · ${networkLabel()}</span>
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
      ${action}
    </section>
  `;
}

function configState(): string {
  return `
    <section class="config-state panel">
      <span class="icon-badge">!</span>
      <div>
        <h2>Development contract not configured</h2>
        <p>Reads and writes are disabled until <code>VITE_MERITROUND_CONTRACT_ADDRESS</code> is set for this environment.</p>
        <p class="muted">The repository includes a verified Studionet deployment record, but the app never invents a fallback address.</p>
      </div>
    </section>
  `;
}

function landingPage(): string {
  return `
    <section class="landing-hero">
      <div class="hero-copy">
        <p class="eyebrow">Selection infrastructure for serious rounds</p>
        <h1>Make the decision<br /><em>the thing people trust.</em></h1>
        <p class="hero-lede">MeritRound gives competitions, awards, accelerators, and open calls a committed rubric, committed evidence, and a neutral validator-backed result.</p>
        <div class="hero-actions">
          <a class="button button-primary" data-link href="/app/rounds/new">Launch MeritRound <span>→</span></a>
          <a class="button button-quiet" data-link href="/app/rounds">Explore rounds</a>
        </div>
      </div>
      <div class="hero-visual" aria-label="A locked rubric flows through validators to a final result">
        <div class="signal-card signal-rubric"><span class="signal-number">01</span><div><strong>Rubric locked</strong><small>Committed before judging</small></div></div>
        <div class="signal-line"></div>
        <div class="signal-card signal-evidence"><span class="signal-number">02</span><div><strong>Evidence verified</strong><small>Exact bytes · SHA-256</small></div></div>
        <div class="signal-line"></div>
        <div class="signal-card signal-result"><span class="signal-number">03</span><div><strong>Result agreed</strong><small>GenLayer validators</small></div><span class="result-mark">✓</span></div>
      </div>
    </section>
    <section class="principles-grid">
      <article class="principle-card"><span class="principle-index">01</span><h3>Commit the universe</h3><p>Once finalists are locked, the rubric, set, evidence references, and commitments cannot quietly change.</p></article>
      <article class="principle-card"><span class="principle-index">02</span><h3>Keep evidence untrusted</h3><p>Prompt text inside a submission is data. Exact-byte integrity is checked before semantic evaluation.</p></article>
      <article class="principle-card"><span class="principle-index">03</span><h3>Make the result small</h3><p>Only a canonical winner ID or explicit inconclusive result can affect shared contract state.</p></article>
    </section>
    <section class="landing-note panel"><div class="note-rule"></div><div><p class="eyebrow">Built for the moment after the applause</p><p>Participants should be able to inspect what was committed, how the transaction progressed, and what the contract finally stored.</p></div><a data-link href="/app" class="text-link">Open the workspace →</a></section>
  `;
}

function emptyState(title: string, description: string, action = ""): string {
  return `<div class="empty-state panel"><span class="empty-glyph">○</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${action}</div>`;
}

function loadingState(label = "Reading committed state…"): string {
  return `<div class="loading-state panel"><span class="loader"></span><span>${escapeHtml(label)}</span></div>`;
}

function statePill(state: string): string {
  return `<span class="${stateClass(state)}">${escapeHtml(stateLabel(state))}</span>`;
}

function roundCard(round: RoundView): string {
  return `
    <a class="round-card" data-link href="/app/rounds/${round.round_id}">
      <div class="round-card-top"><span class="round-id">${escapeHtml(shorten(round.round_id, 8))}</span>${statePill(round.state)}</div>
      <h3>${escapeHtml(round.title)}</h3>
      <p>${escapeHtml(round.description)}</p>
      <div class="round-card-meta"><span>${round.finalist_ids.length || round.submission_ids.length} submissions</span><span>${escapeHtml(shorten(round.organizer, 6))}</span></div>
    </a>
  `;
}

function pendingTransactions(): TransactionRecord[] {
  return transactionStore.list().filter((record) => !record.terminal);
}

function transactionTimeline(record: TransactionRecord): string {
  const labels: Record<string, string> = {
    SUBMITTED: "Submitted to GenLayer",
    QUEUED: "Queued for validators",
    DECISION_AVAILABLE: "Decision available",
    WAITING_FOR_FINALITY: "Waiting for finality",
    RESOLVED: "Execution verified · state read back",
    FAILED: "Action failed",
    TRACKING_INTERRUPTED: "Tracking interrupted · recoverable",
  };
  return `<div class="tx-timeline"><span class="tx-phase-dot"></span><div><strong>${escapeHtml(labels[record.phase] ?? record.phase)}</strong><small>${escapeHtml(record.method)} · ${escapeHtml(shorten(record.txId, 10))}</small></div></div>`;
}

function activityStrip(): string {
  const records = transactionStore.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (records.length === 0) return "";
  return `
    <section class="activity-strip panel">
      <div class="section-heading"><div><p class="eyebrow">Your activity</p><h2>Transaction trail</h2></div><a class="text-link" data-link href="/app/activity">View all →</a></div>
      ${records.slice(0, 3).map(transactionTimeline).join("")}
    </section>
  `;
}

async function dashboardPage(): Promise<string> {
  if (!client.isConfigured) return pageHeader("Workspace", "A clear place to decide", "Connect the deployed MeritRound contract to begin.") + configState();
  let rounds: RoundView[];
  try {
    const ids = await client.getRoundIds();
    rounds = await Promise.all(ids.map((id) => client.getRound(id)));
  } catch (error) {
    return pageHeader("Workspace", "Unable to read the round registry", "The app could not read the configured contract.") + `<div class="error-state panel">${escapeHtml(error instanceof Error ? error.message : "Network read failed")}</div>`;
  }
  const counts = STATES.reduce<Record<string, number>>((result, state) => {
    result[state] = rounds.filter((round) => round.state === state).length;
    return result;
  }, {});
  const mine = wallet.address ? rounds.filter((round) => round.organizer.toLowerCase() === wallet.address?.toLowerCase()) : [];
  return `
    ${pageHeader("Workspace", "Selection, without the fog", "A live view of committed MeritRound state on ${networkLabel()}.", `<a class="button button-primary" data-link href="/app/rounds/new">New round <span>+</span></a>`)}
    <section class="metric-grid">
      <div class="metric-card metric-card-main"><span>Total rounds</span><strong>${rounds.length}</strong><small>Read from contract</small></div>
      <div class="metric-card"><span>Open</span><strong>${counts.OPEN ?? 0}</strong><small>Accepting submissions</small></div>
      <div class="metric-card"><span>In review</span><strong>${(counts.LOCKED ?? 0) + (counts.EVALUATING ?? 0)}</strong><small>Locked or evaluating</small></div>
      <div class="metric-card"><span>Decided</span><strong>${(counts.FINALIZED ?? 0) + (counts.INCONCLUSIVE ?? 0)}</strong><small>Terminal results</small></div>
    </section>
    <section class="dashboard-columns">
      <div><div class="section-heading"><div><p class="eyebrow">Registry</p><h2>Recent rounds</h2></div><a class="text-link" data-link href="/app/rounds">All rounds →</a></div>${rounds.length ? `<div class="round-grid">${rounds.slice(-4).reverse().map(roundCard).join("")}</div>` : emptyState("Nothing committed yet", "Create the first round and give the judging universe a clear boundary.", `<a class="button button-primary" data-link href="/app/rounds/new">Create first round</a>`)}</div>
      <aside class="aside-stack"><div class="principle-card principle-card-dark"><p class="eyebrow">Your rounds</p><strong>${mine.length}</strong><p>${wallet.address ? "Rounds organized by the connected wallet." : "Connect a wallet to see your organizer activity."}</p><a data-link href="/app/rounds" class="text-link">Browse registry →</a></div>${activityStrip()}</aside>
    </section>
  `;
}

async function roundsPage(): Promise<string> {
  if (!client.isConfigured) return pageHeader("Registry", "Rounds", "Every card below comes from contract readback.") + configState();
  const filter = new URLSearchParams(window.location.search).get("state") || "ALL";
  try {
    const rounds = await Promise.all((await client.getRoundIds()).map((id) => client.getRound(id)));
    const visible = filter === "ALL" ? rounds : rounds.filter((round) => round.state === filter);
    return `
      ${pageHeader("Registry", "Rounds", "Inspect the state of every round without relying on an off-chain index.", `<a class="button button-primary" data-link href="/app/rounds/new">New round <span>+</span></a>`)}
      <div class="filter-bar panel"><span class="filter-label">Filter by state</span><div class="filter-pills"><a data-link class="filter-pill ${filter === "ALL" ? "filter-pill-active" : ""}" href="/app/rounds">All <span>${rounds.length}</span></a>${STATES.map((state) => `<a data-link class="filter-pill ${filter === state ? "filter-pill-active" : ""}" href="/app/rounds?state=${state}">${stateLabel(state)} <span>${rounds.filter((round) => round.state === state).length}</span></a>`).join("")}</div></div>
      ${visible.length ? `<div class="round-grid round-grid-wide">${visible.map(roundCard).join("")}</div>` : emptyState(filter === "ALL" ? "No rounds yet" : `No ${stateLabel(filter).toLowerCase()} rounds`, "Try another state or create the next round.", `<a class="button button-primary" data-link href="/app/rounds/new">Create a round</a>`)}
    `;
  } catch (error) {
    return pageHeader("Registry", "Rounds", "The contract registry could not be read.") + `<div class="error-state panel">${escapeHtml(error instanceof Error ? error.message : "Network read failed")}</div>`;
  }
}

function newRoundPage(): string {
  return `
    ${pageHeader("New round", "Define the decision", "Write the rubric once. The contract will hold the authoritative round state.", `<a class="text-link" data-link href="/app/rounds">Back to rounds</a>`)}
    <form class="form-layout panel" data-form="create-round">
      <div class="form-main"><label>Round title<input required name="title" maxlength="160" placeholder="e.g. Spring design challenge" /></label><label>Description<textarea required name="description" maxlength="4000" rows="4" placeholder="What is this round selecting, and who is it for?"></textarea></label><label>Committed rubric<textarea required name="rubric" maxlength="12000" rows="10" placeholder="Describe the criteria, weighting, and what a strong submission demonstrates."></textarea><small>This text is committed before finalists are locked. It cannot be changed afterward.</small></label><button class="button button-primary" type="submit">Create round <span>→</span></button></div>
      <aside class="technical-aside"><p class="eyebrow">Before you submit</p><h3>One clear universe</h3><p>MeritRound derives a deterministic round ID from the organizer and these fields. The frontend never chooses a winner.</p><details><summary>Technical details</summary><p>Contract method: <code>create_round(title, description, rubric)</code><br />Development chain: ${config.chainId}<br />Contract: ${escapeHtml(config.contractAddress ?? "not configured")}</p></details></aside>
    </form>
  `;
}

function detailActions(round: RoundView): string {
  const organizer = Boolean(wallet.address && wallet.address.toLowerCase() === round.organizer.toLowerCase());
  const canSubmit = round.state === "OPEN";
  const actions: string[] = [];
  if (round.state === "DRAFT" && organizer) actions.push(`<button class="button button-primary" data-action="contract-write" data-method="open_round" data-round-id="${round.round_id}">Open round <span>→</span></button>`);
  if (canSubmit) actions.push(`<a class="button button-primary" data-link href="/app/rounds/${round.round_id}/submit">Add submission <span>+</span></a>`);
  if (round.state === "OPEN" && organizer && round.submission_ids.length >= 2) actions.push(`<button class="button button-secondary" data-action="contract-write" data-method="lock_round" data-round-id="${round.round_id}">Lock finalists</button>`);
  if (round.state === "LOCKED" && organizer) actions.push(`<button class="button button-primary" data-action="contract-write" data-method="resolve_round" data-round-id="${round.round_id}">Evaluate round <span>→</span></button>`);
  return actions.length ? `<div class="detail-actions">${actions.join("")}</div>` : "";
}

function submissionRow(submission: SubmissionView, finalist: boolean): string {
  return `<article class="submission-row"><div class="submission-index">${finalist ? "F" : "S"}</div><div class="submission-copy"><strong>${escapeHtml(submission.title)}</strong><span>${escapeHtml(shorten(submission.submitter, 8))} · ${escapeHtml(shorten(submission.submission_id, 8))}</span></div><div class="submission-evidence"><span class="evidence-badge">SHA committed</span><a href="${escapeHtml(submission.evidence_url)}" target="_blank" rel="noreferrer">View evidence ↗</a></div></article>`;
}

async function detailPage(roundId: string): Promise<string> {
  if (!client.isConfigured) return pageHeader("Round", "Not configured", "The round detail page needs a configured contract.") + configState();
  try {
    const round = await client.getRound(roundId);
    const submissions = await Promise.all(round.submission_ids.map((id) => client.getSubmission(id)));
    const result: ResultView = round.state === "FINALIZED" || round.state === "INCONCLUSIVE" ? await client.getResult(roundId) : { exists: false };
    return `
      <div class="detail-top"><a class="back-link" data-link href="/app/rounds">← All rounds</a>${statePill(round.state)}</div>
      <section class="detail-hero"><div><p class="eyebrow">Round ${escapeHtml(shorten(round.round_id, 10))}</p><h1>${escapeHtml(round.title)}</h1><p class="detail-description">${escapeHtml(round.description)}</p></div>${detailActions(round)}</section>
      <section class="detail-grid"><div class="detail-main"><div class="panel rubric-panel"><div class="section-heading"><div><p class="eyebrow">Committed rubric</p><h2>The judging boundary</h2></div><span class="lock-mark">⌁</span></div><p class="rubric-text">${escapeHtml(round.rubric)}</p><div class="digest-line"><span>Evaluation universe digest</span><code>${escapeHtml(shorten(round.evaluation_universe_digest || "Pending lock", 18))}</code></div></div><div class="panel"><div class="section-heading"><div><p class="eyebrow">Finalist set</p><h2>${submissions.length} submissions</h2></div>${round.state === "OPEN" ? `<span class="muted">Open for additions</span>` : `<span class="muted">Frozen at lock</span>`}</div>${submissions.length ? `<div class="submission-list">${submissions.map((submission) => submissionRow(submission, round.finalist_ids.includes(submission.submission_id))).join("")}</div>` : emptyState("No submissions yet", "Share the submission link once the round is open.")}</div></div><aside class="detail-aside"><div class="panel fact-panel"><p class="eyebrow">Round facts</p><dl><div><dt>Organizer</dt><dd>${escapeHtml(shorten(round.organizer, 8))}</dd></div><div><dt>State</dt><dd>${stateLabel(round.state)}</dd></div><div><dt>Finalists</dt><dd>${round.finalist_ids.length || "Not locked"}</dd></div></dl></div>${result.exists ? `<div class="panel result-panel ${result.outcome === "WINNER" ? "result-winner" : "result-inconclusive"}"><p class="eyebrow">Final result</p><strong>${escapeHtml(result.outcome === "WINNER" ? "Winner confirmed" : "Inconclusive")}</strong><p>${result.outcome === "WINNER" ? `Submission ${escapeHtml(shorten(result.submission_id ?? "", 8))} is the canonical result.` : "No winner was selected. The contract recorded an explicit inconclusive outcome."}</p></div>` : `<div class="panel process-panel"><p class="eyebrow">Decision path</p><div class="process-step process-step-done">Rubric committed</div><div class="process-step ${round.finalist_ids.length ? "process-step-done" : ""}">Finalists locked</div><div class="process-step ${(round.state === "EVALUATING" || round.state === "FINALIZED" || round.state === "INCONCLUSIVE") ? "process-step-done" : ""}">Validators evaluate</div><div class="process-step">Result read back</div></div>`}</aside></section>
      ${activityStrip()}
    `;
  } catch (error) {
    return pageHeader("Round", "Round unavailable", "The requested round could not be read from the configured contract.") + `<div class="error-state panel">${escapeHtml(error instanceof Error ? error.message : "Network read failed")}</div>`;
  }
}

async function submitPage(roundId: string): Promise<string> {
  if (!client.isConfigured) return pageHeader("Submission", "Not configured", "The submission page needs a configured contract.") + configState();
  try {
    const round = await client.getRound(roundId);
    if (round.state !== "OPEN") return pageHeader("Submission", "Submissions are closed", "This round is no longer accepting additions.") + `<div class="panel empty-state"><h2>${escapeHtml(round.title)}</h2><p>The contract is currently ${escapeHtml(stateLabel(round.state).toLowerCase())}.</p><a class="button button-secondary" data-link href="/app/rounds/${roundId}">Back to round</a></div>`;
    return `
      ${pageHeader("Submit to round", round.title, "Commit an exact HTTPS evidence document. The contract and validators will verify it again.", `<a class="text-link" data-link href="/app/rounds/${roundId}">Back to round</a>`)}
      <form class="form-layout panel" data-form="submit-submission" data-round-id="${roundId}"><div class="form-main"><label>Submission title<input required name="title" maxlength="160" placeholder="Name your work" /></label><label>Evidence URL<input required type="url" name="evidenceUrl" maxlength="512" pattern="https://.*" placeholder="https://…" /><small>HTTPS only. Use an immutable or content-addressed document where possible.</small></label><div class="hash-field"><label>Expected SHA-256<input required name="expectedSha256" minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" placeholder="64 lowercase hexadecimal characters" /></label><button class="button button-quiet" type="button" data-action="hash-evidence">Calculate from URL</button></div><div class="assistance-note"><span>i</span><p>Local calculation is convenience only. The contract re-fetches the URL and compares exact bytes before evaluation.</p></div><button class="button button-primary" type="submit">Register submission <span>→</span></button></div><aside class="technical-aside"><p class="eyebrow">Technical details</p><h3>Evidence stays evidence</h3><p>MeritRound does not store a frontend summary as authoritative input. Only the URL and exact SHA-256 commitment enter the locked evaluation universe.</p><code>register_submission(round_id, title, evidence_url, expected_sha256)</code></aside></form>
    `;
  } catch (error) {
    return pageHeader("Submission", "Round unavailable", "The round could not be read.") + `<div class="error-state panel">${escapeHtml(error instanceof Error ? error.message : "Network read failed")}</div>`;
  }
}

function activityPage(): string {
  const records = transactionStore.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `
    ${pageHeader("Activity", "Your transaction trail", "MeritRound persists every returned transaction ID and reconciles the same ID after refresh.")}
    ${records.length ? `<section class="activity-list">${records.map((record) => `<article class="activity-card panel"><div class="activity-card-heading"><div><p class="eyebrow">${escapeHtml(record.method)}</p><h2>${escapeHtml(record.roundId ? `Round ${shorten(record.roundId, 8)}` : "Deployment or registry action")}</h2></div><span class="phase-badge phase-${record.phase.toLowerCase()}">${escapeHtml(record.phase.replaceAll("_", " "))}</span></div><div class="activity-meta"><div><span>Transaction ID</span><code>${escapeHtml(record.txId)}</code></div><div><span>Submitted</span><strong>${escapeHtml(formatDate(record.submittedAt))}</strong></div><div><span>Latest status</span><strong>${escapeHtml(record.latestStatus ?? "Not read yet")}</strong></div><div><span>Execution</span><strong>${escapeHtml(record.latestExecution ?? "Not read yet")}</strong></div></div>${record.error ? `<p class="activity-error">${escapeHtml(record.error)}</p>` : ""}<details><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre></details></article>`).join("")}</section>` : emptyState("No browser activity yet", "When you submit a state-changing action, its transaction ID and lifecycle will appear here.")}
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
  root.innerHTML = shell(loadingState(), route().path.startsWith("/app") ? "app" : "");
  try {
    const page = await pageForCurrentRoute();
    if (version !== renderVersion) return;
    root.innerHTML = shell(page.content, page.active);
  } catch (error) {
    if (version !== renderVersion) return;
    root.innerHTML = shell(`<div class="error-state panel"><h2>Something interrupted this read</h2><p>${escapeHtml(error instanceof Error ? error.message : "Unknown application error")}</p></div>`);
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

async function handleContractWrite(button: HTMLButtonElement): Promise<void> {
  try {
    assertWalletAndConfig();
    const roundId = button.dataset.roundId;
    const method = button.dataset.method;
    if (!roundId || !method || !wallet.address) throw new Error("Incomplete action context.");
    const round = await client.getRound(roundId);
    let args: unknown[] = [roundId];
    let expectedState: TransactionRecord["expectedState"];
    if (method === "open_round") {
      if (round.state !== "DRAFT" || round.organizer.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("The contract does not allow this round to open for this wallet.");
      expectedState = { kind: "round-state", roundId, state: "OPEN" };
    } else if (method === "lock_round") {
      if (round.state !== "OPEN" || round.organizer.toLowerCase() !== wallet.address.toLowerCase() || round.submission_ids.length < 2) throw new Error("A round needs at least two submissions and the organizer must lock it.");
      expectedState = { kind: "round-state", roundId, state: "LOCKED" };
    } else if (method === "resolve_round") {
      if (round.state !== "LOCKED" || round.organizer.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Only the organizer can evaluate a locked round.");
      expectedState = { kind: "round-terminal", roundId, states: ["FINALIZED", "INCONCLUSIVE"] };
    } else {
      throw new Error("Unsupported contract action.");
    }
    const operationId = await makeOperationId(config, wallet.address, method, args);
    const record = await client.sendWriteOnce({ operationId, method, args, expectedState, roundId });
    setNotice(`Recorded ${shorten(record.txId, 10)}. MeritRound will track this same transaction.`, "success");
    void startTracking(record);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The action could not be submitted.", "error");
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
    setNotice(`Submission recorded as ${shorten(record.txId, 10)}.`, "success");
    void startTracking(record);
    navigate(`/app/rounds/${roundId}`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Submission failed.", "error");
  }
}

async function calculateEvidenceHash(): Promise<void> {
  const urlInput = document.querySelector<HTMLInputElement>("input[name=evidenceUrl]");
  const hashInput = document.querySelector<HTMLInputElement>("input[name=expectedSha256]");
  if (!urlInput || !hashInput || !urlInput.value) return setNotice("Enter an HTTPS evidence URL first.", "error");
  if (!urlInput.value.startsWith("https://")) return setNotice("Only HTTPS evidence URLs are accepted.", "error");
  try {
    setNotice("Fetching exact bytes locally for a convenience hash…", "info");
    const response = await fetch(urlInput.value, { credentials: "omit" });
    if (!response.ok) throw new Error(`Evidence fetch returned HTTP ${response.status}.`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    hashInput.value = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    setNotice("Hash calculated locally. The contract will verify the bytes again.", "success");
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "The browser could not fetch those bytes.", "error");
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (link) {
    event.preventDefault();
    navigate(link.getAttribute("href") ?? "/");
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]");
  if (!action) return;
  const name = action.dataset.action;
  if (name === "connect-wallet") {
    void client.connectWallet().then((next) => { wallet = next; setNotice("Wallet connected.", "success"); }).catch((error) => {
      if (error instanceof WalletError && error.code === "WRONG_NETWORK") {
        wallet = { status: "wrong-network", address: client.walletAddress, chainId: undefined };
      }
      setNotice(error instanceof Error ? error.message : "Wallet connection failed.", "error");
    });
  } else if (name === "contract-write" && action instanceof HTMLButtonElement) {
    void handleContractWrite(action);
  } else if (name === "hash-evidence") {
    void calculateEvidenceHash();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (form.dataset.form === "create-round") void handleCreateRound(form);
  if (form.dataset.form === "submit-submission") void handleSubmitSubmission(form);
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
