import { createHash } from "node:crypto";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sheetLeads(headers: string[], rows: string[][], phoneCode: string) {
  const key = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");
  const phone = headers.findIndex(h => /^(?:phone|phonenumber|mobile|mobilenumber|telephone|number|contactnumber)$/.test(key(h)));
  const name = headers.findIndex(h => /^(?:name|fullname|customername|clientname|firstname)$/.test(key(h)));
  if (phone < 0) throw Error("The assigned sheet needs a Phone Number column");
  const leads = new Map<string, { number: string; phone: string; name: string }>();
  for (const row of rows) {
    const raw = String(row[phone] ?? "").trim().replace(/[\s().-]/g, "");
    if (!/^\+?\d{6,15}$/.test(raw)) continue;
    const digits = raw.replace(/^\+/, "");
    const local = raw.startsWith("+") ? (digits.startsWith(phoneCode) ? digits.slice(phoneCode.length) : "") : (digits.startsWith(phoneCode) && digits.length>10 ? digits.slice(phoneCode.length) : digits);
    if (!/^\d{6,14}$/.test(local)) continue;
    const number = `+${phoneCode}${local}`;
    if (number.length > 16) continue;
    leads.set(number, { number, phone: local, name: name < 0 ? "" : String(row[name] || "").trim() });
  }
  return [...leads.values()].sort((a, b) => a.number.localeCompare(b.number));
}
export function leadSheetHash(leads: ReturnType<typeof sheetLeads>) { return hash(leads); }
export function scriptHash(script: string) { return hash(script.replace(/\r\n/g, "\n").trim()); }
export function vendorCode(connection: string, list: string, number: string) { return `sv${hash([connection,list,number]).slice(0,18)}`; }
export function addedLeadId(body: string, phone: string, listId: string) {
  const line = body.split(/\r?\n/).find(line => line.startsWith("SUCCESS: add_lead LEAD HAS BEEN ADDED - "));
  const values = line?.split(" - ")[1]?.split("|");
  if (!values || values[0] !== phone || values[1] !== listId || !/^\d+$/.test(values[2])) throw Error("VICIdial did not confirm the imported lead ID");
  return values[2];
}
