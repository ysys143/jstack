# Korean primary-source lens

## New coverage, not inherited content

The upstream breadth sweep covers institutional sources from **UK Companies House,
SEC, and arXiv families**. Searches across all upstream sources returned **grep 0** for the list below. This is a **source-coverage gap**, not a translation
quality issue, so this lens is newly authored.

Research for Korean procurement proposals must consult 나라장터.

## Procurement and public institutions

| Source | Provides | Access |
|---|---|---|
| **나라장터** (g2b.go.kr) | Bid notices, opening results, winning bidders, contract amounts | Web lookup directly by notice ID |
| **조달청** (pps.go.kr) | Procurement systems, standards, authoritative interpretations | Web |
| **온비드** (onbid.co.kr) | Public-asset sales and leases | Web |
| **e-나라도움** | National subsidy projects | Web |
| **알리오** (alio.go.kr) | Public-institution management disclosures: budgets, staffing, projects | Web; some CSV |

**No upstream source supplies 나라장터, 조달청, or 온비드.** A person must retrieve
original notices; do not invent automated lookup paths.

## Companies and finance

| Source | Provides |
|---|---|
| **DART** (dart.fss.or.kr) | Disclosures: business and audit reports; **OpenAPI available** |
| **NICE·KED** | Company credit and financial data (paid) |

## Scholarship and technology

| Source | Provides |
|---|---|
| **RISS** (riss.kr) | Theses and journals |
| **KCI** (kci.go.kr) | Indexed journals; **OpenAPI available** |
| **ScienceON** (scienceon.kisti.re.kr) | National R&D outputs |
| **NTIS** (ntis.go.kr) | National R&D projects and comparable project history |

## Statistics and legislation

| Source | Provides |
|---|---|
| **KOSIS** (kosis.kr) | National statistics; **OpenAPI available** |
| **법제처 국가법령정보** (law.go.kr) | Legislation and administrative rules; **OpenAPI available** |
| **e-나라지표** | Indicator time series |

## Evidence tiers: citation priority

When several sources state the same fact, **cite the higher tier**. Rank reflects
proximity to the original, not popularity.

| Tier | Definition | Examples | Procurement use |
|---|---|---|---|
| **Primary original** | The document issued by its originating body | Notice, business report, statutory provision, original paper | Cite directly |
| **Primary aggregation** | Institutional statistics assembled from raw data | KOSIS table, 알리오 disclosure, NTIS project list | Include table number and reference date |
| **Secondary interpretation** | Institutional or academic summary and analysis | White paper, research report, authoritative interpretation | Use only when traceable to primary evidence |
| **Tertiary reporting** | Media, blogs, vendor materials | News articles, reworked press releases | Use as **leads**, not evidence |

**Do not replace higher-tier evidence with lower-tier material; disclose any
substitution.** A figure seen in a news article is that article's figure, not
necessarily Statistics Korea's. If reviewers open the original and find another
number, confidence in the entire item suffers.

## Access rules

| Access type | Sources | Rule |
|---|---|---|
| **OpenAPI** | DART, KCI, KOSIS, legislation | Obtain a key, query, and preserve the original response |
| **Web lookup** | 나라장터, 조달청, 온비드, 알리오, RISS | A person opens the page; record URL and retrieval time |
| **Paid or contracted** | NICE, KED | Use only with a contract; disclose its absence |

**Do not cite figures without a reference date.** Public statistics are revised
retroactively, so retrieval timing is part of the value. The same table can return
different numbers six months later.

## Usage

1. **Obtain notice or project IDs first.** Avoid aimless keyword searches.
2. **Start with OpenAPIs**: DART, KCI, KOSIS, legislation. Use web lookup for the rest.
3. **Cite original URLs**, not screenshots or summaries.
4. **Disclose blocked access**; do not fill missing evidence with estimates.
