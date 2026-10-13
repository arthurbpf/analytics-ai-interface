#import "@preview/cmarker:0.1.10"

#set page(paper: "a4", margin: 16mm, numbering: "1", number-align: right)
#set text(font: "DejaVu Sans", size: 10pt, fill: rgb("182b3a"))
#set par(leading: 0.5em, justify: true)
#set heading(numbering: none)
#show heading.where(level: 1): set text(size: 20pt, fill: rgb("146b67"))
#show heading.where(level: 2): set text(size: 13pt, fill: rgb("146b67"))
#set list(spacing: 8pt)
#set enum(spacing: 8pt)

#cmarker.render(read("../decision-log.md"))
