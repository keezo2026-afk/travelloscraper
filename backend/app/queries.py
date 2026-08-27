from .geo import CITIES, DEFAULT_TEMPLATES, KEYWORD_EXPANSIONS, PROVINCES


def generate_queries(
    industries: list[str],
    provinces: list[str],
    cities: list[str],
    templates: list[str] | None = None,
    custom_keywords: list[str] | None = None,
    expand: bool = True,
    custom_location: str | None = None,
) -> list[str]:
    templates = templates or DEFAULT_TEMPLATES
    keywords: list[str] = []
    for ind in industries or []:
        keywords.append(ind)
        if expand:
            keywords.extend(KEYWORD_EXPANSIONS.get(ind, []))
    for k in custom_keywords or []:
        if k and k.strip():
            keywords.append(k.strip())
    # unique preserve order
    seen_k = set()
    uniq_kw = []
    for k in keywords:
        kl = k.lower()
        if kl not in seen_k:
            seen_k.add(kl)
            uniq_kw.append(k)

    locations: list[tuple[str, str | None]] = []  # (label, province)
    if custom_location:
        locations.append((custom_location, None))
    if not provinces and not cities and not custom_location:
        locations.append(("South Africa", None))
        for p in PROVINCES:
            locations.append((p, p))
    else:
        if provinces and not cities:
            for p in provinces:
                locations.append((p, p))
                locations.append(("South Africa", None))
                for c in CITIES.get(p, []):
                    locations.append((c, p))
        for c in cities or []:
            prov = None
            for p, clist in CITIES.items():
                if c in clist:
                    prov = p
                    break
            locations.append((c, prov))
        if provinces and cities:
            for p in provinces:
                locations.append((p, p))

    seen_l = set()
    uniq_loc = []
    for loc, prov in locations:
        key = loc.lower()
        if key not in seen_l:
            seen_l.add(key)
            uniq_loc.append((loc, prov))

    queries = []
    seen_q = set()
    for kw in uniq_kw:
        for loc, _prov in uniq_loc:
            for tmpl in templates:
                q = tmpl.replace("{keyword}", kw).replace("{location}", loc)
                q = " ".join(q.split())
                if q.lower() not in seen_q:
                    seen_q.add(q.lower())
                    queries.append(q)
    return queries
