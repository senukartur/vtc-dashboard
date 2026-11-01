# M PLUS Rounded 1c subset provenance

The web app self-hosts six WOFF2 subsets of M PLUS Rounded 1c in `apps/web/src/assets/`. They are a Modified Version under the [SIL Open Font License 1.1](OFL.txt): glyph subsetting and WOFF2 compression only. The font declares no Reserved Font Name.

## Source

- Repository: [google/fonts](https://github.com/google/fonts/tree/84efd8ad78c3710ad14bd909e3bc407151885628/ofl/mplusrounded1c), commit `84efd8ad78c3710ad14bd909e3bc407151885628`, directory `ofl/mplusrounded1c`. Its `METADATA.pb` names the family, the OFL, the copyright "Copyright 2016 The Rounded M+ Project Authors." and the source repository `https://github.com/coz-m/MPLUS_FONTS` at `eb604901d6f04b6f7f2a84b0378c58df84a9dba6`.
- Inputs, verified by size, Git blob ID and SHA-256:

| File | Bytes | Git blob | SHA-256 |
| --- | ---: | --- | --- |
| `MPLUSRounded1c-Regular.ttf` | 3389792 | `a66978b6a6f55de71105a37f8de702ab3f31d27d` | `b75708b53e45b06d17d470aeeca5b766e3d1b3999f03f13ec4eb863ca846c14c` |
| `MPLUSRounded1c-Medium.ttf` | 3432624 | `1b7ff5d1e5cbb060aee71786d5b7a3a5c3537731` | `adfde1b6bae58719c4e0144612a94232e72fc5ca655c4722165fe88d06521a70` |
| `MPLUSRounded1c-Bold.ttf` | 3542592 | `cedcdd46c387ee243991abd07b7d2007fd683baf` | `c358630584e8e2d8fbd6121d0f4693255ffef6d1e6d4f3441fd6e5a963a11f9e` |

- Embedded names: copyright (name ID 0) "Copyright 2016 The Rounded M+ Project Authors."; license (name ID 13) "This Font Software is licensed under the SIL Open Font License, Version 1.1. ..."; license URL (name ID 14) `http://scripts.sil.org/OFL`. Windows family names (name ID 1) are "Rounded Mplus 1c", "Rounded Mplus 1c Medium" and "Rounded Mplus 1c Bold" (Medium adds typographic family ID 16 "Rounded Mplus 1c"), and PostScript names are `RoundedMplus1c-Regular`, `RoundedMplus1c-Medium` and `RoundedMplus1c-Bold`. With `--name-IDs='*'` and the default English-only, non-legacy name options, each subset keeps every English Windows-platform record (platform 3, encoding 1, language 0x0409) of its source unchanged: IDs 0–6, 11, 13 and 14, plus 16 and 17 in Medium. The six legacy Macintosh-platform records (IDs 1–6: family, style, unique ID, full name, version, PostScript name) are dropped; the sources contain no other records. CSS exposes the family as "M PLUS Rounded 1c".

## License text

google/fonts has no `OFL.txt` in this directory. The license body is the `OFL.txt` entry of the Google Fonts download manifest `https://fonts.google.com/download/list?family=M%20PLUS%20Rounded%201c`, retrieved 2026-10-31. The manifest text (4394 bytes, CRLF) has SHA-256 `07424db4089211e77dd8a0bca14fbf46e8801045d6db9061fbd6ce08e582594e`; with line endings normalized to LF, as this repository stores text, it has 4303 bytes and SHA-256 `76efb90a3bf8d7d91a3498d15fb409ee59ff43b0bf614b4afa0a947b6d7c75d3`. [OFL.txt](OFL.txt) is the METADATA copyright line, one blank line and that LF text unchanged: 4351 bytes, SHA-256 `2f6ab907c3fc803a369cf3a25f906b8e6b528fa176dde716de6aba2e3895c504`. The web build links this file from the footer.

## Tool

fontTools `pyftsubset` 4.67.0 with brotli 1.2.1, installed with `pip install --only-binary=:all: fonttools==4.67.0 brotli==1.2.1` into a throwaway virtual environment outside the repository: CPython 3.15.0 (Windows x64), pip 26.2.1, `pip freeze --all` = `brotli==1.2.1`, `fonttools==4.67.0`, `pip==26.2.1`. Wheel SHA-256: `fonttools-4.67.0-cp315-cp315-win_amd64.whl` `592d8f72024dea0408739a92599e4f839b960e1e887b25adc76dc87271fdac76`, `brotli-1.2.1-cp315-cp315-win_amd64.whl` `09a2f112a638aca15a88f298571788795fc45d62f2bca7f3870c1152153ef399`. Nothing is added to the workspace package manifests.

## Command

`SRC` holds the three input files and `OUT` receives the subsets:

```sh
CORE='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0301,U+0304,U+0308,U+0329,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2000-2014,U+2016-2024,U+2027-202F,U+2032-203A,U+203D-2046,U+204A-2052,U+2054-206F,U+20AC,U+20BD,U+2116,U+2122,U+2190-2193,U+2197,U+2205,U+2212,U+2215,U+25C7,U+2713,U+FEFF,U+FFFD'
EXT='U+0100-0130,U+0132-0151,U+0154-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0460-048F,U+0492-04AF,U+04B2-052F,U+1C80-1C8A,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+20A0-20A7,U+20AA-20AB,U+20AD-20AE,U+20B1-20BC,U+20BE-20C0,U+2113,U+2C60-2C7F,U+2DE0-2DFF,U+A640-A69F,U+A720-A7FF,U+FE2E-FE2F'
for pair in 400:Regular 500:Medium 700:Bold; do
  w=${pair%%:*}; s=${pair#*:}
  for part in core ext; do
    if [ "$part" = core ]; then R=$CORE; else R=$EXT; fi
    pyftsubset "$SRC/MPLUSRounded1c-$s.ttf" --output-file="$OUT/m-plus-rounded-1c-$w-$part.woff2" --flavor=woff2 --unicodes="$R" --layout-features+=tnum,pnum,lnum --layout-features-=vert,vrt2,vkna,vhal,valt,vpal,vkrn --name-IDs='*'
  done
done
```

The `core` range covers Basic Latin, Latin-1, basic Cyrillic U+0400–045F (including all Russian letters) and common punctuation, arrows and currency signs; `ext` covers the remaining Latin Extended and Cyrillic Extended ranges. The CSS `unicode-range` of each face lists the same ranges, so browsers download an `ext` file only for text that needs it. Codepoints outside U+0020–007E in Unicode categories P* or S* whose advance is at least 900 units (full-width CJK-style forms) are excluded and render in the system fallback: U+2015, U+2025–2026, U+2030–2031, U+203B–203C, U+2047–2049, U+2053, U+20A8–20A9 and U+20AF–20B0. Symbols the web app renders are kept in `core` when the source fonts contain them, even when wide: — U+2014, № U+2116, ← U+2190, ↑ U+2191, → U+2192, ↓ U+2193, ↗ U+2197, ∅ U+2205, ◇ U+25C7 and ✓ U+2713, besides « » · × • – already in the ranges above. The horizontal ellipsis … U+2026 is intentionally left to the fallback because its source glyph is a full-width form with vertically centred dots (y 290–430 in Regular), which reads as ⋯ in Latin and Cyrillic text. ▤ U+25A4, ◷ U+25F7 and 🔒 U+1F512 are not in the source fonts and render in the fallback; so do ₽ U+20BD and U+202F, which the `core` range lists but the source fonts lack. A unit test checks that every non-ASCII character in the web sources is mapped by the subsets or is one of these fallback characters. The source fonts have no `tnum`, `pnum` or `lnum` features, so that option is a no-op; their digits already share one advance per weight. Default hinting is kept. Two runs in fresh directories produced identical bytes.

## Output

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `m-plus-rounded-1c-400-core.woff2` | 24380 | `4510d6037a0150be18c04221e6e14ed44999dc54723e0cebee7c759a138f0e81` |
| `m-plus-rounded-1c-400-ext.woff2` | 40292 | `e9c6ab663613e674acf3d9ab85d72dc159b40a60f563f3c1f2d5daef3f1ffba2` |
| `m-plus-rounded-1c-500-core.woff2` | 24392 | `ad84e0bfecf77d8a24d4f7c84a6f794bd4235ce4482cf3d80d5e1e825cb2dbee` |
| `m-plus-rounded-1c-500-ext.woff2` | 40420 | `412d666fec537535211d1f543062e3ba304c943db6f338cb05fbf1986822bb7d` |
| `m-plus-rounded-1c-700-core.woff2` | 24936 | `9dce57fa99879304d70b24c52b94e7468fd8ea14d3d251a9f2059f166f45c623` |
| `m-plus-rounded-1c-700-ext.woff2` | 40720 | `5e1a6bb2feef4e5cc3023bb5becad777e2da1e8ebfff0f56c044cf800dcb909d` |
