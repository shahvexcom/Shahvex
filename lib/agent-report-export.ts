import { agentScriptCategory } from "./agent-script-category";
type AgentRow = { name: string; username: string; dialed_calls: number; total_leads: number; status: string; call_limit_minutes: number; daily_call_limit: number; local_voice_name?: string; local_voice_id?: string; agent_script?: string };
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const headings = ["Agent", "Username", "Category", "Dialed calls", "Total leads", "Status", "Call access", "Daily limit", "Voice"];
const values = (a: AgentRow) => [a.name, `@${a.username}`, agentScriptCategory(a.agent_script), a.dialed_calls, a.total_leads, a.status, a.call_limit_minutes ? `${a.call_limit_minutes} min / call` : "Unlimited", a.daily_call_limit, a.local_voice_name || a.local_voice_id || "Unassigned"];
const safeCell = (value: unknown) => /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);

export async function exportAgentReport(format: "csv" | "xls" | "doc" | "pdf", agents: AgentRow[], report?: {title:string;headings:string[];rows:(string|number)[][];summary:string}) {
  const generated = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) + " PKT";
  const rows = report?.rows || agents.map(values), columns=report?.headings || headings, title=report?.title || "Agent report", name = `shahvex-${report?"dashboard":"agents"}-${new Date().toISOString().slice(0, 10)}`;
  const logo = new URL("/img/logo.png.png", window.location.origin).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shahvex | ${escape(title)}</title><style>
    @page{size:A4 landscape;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#503e30;margin:0;font-size:11px}header{border-bottom:3px solid #d87532;padding:0 0 18px;margin-bottom:22px}header img{width:155px;height:auto}header p{color:#97775c;font-size:10px;letter-spacing:2px}h1{font-size:28px;margin:16px 0 8px;letter-spacing:-.7px}.meta{color:#8d7663;font-size:10px}.summary{background:#fbf0e3;border:1px solid #ebd4b9;padding:14px;margin:18px 0 24px;font-size:12px}.summary b{color:#ad5926}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}th{background:#715039;color:#fff;text-align:left;font-size:10px;padding:12px 8px}td{padding:11px 8px;border-bottom:1px solid #eadccb;overflow-wrap:anywhere;font-size:10px;line-height:1.5}tr:nth-child(even) td{background:#fcf6ee}tr{break-inside:avoid}footer{border-top:1px solid #dec6ad;margin-top:24px;padding-top:12px;color:#957a62;font-size:9px}.empty{text-align:center;padding:28px;color:#91755d}
    </style></head><body><header><img src="${escape(logo)}" alt="Shahvex AI"><p>CONTROL CENTER / ${report?"OPERATIONS":"TEAM MANAGEMENT"}</p><h1>${escape(title)}</h1><div class="meta">Generated ${escape(generated)} &nbsp; | &nbsp; ${report?"Complete call history":"Current filtered agents"}</div></header><div class="summary">${report?escape(report.summary):`<b>${agents.length}</b> agents &nbsp;&nbsp; / &nbsp;&nbsp; <b>${agents.filter(a => a.status === "APPROVED").length}</b> approved &nbsp;&nbsp; / &nbsp;&nbsp; <b>${agents.reduce((sum, a) => sum + a.dialed_calls, 0)}</b> dialed calls`}</div><table><thead><tr>${columns.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}" class="empty">No records available.</td></tr>`}</tbody></table><footer>SHAHVEX AI &nbsp; | &nbsp; Agent operations &nbsp; | &nbsp; Internal report</footer></body></html>`;
  if (format === "pdf") {
    const response=await fetch('/api/admin/reports/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html}),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error((await response.json()).message||'Unable to generate PDF');
    const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`${name}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
  }
  let body: string, mime: string;
  if (format === "xls") {
    const row = (cells: unknown[], style: string) => `<Row>${cells.map(v => `<Cell ss:StyleID="${style}"><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${escape(v)}</Data></Cell>`).join("")}</Row>`;
    body = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Brand"><Font ss:Bold="1" ss:Size="20" ss:Color="#AD5926"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#715039" ss:Pattern="Solid"/></Style><Style ss:ID="Body"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style><Style ss:ID="Stripe"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="#FCF0E2" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Shahvex agents"><Table><Column ss:Width="140" ss:Span="7"/>${row(["SHAHVEX AI"], "Brand")}${row([title, generated], "Body")}${row([report?.summary || `${agents.length} agents | Current filtered view`], "Body")}${row(columns, "Header")}${rows.map((r, i) => row(r, i % 2 ? "Stripe" : "Body")).join("")}</Table></Worksheet></Workbook>`;
    mime = "application/vnd.ms-excel";
  } else if (format === "doc") { body = html; mime = "application/msword"; }
  else {
    // CSV has no visual styling; branding stays in metadata rows, values remain formula-safe.
    body = "\uFEFF" + [["SHAHVEX AI", title], ["Generated", generated], ["Summary", report?.summary || `${agents.length} agents`], columns, ...rows].map(row => row.map(v => `"${safeCell(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    mime = "text/csv;charset=utf-8";
  }
  const url = URL.createObjectURL(new Blob([body], { type: mime })), link = document.createElement("a");
  link.href = url; link.download = `${name}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
