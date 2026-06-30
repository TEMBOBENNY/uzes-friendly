import { db } from "./firebase.js";
import {
  collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Render the full reports tab ───────────────────────────────────────────────
export async function renderReports(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = "<p class='muted'>Loading…</p>";

  let payments = [], otherIncomes = [], allExpenses = [];
  try {
    const [paySnap, incSnap, expSnap] = await Promise.all([
      getDocs(query(collection(db, "payments"),    orderBy("submittedAt",  "desc"), limit(100))),
      getDocs(query(collection(db, "otherIncome"), orderBy("addedAt",      "desc"), limit(100))),
      getDocs(query(collection(db, "expenses"),    orderBy("requestedAt",  "desc"), limit(100)))
    ]);
    payments     = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    otherIncomes = incSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    allExpenses  = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    el.innerHTML = `<p class='error'>Failed to load: ${e.message}</p>`; return;
  }

  const confirmed  = payments.filter(p => p.status === "confirmed");
  const pending    = payments.filter(p => p.status === "pending");
  const rejected   = payments.filter(p => p.status === "rejected");
  const payTotal   = confirmed.reduce((s, p) => s + (p.amount || 0), 0);
  const incTotal   = otherIncomes.reduce((s, r) => s + (r.amount || 0), 0);
  const grandTotal = payTotal + incTotal;

  const approvedExp = allExpenses.filter(e => e.status === "approved");
  const expTotal    = approvedExp.reduce((s, e) => s + (e.amount || 0), 0);
  const netBalance  = grandTotal - expTotal;

  // Payment breakdowns (confirmed only)
  const byCategory = {}, byMethod = {};
  confirmed.forEach(p => {
    byCategory[p.category] = (byCategory[p.category] || 0) + (p.amount || 0);
    byMethod[p.method]     = (byMethod[p.method]     || 0) + (p.amount || 0);
  });

  // Other income breakdown by category
  const byIncCat = {};
  otherIncomes.forEach(r => {
    byIncCat[r.category] = (byIncCat[r.category] || 0) + (r.amount || 0);
  });

  const netColor = netBalance >= 0 ? "var(--ok)" : "var(--danger)";

  el.innerHTML = `
    <!-- Summary KPI cards — 4-col desktop, 2-col mobile -->
    <div class="rpt-kpi-grid">
      <div class="stat-card green">
        <div class="stat-val">K ${grandTotal.toFixed(2)}</div>
        <div class="stat-label">Grand total income</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-val">K ${payTotal.toFixed(2)}</div>
        <div class="stat-label">Student payments</div>
      </div>
      <div class="stat-card" style="background:#0d7377">
        <div class="stat-val">K ${incTotal.toFixed(2)}</div>
        <div class="stat-label">Other income</div>
      </div>
      <div class="stat-card" style="background:${netBalance >= 0 ? '#1e8a4c' : '#c0392b'}">
        <div class="stat-val">K ${Math.abs(netBalance).toFixed(2)}</div>
        <div class="stat-label">Net balance ${netBalance < 0 ? "(deficit)" : ""}</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-val">K ${expTotal.toFixed(2)}</div>
        <div class="stat-label">Approved expenses</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-val">${confirmed.length}</div>
        <div class="stat-label">Confirmed payments</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-val">${pending.length}</div>
        <div class="stat-label">Pending payments</div>
      </div>
      <div class="stat-card red">
        <div class="stat-val">${rejected.length}</div>
        <div class="stat-label">Rejected payments</div>
      </div>
    </div>

    <!-- Breakdowns -->
    <div class="breakdown-grid">
      <div class="card" style="margin-top:0">
        <p class="section-head">Payments by category</p>
        ${Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
          <div class="breakdown-row">
            <span>${cat}</span>
            <span class="breakdown-amt">K ${amt.toFixed(2)}</span>
          </div>`).join("") || "<p class='muted'>No data</p>"}
      </div>
      <div class="card" style="margin-top:0">
        <p class="section-head">Payments by method</p>
        ${Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).map(([m,amt])=>`
          <div class="breakdown-row">
            <span>${m}</span>
            <span class="breakdown-amt">K ${amt.toFixed(2)}</span>
          </div>`).join("") || "<p class='muted'>No data</p>"}
      </div>
    </div>

    ${otherIncomes.length ? `
    <div class="breakdown-grid">
      <div class="card" style="margin-top:0">
        <p class="section-head">Other income by category</p>
        ${Object.entries(byIncCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
          <div class="breakdown-row">
            <span>${cat}</span>
            <span class="breakdown-amt">K ${amt.toFixed(2)}</span>
          </div>`).join("")}
      </div>
      <div class="card" style="margin-top:0">
        <p class="section-head">Other income records</p>
        ${otherIncomes.map(r =>`
          <div class="breakdown-row">
            <span>${r.source || "—"} <span class="muted small">(${r.date || ""})</span></span>
            <span class="breakdown-amt">K ${(r.amount||0).toFixed(2)}</span>
          </div>`).join("")}
      </div>
    </div>` : ""}

    ${approvedExp.length ? `
    <div class="card" style="margin-top:0">
      <p class="section-head">Approved expenses</p>
      ${approvedExp.map(e=>`
        <div class="breakdown-row">
          <span>${e.purpose || "—"} <span class="muted small">(${e.requestedByName || ""})</span></span>
          <span class="breakdown-amt" style="color:var(--danger)">− K ${(e.amount||0).toFixed(2)}</span>
        </div>`).join("")}
    </div>` : ""}

    <!-- Executive performance -->
    <div class="card" style="margin-top:14px">
      <div class="rpt-header-row" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <p class="section-head" style="margin:0">Executive performance</p>
        <div class="period-btns">
          <button class="period-btn active" data-period="week">This week</button>
          <button class="period-btn" data-period="day">Today</button>
          <button class="period-btn" data-period="month">This month</button>
          <button class="period-btn" data-period="all">All time</button>
        </div>
      </div>
      <div id="execPerfTable"></div>
    </div>

    <!-- Export + filters -->
    <div class="card" style="margin-top:14px">
      <div class="rpt-header-row" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <p class="section-head" style="margin:0">Payment records</p>
        <div class="rpt-filters">
          <select id="rptStatus" class="filter-sel">
            <option value="all">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
          <input type="date" id="rptFrom" class="filter-sel" title="From date">
          <input type="date" id="rptTo"   class="filter-sel" title="To date">
          <button id="exportBtn" class="btn-primary" style="width:auto;padding:8px 18px">
            ⬇ Export CSV
          </button>
        </div>
      </div>
      <div id="rptTable"></div>
    </div>
  `;

  // ── Executive performance table ───────────────────────────────────────────
  const reviewed = payments.filter(p => p.status === "confirmed" || p.status === "rejected");

  function startOf(unit) {
    const d = new Date();
    if (unit === "day")   d.setHours(0,0,0,0);
    else if (unit === "week")  { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); }
    else if (unit === "month") { d.setDate(1); d.setHours(0,0,0,0); }
    return d;
  }

  function renderExecTable(period) {
    const cutoff   = period !== "all" ? startOf(period) : null;
    const inPeriod = cutoff
      ? reviewed.filter(p => p.reviewedAt && p.reviewedAt.toDate() >= cutoff)
      : reviewed;

    const byExec = {};
    inPeriod.forEach(p => {
      const key = p.reviewedBy || p.reviewerName || "unknown";
      if (!byExec[key]) byExec[key] = { name: p.reviewerName || "—", position: p.reviewerPosition || "—", confirmed: 0, total: 0, rejected: 0 };
      if (p.status === "confirmed") { byExec[key].confirmed++; byExec[key].total += (p.amount || 0); }
      else byExec[key].rejected++;
    });

    const rows = Object.values(byExec).sort((a,b) => b.confirmed - a.confirmed);
    const tbl  = document.getElementById("execPerfTable");
    if (!rows.length) { tbl.innerHTML = "<p class='muted'>No activity in this period.</p>"; return; }
    tbl.innerHTML = `<div style="overflow-x:auto">
      <table class="rpt-table"><thead><tr>
        <th>Name</th><th>Position</th><th>Confirmed</th><th>Total Collected</th><th>Rejected</th>
      </tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td><strong>${r.name}</strong></td>
          <td class="muted">${r.position}</td>
          <td><span style="color:var(--ok);font-weight:700">${r.confirmed}</span></td>
          <td><strong>K ${r.total.toFixed(2)}</strong></td>
          <td><span style="color:var(--danger);font-weight:700">${r.rejected}</span></td>
        </tr>`).join("")}
      </tbody></table></div>`;
  }

  renderExecTable("week");
  document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderExecTable(btn.dataset.period);
    });
  });

  // ── Payment records table ─────────────────────────────────────────────────
  let filtered = [...payments];

  function applyFilters() {
    const status = document.getElementById("rptStatus").value;
    const from   = document.getElementById("rptFrom").value;
    const to     = document.getElementById("rptTo").value;
    filtered = payments.filter(p => {
      if (status !== "all" && p.status !== status) return false;
      if (p.submittedAt) {
        const d = p.submittedAt.toDate();
        if (from && d < new Date(from)) return false;
        if (to   && d > new Date(to + "T23:59:59")) return false;
      }
      return true;
    });
    renderTable(filtered);
  }

  function renderTable(rows) {
    const tbody = rows.map(p => {
      const date = p.submittedAt?.toDate().toLocaleDateString("en-ZM",
        { day:"2-digit", month:"short", year:"numeric" }) || "—";
      const sc = { confirmed:"#1e8a4c", pending:"#e67e22", rejected:"#c0392b" }[p.status] || "#555";
      return `<tr>
        <td>${date}</td>
        <td><strong>${p.receiptNo ? String(p.receiptNo).padStart(4,"0") : "—"}</strong></td>
        <td>${p.studentName || "—"}</td>
        <td>${p.compNumber || "—"}</td>
        <td>${p.category || "—"}</td>
        <td><strong>K ${(p.amount||0).toFixed(2)}</strong></td>
        <td>${p.method || "—"}</td>
        <td>${p.txRef || "—"}</td>
        <td><span class="status-pill" style="background:${sc}">${p.status.toUpperCase()}</span></td>
        <td class="muted small">${p.reviewerName || "—"}</td>
      </tr>`;
    }).join("");
    document.getElementById("rptTable").innerHTML = `
      <div style="overflow-x:auto">
        <table class="rpt-table">
          <thead><tr>
            <th>Date</th><th>Receipt#</th><th>Student</th><th>Comp#</th>
            <th>Category</th><th>Amount</th><th>Method</th><th>Ref</th>
            <th>Status</th><th>Confirmed by</th>
          </tr></thead>
          <tbody>${tbody || "<tr><td colspan='10' class='muted' style='text-align:center;padding:20px'>No records match</td></tr>"}</tbody>
        </table>
      </div>`;
  }

  ["rptStatus","rptFrom","rptTo"].forEach(id =>
    document.getElementById(id).addEventListener("change", applyFilters));
  document.getElementById("exportBtn").addEventListener("click", () => exportCSV(filtered));
  renderTable(payments);
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(rows) {
  const headers = ["Date","Receipt#","Student Name","Comp#","Category",
    "Amount (K)","Method","Ref/Line","Status","Confirmed By","Confirmed At","Rejection Reason"];
  const lines = [headers.join(",")];
  rows.forEach(p => {
    const date   = p.submittedAt?.toDate().toLocaleDateString("en-ZM") || "";
    const confAt = p.reviewedAt?.toDate().toLocaleDateString("en-ZM") || "";
    lines.push([
      date, p.receiptNo ? String(p.receiptNo).padStart(4,"0") : "",
      csv(p.studentName), csv(p.compNumber), csv(p.category),
      (p.amount||0).toFixed(2), csv(p.method), csv(p.txRef),
      p.status, csv(p.reviewerName), confAt, csv(p.rejectionReason)
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `UZES_Payments_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click(); URL.revokeObjectURL(a.href);
}
function csv(v) { return v ? '"' + String(v).replace(/"/g,'""') + '"' : ""; }
