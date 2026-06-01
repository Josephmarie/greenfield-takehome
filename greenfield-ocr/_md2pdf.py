"""Pandoc-free Markdown -> PDF using reportlab (pure Python, no system deps).

Handles the subset of Markdown used in reflection.md: #/##/### headings,
- bullet lists, blank-line-separated paragraphs, and **bold** / `code` inline.

    python _md2pdf.py <input.md> <output.pdf>
"""
import re
import sys

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer


def inline(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', text)
    return text


def build(src: str, dst: str) -> None:
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontName="Helvetica",
                          fontSize=10.5, leading=15, alignment=TA_LEFT, spaceAfter=6)
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=19, leading=23, spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13.5, leading=17,
                        textColor="#1a3c5e", spaceBefore=12, spaceAfter=4)
    h3 = ParagraphStyle("h3", parent=ss["Heading3"], fontSize=11.5, leading=15,
                        spaceBefore=8, spaceAfter=3)

    flow = []
    bullets = []

    def flush_bullets():
        if bullets:
            flow.append(ListFlowable(
                [ListItem(Paragraph(b, body), leftIndent=12) for b in bullets],
                bulletType="bullet", start="•", leftIndent=14))
            flow.append(Spacer(1, 4))
            bullets.clear()

    for raw in open(src, encoding="utf-8").read().splitlines():
        line = raw.rstrip()
        if line.startswith("### "):
            flush_bullets(); flow.append(Paragraph(inline(line[4:]), h3))
        elif line.startswith("## "):
            flush_bullets(); flow.append(Paragraph(inline(line[3:]), h2))
        elif line.startswith("# "):
            flush_bullets(); flow.append(Paragraph(inline(line[2:]), h1))
        elif re.match(r"^[-*] ", line):
            bullets.append(inline(line[2:]))
        elif not line.strip():
            flush_bullets()
        else:
            flush_bullets(); flow.append(Paragraph(inline(line), body))
    flush_bullets()

    SimpleDocTemplate(dst, pagesize=letter, topMargin=0.85 * inch,
                      bottomMargin=0.85 * inch, leftMargin=0.9 * inch,
                      rightMargin=0.9 * inch, title="Reflection").build(flow)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
    print(f"OK wrote {sys.argv[2]}")
