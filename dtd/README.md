# BHO DTDs

Vendored, unmodified, from <https://www.british-history.ac.uk/dtd/>. They are the normative
grammar for the XML this project exports: `report.dtd` for articles, `index.dtd` for volume
indexes, plus the ISO public entity sets and BHO's own `bhoa.ent` that both pull in.

They are kept here so that `scripts/xhtml-to-bho.js --validate` works offline, and so that the
version we test against is pinned rather than whatever the site serves today. Refresh them with:

```bash
for f in report.dtd index.dtd bhoa.ent isoamsa.ent isoamsb.ent isoamsc.ent isoamsn.ent \
         isoamso.ent isoamsr.ent isobox.ent isocyr1.ent isocyr2.ent isodia.ent isogrk1.ent \
         isogrk2.ent isogrk3.ent isogrk4.ent isolat1.ent isolat2.ent isonum.ent isopub.ent \
         isotech.ent; do
  curl -sS -o "dtd/$f" "https://www.british-history.ac.uk/dtd/$f"
done
```

Note that a published file's `<!DOCTYPE report SYSTEM "dtd/report.dtd">` resolves against the
BHO site root, not against the directory holding the XML.

See [`docs/bho-report-xml-specification.md`](../docs/bho-report-xml-specification.md).
