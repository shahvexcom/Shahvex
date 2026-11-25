#!/usr/bin/env python3
"""Report shadow decisions and optionally enrich them with read-only status polling."""

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

CLASSES = ("HUMAN", "VOICEMAIL", "TV/BACKGROUND", "SILENCE", "UNDETERMINED")
HUMAN = {"XFER", "RAXFER", "SALE", "CALLBK", "CALLBACK", "CBHOLD", "NI", "NOTINT",
         "NOT_INTERESTED", "DNC", "DNCL", "DO_NOT_CALL", "GOAL_ACHIEVED",
         "TASKS_COMPLETED", "HUMAN", "HUMAN_ANSWERED"}
MAILBOX = {"AA", "AM", "A", "VOICEMAIL"}
NATIVE_MAILBOX = {"AA", "AM"}
KNOWN_OTHER = {"NA", "N", "B", "BUSY", "DROP", "DC", "BADNUM"}


def records(path):
    if not path.exists():
        return {}
    rows = {}
    with path.open() as source:
        for line in source:
            if not line.endswith("\n"):
                continue  # The bridge can be in the middle of appending it.
            row = json.loads(line)
            rows.setdefault(row["call_id"], row)
    return rows


def enrich(rows, cache, root):
    pending = [key for key in rows if not cache.get(key, {}).get("final_status")]
    helper = root / "scripts/report-shadow-status.cjs"
    for offset in range(0, len(pending), 100):
        batch = pending[offset:offset + 100]
        result = subprocess.run(["node", str(helper)], input=json.dumps(batch), text=True,
                                capture_output=True, cwd=root, check=False)
        if result.returncode:
            print(result.stderr.strip(), flush=True)
            break
        for key, status in json.loads(result.stdout).items():
            if key in rows:
                cache[key].update(status)
    return cache


def save(path, rows):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        name = output.name
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(name, path)


def report(rows, human):
    table = {}
    actions, flagged, unresolved, mailbox, caught = 0, [], 0, 0, 0
    for row in rows:
        native = (row.get("final_status") or "").strip().upper()
        website = (row.get("website_outcome") or "").strip().upper()
        decision = row.get("class", "UNDETERMINED")
        table.setdefault(native or "PENDING/UNAVAILABLE", Counter())[decision] += 1
        if native in NATIVE_MAILBOX:
            mailbox += 1
            caught += decision == "VOICEMAIL"
        if row.get("would_hangup") is not True:
            continue
        actions += 1
        if native in human or website in human:
            flagged.append(row)
        elif native not in MAILBOX | KNOWN_OTHER:
            unresolved += 1
    print("Final VICIdial status\t" + "\t".join(CLASSES))
    for status, counts in sorted(table.items()):
        print(status + "\t" + "\t".join(str(counts[key]) for key in CLASSES))
    print(f"Voicemail catch rate: {caught}/{mailbox} ({caught / mailbox:.2%})" if mailbox
          else "Voicemail catch rate: unavailable (no final AA/AM statuses)")
    print(f"Would-hangup calls: {actions}; human outcomes: {len(flagged)}; unresolved outcomes: {unresolved}")
    if flagged:
        print("Call ID\tFinal VICIdial status\tWebsite outcome\tDecision\tSignals")
    for row in flagged:
        print(f"{row['call_id']}\t{row.get('final_status') or '-'}\t{row.get('website_outcome') or '-'}\t"
              f"{row.get('class')}\t{','.join(row.get('signals', []))}")
    if actions:
        print(f"Observed human-outcome rate: {len(flagged) / actions:.4%}")
    ceiling = (len(flagged) + unresolved) / actions if actions else 1
    print(f"{'GO' if actions >= 200 and ceiling < 0.005 else 'NO-GO'} "
          f"(upper human-outcome rate {ceiling:.4%}; unresolved outcomes counted against the threshold)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path, help="bridge call-answer-shadow.jsonl")
    parser.add_argument("--poll", action="store_true", help="read dispositions from PostgreSQL and VICIdial")
    parser.add_argument("--watch", type=int, metavar="SECONDS", help="repeat read-only polling at this interval")
    parser.add_argument("--output", type=Path, help="write one enriched row per call to this separate JSONL file")
    parser.add_argument("--human-status", action="append", default=[], help="additional campaign human status code")
    args = parser.parse_args()
    if args.watch is not None and args.watch <= 0:
        parser.error("--watch must be positive")
    if (args.poll or args.watch) and not args.output:
        parser.error("polling requires --output")
    if args.output and args.log.resolve() == args.output.resolve():
        parser.error("use a separate enriched output file")
    if not args.log.is_file() and not args.watch:
        parser.error(f"shadow log not found: {args.log}")
    root = Path(__file__).resolve().parent.parent
    while True:
        rows = records(args.log)
        existing = records(args.output) if args.output else {}
        cache = {key: {**row, **existing.get(key, {})} for key, row in rows.items()}
        if args.poll or args.watch:
            enrich(rows, cache, root)
        if args.output:
            save(args.output, cache.values())
        report(cache.values(), HUMAN | {code.upper() for code in args.human_status})
        if not args.watch:
            break
        print(flush=True)
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
