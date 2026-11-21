"""PDF text extraction for Jarvis features (used by /api/pdf-text).

pdfplumber keeps the visual reading order of columnar documents — the
Division Standings sheets come out row-perfect, which raw pdf.js text
extraction does not.

Usage: python pdf_text.py <pdf path>   → prints JSON {"pages": N, "text": "..."}
"""

import json
import sys

import pdfplumber

sys.stdout.reconfigure(encoding="utf-8")


def main():
    path = sys.argv[1]
    text = ""
    pages = 0
    with pdfplumber.open(path) as pdf:
        pages = len(pdf.pages)
        for page in pdf.pages:
            text += (page.extract_text() or "") + "\n"
    print(json.dumps({"pages": pages, "text": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()