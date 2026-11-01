# Huninn subset provenance

The web app self-hosts two WOFF2 subsets of Huninn in `apps/web/src/assets/`. They are a Modified Version under the [SIL Open Font License 1.1](OFL.txt): subsetting + WOFF2 only. The font declares no Reserved Font Name.

## Source

- Repository: [google/fonts](https://github.com/google/fonts/tree/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/huninn), commit `0b58fb370093f9a9f4ff785d94405710b79de67c`, directory `ofl/huninn`. Its `METADATA.pb` names the family "Huninn" by justfont, the OFL, one font at weight 400 with PostScript name `Huninn-Regular`, the copyright "Copyright 2025 The Huninn Project Authors (https://github.com/justfont/Huninn)" and the source repository `https://github.com/justfont/Huninn` at `2f278099d0a6fdf77593c30bd6e4a44859800ee2`. Huninn has only weight 400 and no variation axes.
- Inputs, downloaded from `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/huninn/<file>` and verified by size, Git blob ID and SHA-256:

| File | Bytes | Git blob | SHA-256 |
| --- | ---: | --- | --- |
| `Huninn-Regular.ttf` | 4683972 | `431166640573180f0d67b9bcdb99c2c840332d0d` | `1bd770a5ffc0c06723b567686f8b5db5abf9ab54227f3bbc4e6fd648f4698805` |
| `OFL.txt` | 4382 | `a66147d6f439fc6562b0860a6c24fb0ab2410149` | `d71824aeb09afc4c2cac01acab5c3db79796e927ba37be40d69fb62a412639b6` |
| `METADATA.pb` | 659 | `0b2909c6dd2ee3752b96fa083cc4892335bcd8f0` | `8c79bd14cb554fb1b39d9e39fad6b01f952ae00f7b9534db04a6bde6810dd033` |

- Embedded names (English Windows records): copyright (name ID 0) "Copyright 2025 The Huninn Project Authors (https://github.com/justfont/Huninn)"; family (1) "Huninn"; subfamily (2) "Regular"; full name (4) "Huninn Regular"; PostScript name (6) `Huninn-Regular`; license (13) "This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org"; license URL (14) `https://openfontlicense.org`; typographic family (16) "Huninn". With `--name-IDs='*'` and the default English-only, non-legacy name options, each subset keeps every English Windows-platform record (platform 3, encoding 1, language 0x0409) of the source unchanged: IDs 0–6, 8, 9, 11–14, 16, 17 and 19 (19 is a Traditional Chinese sample text). The five Traditional Chinese (language 0x0404) records of IDs 1, 2, 4, 16 and 17, which carry the Chinese family name, are dropped; the source has no Macintosh-platform records. CSS exposes the family as "Huninn".

## License text

[OFL.txt](OFL.txt) is the upstream `ofl/huninn/OFL.txt` unchanged: 4382 bytes, LF line endings, Git blob `a66147d6f439fc6562b0860a6c24fb0ab2410149`, SHA-256 `d71824aeb09afc4c2cac01acab5c3db79796e927ba37be40d69fb62a412639b6`. It starts with the copyright line and declares no Reserved Font Name. The web build links this file from the footer.

## Tool

fontTools `pyftsubset` 4.67.0 with brotli 1.2.1, downloaded with `pip download --only-binary=:all: fonttools==4.67.0 brotli==1.2.1` and installed offline with `pip install --no-index --find-links <wheels>` into a throwaway virtual environment outside the repository: CPython 3.15.0 (Windows x64), pip 26.2.1, `pip freeze --all` = `brotli==1.2.1`, `fonttools==4.67.0`, `pip==26.2.1`. Wheel SHA-256: `fonttools-4.67.0-cp315-cp315-win_amd64.whl` `592d8f72024dea0408739a92599e4f839b960e1e887b25adc76dc87271fdac76`, `brotli-1.2.1-cp315-cp315-win_amd64.whl` `09a2f112a638aca15a88f298571788795fc45d62f2bca7f3870c1152153ef399`. Nothing is added to the workspace package manifests.

## Command

`SRC` holds `Huninn-Regular.ttf` and `OUT` receives the subsets:

```sh
CORE='U+0000-00A6,U+00A8-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0301,U+0304,U+0308,U+0329,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2000-2014,U+2016-2024,U+2028-202F,U+2031-203A,U+203D-2046,U+204A-206F,U+20AC,U+20BD,U+2116,U+2190-2193,U+2197,U+2205,U+2212,U+2215,U+25C7,U+25CF,U+2713,U+2715,U+FEFF,U+FFFD'
EXT='U+0100-0130,U+0132-0151,U+0154-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0460-048F,U+0492-04AF,U+04B2-052F,U+1C80-1C8A,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+20A0-20A6,U+20A8,U+20AA-20AB,U+20AD-20BC,U+20BE-20C0,U+2113,U+2C60-2C7F,U+2DE0-2DFF,U+A640-A69F,U+A720-A7FF,U+FE2E-FE2F'
for part in core ext; do
  if [ "$part" = core ]; then R=$CORE; else R=$EXT; fi
  python -I -m fontTools.subset "$SRC/Huninn-Regular.ttf" --output-file="$OUT/huninn-400-$part.woff2" --flavor=woff2 --unicodes="$R" --layout-features+=tnum,pnum,lnum --layout-features-=vert,vrt2,vkna,vhal,valt,vpal,vkrn --name-IDs='*'
done
```

The `core` range covers Basic Latin, Latin-1, basic Cyrillic U+0400–045F (including all Russian letters) and common punctuation, arrows and currency signs; `ext` covers the remaining Latin Extended and Cyrillic Extended ranges. The CSS `unicode-range` of each face lists the same ranges, so browsers download the `ext` file only for text that needs it. Codepoints outside U+0020–007E in Unicode categories P* or S* whose advance is at least 900 units per 1000 (full-width CJK-style forms) are excluded and render in the system fallback: § U+00A7, U+2015, U+2025–2027 (including the horizontal ellipsis … U+2026, a full-width form with vertically centred dots), U+2030, U+203B–203C, U+2047–2049, ™ U+2122, U+20A7 and U+20A9. Symbols the web app renders are kept in `core` when the source font contains them, even when wide: — U+2014, № U+2116, ← U+2190, ↑ U+2191, → U+2192, ↓ U+2193, ∅ U+2205, ◇ U+25C7 and ● U+25CF, besides « » · × • – already in the ranges above.

Characters that render in the system fallback: ↗ U+2197, ✓ U+2713 and ✕ U+2715, which the `core` range lists but the source font lacks; ▤ U+25A4, ◷ U+25F7 and 🔒 U+1F512, which are outside both ranges and absent from the source font; and the excluded ellipsis U+2026. The source font also lacks some codepoints the ranges list, which render in the fallback when they occur: the soft hyphen U+00AD, U+0329, U+202F, the non-Russian Cyrillic letters U+0400, U+0402–0404, U+0407, U+0409–040F, U+0450, U+0452–0454, U+0457, U+0459–045F, U+0490–0491 and U+04B0–04B1 (for example Ukrainian Є Ї Ґ and Belarusian Ў), and most of Latin Extended-B, IPA and Cyrillic Extended. A unit test checks that every non-ASCII character in the web sources is mapped by the subsets or is one of the listed fallback characters.

The source digits share one advance (613 units), and its `tnum` feature maps alternate digit forms to the same 613-unit digits; `tnum`, `pnum` and `lnum` are kept in the layout features. The vertical-writing features are dropped. The source is unhinted (no `fpgm`, `prep` or `cvt` table; `gasp` only) and default hinting options are kept, so the subsets are unhinted as well; no autohinting is applied. Two runs in fresh directories produced identical bytes.

## Output

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `huninn-400-core.woff2` | 21952 | `76058f9c4333e3a5e0e0757d86b2dcca9cc1644efb2f369ce328f7464411368a` |
| `huninn-400-ext.woff2` | 16104 | `8c1b1d04241b81ce018f443f8e0b73eeb1aab78906a69d5ac23ccd42dd76736d` |
