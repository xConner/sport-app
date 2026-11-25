"""Holt die Speisepläne von Mensa I und Mensa II (Kiel) vom Studentenwerk SH
und schreibt sie als data/mensa.json für die App (aktuelle + nächste Woche)."""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from bs4 import BeautifulSoup

MENSEN = [(1, "Mensa I"), (2, "Mensa II")]
URL = "https://studentenwerk.sh/de/essen-uebersicht?mensa={id}&nw={nw}"
ARTEN = {"vn": "vegan", "ve": "vegetarisch", "S": "Schwein", "R": "Rind", "L": "Lamm", "G": "Geflügel",
         "BIO": "Bio", "SHT": "SH-Teller", "STF": "Streetfood", "A": "ohne Alkohol", "YF": "Favourites"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "sport-app-mensaplan/1.0 (privat, 1x taeglich)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def price(s):
    m = re.search(r"(\d+),(\d{2})", s)
    return float(f"{m.group(1)}.{m.group(2)}") if m else None


def parse(html):
    soup = BeautifulSoup(html, "html.parser")
    days = {}
    for day in soup.select(".tag_headline[data-day]"):
        meals = []
        for m in day.select(".mensa_menu_detail"):
            name_el = m.select_one(".menu_name")
            if not name_el:
                continue
            zusatz = name_el.select_one(".mensa_zusatz")
            if zusatz:
                zusatz.extract()
            # Zeilen (z.B. "mit Sauerkraut") mit " · " verbinden, Kennzeichnungen in Klammern entfernen
            name = re.sub(r"\s*\([^)]*\)", "", name_el.get_text(" ", strip=True))
            name = re.sub(r"\s+", " ", name).strip()
            typ = m.select_one(".menu_art span")
            prices = [price(s.get_text()) for s in m.select(".menu_preis span")]
            co2 = m.select_one(".co2blatt")
            arten = [a for a in (m.get("data-arten") or "").split("|") if a]
            meals.append({
                "name": name,
                "ort": typ.get_text(strip=True) if typ else "",
                "preise": [p for p in prices if p is not None],
                "tags": [ARTEN.get(a, a) for a in arten],
                "allergene": [a for a in (m.get("data-allergene") or "").split("|") if a],
                "co2": int(co2["data-anz"]) if co2 and co2.get("data-anz", "").isdigit() else None,
            })
        if meals:
            days[day["data-day"]] = meals
    return days


def main():
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "mensen": []}
    total = 0
    for mid, name in MENSEN:
        days = {}
        for nw in (0, 1):
            try:
                days.update(parse(fetch(URL.format(id=mid, nw=nw))))
            except Exception as e:  # nächste Woche fehlt oft noch, das ist ok
                print(f"{name} nw={nw}: {e}", file=sys.stderr)
        total += sum(len(v) for v in days.values())
        out["mensen"].append({"id": mid, "name": name, "tage": dict(sorted(days.items()))})
        print(f"{name}: {len(days)} Tage, {sum(len(v) for v in days.values())} Gerichte")
    if total == 0:
        sys.exit("Keine Gerichte gefunden – Seitenaufbau geändert? Alte Datei bleibt bestehen.")
    with open("data/mensa.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
