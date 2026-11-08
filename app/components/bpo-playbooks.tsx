"use client";
import { useEffect, useState } from "react";
import { FiCheckCircle, FiChevronDown, FiList, FiUpload, FiRefreshCw } from "react-icons/fi";
type Assignment={id:string;script_file_name:string;script_text:string;lead_file_name:string;lead_rows:string[][]};
function extractTasks(text:string){const lines=text.split(/\r?\n|(?<=[?.!])\s+(?=[A-Z])/).map(x=>x.replace(/^[-•\d.)\s]+/,"").trim()).filter(x=>x.length>4);const start=lines.findIndex(x=>/following details|following information|collect|confirm|take the following/i.test(x));const source=start>=0?lines.slice(start+1):lines;const blocked=/^(if |you will have to|you must |please |when |the agent|call |hello |hi |thank |do not |never )/i;return [...new Set(source.filter(x=>x.length<180&&!blocked.test(x)&&/[a-z]/i.test(x)))].slice(0,20)}
export default function BpoPlaybooks() {
  const [items, setItems] = useState<Assignment[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try { const response = await fetch("/api/bpo/scripts"); if (!response.ok) throw new Error("Unable to load playbooks."); const data = await response.json(); setItems(data.assignments || []); }
    catch { setError("Could not load your playbooks. Please try again."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const openUpload = () => {
    document.querySelector('.bpo-script-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector<HTMLButtonElement>('.bpo-script-title .bpo-upload-btn')?.focus({ preventScroll: true });
  };
  return <section className="bpo-playbooks" aria-labelledby="playbooks-title">
    <div className="bpo-playbooks-heading"><div className="bpo-playbooks-heading-icon"><FiList /></div><div><h2 id="playbooks-title">Customer task playbooks</h2><p>Turn your agent scripts into clear steps for every customer conversation.</p></div><span className="bpo-playbook-count">{items.length} playbook{items.length === 1 ? '' : 's'}</span></div>
    {loading ? <div className="playbook-empty" role="status"><FiRefreshCw /><p>Loading your playbooks...</p></div> : error ? <div className="playbook-empty" role="alert"><h3>Let?s try that again</h3><p>{error}</p><button type="button" className="admin-outline" onClick={() => void load()}><FiRefreshCw /> Try again</button></div> : items.length ? items.map(item => {
      const tasks = extractTasks(item.script_text), open = expanded === item.id;
      return <article className="bpo-playbook" key={item.id}><button type="button" aria-expanded={open} aria-controls={'tasks-' + item.id} onClick={() => setExpanded(open ? null : item.id)}><span><FiList /><strong>{item.script_file_name}</strong><small>{tasks.length} agent tasks &middot; {item.lead_file_name}</small></span><FiChevronDown className={open ? 'is-expanded' : ''} /></button>{open && <div id={'tasks-' + item.id} className="bpo-task-list">{tasks.length ? tasks.map((task, index) => <div className="playbook-task-row" key={task}><span className="playbook-task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task}</strong><small>Collect or confirm with the customer</small></div><span className="playbook-task-label"><FiCheckCircle /> Task {index + 1}</span></div>) : <p className="bpo-empty">No task lines found. Add clear collection or confirmation steps to your script.</p>}</div>}</article>;
    }) : <div className="playbook-empty"><div className="playbook-empty-icon"><FiList /></div><h3>Give every call a clear next step</h3><p>Upload an agent script to build a playbook. Your team?s customer tasks will appear here in an easy-to-follow list.</p><button type="button" className="admin-outline" onClick={openUpload}><FiUpload /> Go to script upload</button><small>Tasks are generated from your script?s instructions.</small></div>}
  </section>;
}
