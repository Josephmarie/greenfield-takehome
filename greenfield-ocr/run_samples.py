"""Run the pipeline on all three example faxes and save artifacts to sample_outputs/.

Requires ANTHROPIC_API_KEY in the environment (the only thing the live run needs;
poppler + all Python deps are already handled by requirements.txt).

    export ANTHROPIC_API_KEY=sk-ant-...
    python run_samples.py

Writes, for each example:
  sample_outputs/<name>.json          full PipelineResult (classification,
                                      extracted fields, review queue, decision)
And, for the referral specifically:
  sample_outputs/deny_back_letter.txt the generated deny-back letter

Then prints a short PASS/FAIL summary of the three behaviors the take-home
cares about, so the Loom narration has something concrete to point at.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from greenfield_ocr.pipeline import process

EXAMPLES = [
    "examples/Fax-Referral.pdf",
    "examples/Fax-InsuranceCard.pdf",
    "examples/Fax-LabResult.pdf",
]
OUT = Path("sample_outputs")


def main() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set. Export it and re-run.", file=sys.stderr)
        return 2

    OUT.mkdir(exist_ok=True)
    results = {}
    for path in EXAMPLES:
        name = Path(path).stem
        print(f"Processing {path} ...")
        result = process(path)
        (OUT / f"{name}.json").write_text(result.to_json())
        results[name] = result
        if result.deny_back_letter:
            (OUT / "deny_back_letter.txt").write_text(result.deny_back_letter)

    print("\n=== Behavior checks ===")
    ref = results.get("Fax-Referral")
    if ref is not None:
        letter = ref.deny_back_letter or ""
        ok = (not ref.pushed_downstream
              and "Group number" in letter
              and "Referring provider NPI" in letter)
        print(f"[{'PASS' if ok else 'FAIL'}] Referral deny-back names Group number + "
              f"Referring provider NPI, and is held (not scheduled)")

    card = results.get("Fax-InsuranceCard")
    if card is not None and card.extracted:
        fields = ["member_name", "member_id", "group_number",
                  "payer_id", "copay_specialist", "effective_date"]
        present = sum(1 for f in fields
                      if (card.extracted.get(f) or {}).get("value"))
        print(f"[{'PASS' if present == 6 else 'PARTIAL'}] Insurance card extracted "
              f"{present}/6 fields")

    lab = results.get("Fax-LabResult")
    if lab is not None and lab.extracted:
        neut = next((t for t in lab.extracted.get("test_values", [])
                     if t.get("name", "").lower().startswith("neutro")), None)
        ok = bool(neut) and neut.get("in_range") is False
        print(f"[{'PASS' if ok else 'FAIL'}] Lab flags Neutrophils out of range "
              f"(computed {neut.get('computed_flag') if neut else 'n/a'})")

    print(f"\nArtifacts written to {OUT.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
