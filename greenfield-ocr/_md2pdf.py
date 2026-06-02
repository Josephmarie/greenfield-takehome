"""Pandoc-free Markdown -> PDF using reportlab (pure Python, no system deps).

Handles the subset of Markdown used in reflection.md: #/##/### headings,
- bullet lists (with soft-wrapped continuation lines), blank-line-separated
paragraphs (soft-wrapped lines are joined into one flowing paragraph), and
**bold** / `code` inline.

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
    para = []        # accumulated words for the current paragraph
    bullets = []     # finished bullet strings awaiting a list flush
    cur = [None]     # current (in-progress) bullet text, or None

    def flush_para():
        if para:
            flow.append(Paragraph(inline(" ".join(para)), body))
            para.clear()

    def flush_bullets():
        if cur[0] is not None:
            bullets.append(cur[0]); cur[0] = None
        if bullets:
            flow.append(ListFlowable(
                [ListItem(Paragraph(inline(b), body), leftIndent=12) for b in bullets],
                bulletType="bullet", start="•", leftIndent=14))
            flow.append(Spacer(1, 4))
            bullets.clear()

    def emit_heading(text, style):
        flush_para(); flush_bullets()
        flow.append(Paragraph(inline(text), style))

    for raw in open(src, encoding="utf-8").read().splitlines():
        line = raw.rstrip()
        s = line.strip()
        if line.startswith("### "):
            emit_heading(line[4:], h3)
        elif line.startswith("## "):
            emit_heading(line[3:], h2)
        elif line.startswith("# "):
            emit_heading(line[2:], h1)
        elif re.match(r"^[-*] ", line):
            # new bullet starts (column-0 marker); finish any prior bullet/para
            flush_para()
            if cur[0] is not None:
                bullets.append(cur[0])
            cur[0] = line[2:].strip()
        elif not s:
            flush_para(); flush_bullets()
        elif cur[0] is not None:
            cur[0] += " " + s          # soft-wrapped continuation of a bullet
        else:
            para.append(s)             # soft-wrapped continuation of a paragraph
    flush_para(); flush_bullets()

    SimpleDocTemplate(dst, pagesize=letter, topMargin=0.85 * inch,
                      bottomMargin=0.85 * inch, leftMargin=0.9 * inch,
                      rightMargin=0.9 * inch, title="Reflection").build(flow)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
    print(f"OK wrote {sys.argv[2]}")
