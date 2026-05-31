"""Command-line interface.

    python -m greenfield_ocr.cli process examples/Fax-Referral.pdf
    python -m greenfield_ocr.cli process examples/Fax-InsuranceCard.pdf --json-only
"""

from __future__ import annotations

import sys

import typer

from .pipeline import process

app = typer.Typer(add_completion=False, help="Greenfield Cardiology fax intake OCR pipeline")


@app.command()
def run(path: str, json_only: bool = typer.Option(False, "--json-only")):
    """Classify, extract, validate, and (for referrals) deny-back a document."""
    result = process(path)

    if json_only:
        typer.echo(result.to_json())
        raise typer.Exit(0)

    c = result.classification
    typer.echo(f"\n=== {result.source} ===")
    typer.echo(f"Type: {c.get('doc_type')}  (confidence {c.get('confidence')})")

    if result.halt_reason and result.extracted is None:
        typer.echo(f"HALTED: {result.halt_reason}")
        raise typer.Exit(0)

    typer.echo("\n--- Extracted ---")
    typer.echo(result.to_json())

    if result.review_queue:
        typer.echo(f"\n--- Human review queue ({len(result.review_queue)}) ---")
        for item in result.review_queue:
            typer.echo(f"  [{item['status']}] {item['field']}: {item.get('reason')}")
    else:
        typer.echo("\n--- Human review queue: empty ---")

    if result.deny_back_letter:
        typer.echo("\n--- DENY-BACK LETTER (referral held, not scheduled) ---")
        typer.echo(result.deny_back_letter)

    typer.echo(f"\nPushed downstream: {result.pushed_downstream}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] not in {"run", "--help"}:
        sys.argv.insert(1, "run")
    app()
