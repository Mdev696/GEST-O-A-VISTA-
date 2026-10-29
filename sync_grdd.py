#!/usr/bin/env python3
"""
Sincroniza o export do Power BI com o portal GRDD.

Fluxo: Power BI (Playwright baixa o .xlsx) -> limpa no formato do portal
       -> grava 1 linha em bases_importadas (Supabase).
O portal já carrega a última base guardada ao abrir (repoUltima).

Uso:
  python sync_grdd.py --login                 # 1ª vez: abre o navegador para você entrar (MFA)
  python sync_grdd.py                         # baixa, converte e envia
  python sync_grdd.py --arquivo data.xlsx     # pula o download, usa um .xlsx local
  python sync_grdd.py --arquivo data.xlsx --dry-run   # só mostra o que enviaria

Variáveis de ambiente:
  SUPABASE_URL, SUPABASE_KEY   (a mesma chave anon que o portal usa)
  PBI_REPORT_URL               URL do relatório no Power BI Service
  PBI_PERFIL                   pasta do perfil do navegador (padrão ./pbi_profile)
  PBI_VISUAL_INDEX             nº do visual (0 = primeiro) de onde exportar (padrão 0)
  RETER_DIAS                   apaga bases automáticas mais antigas que N dias (padrão 0 = não apaga)
"""
import argparse
import json
import logging
import os
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://fgcrdoyquvzihgnmvspf.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
REPORT_URL = os.environ.get("PBI_REPORT_URL", "")
PERFIL = os.environ.get("PBI_PERFIL", "./pbi_profile")
VISUAL_INDEX = int(os.environ.get("PBI_VISUAL_INDEX", "0"))
RETER_DIAS = int(os.environ.get("RETER_DIAS", "0"))
ARQUIVO = "data.xlsx"
TZ = "America/Sao_Paulo"  # horário em que o Power BI grava DataCriacao (RJ/ES)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("sync_grdd.log", encoding="utf-8")],
)
log = logging.getLogger("sync_grdd")


class SessaoExpirada(Exception):
    pass


# ---------------------------------------------------------------- download
def baixar(login=False):
    from playwright.sync_api import sync_playwright

    if not REPORT_URL:
        raise RuntimeError("Defina PBI_REPORT_URL")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PERFIL, headless=False, accept_downloads=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(REPORT_URL)

        if login:
            input("Entre na sua conta no navegador, espere o relatório abrir e aperte Enter aqui... ")
            ctx.close()
            return

        page.wait_for_load_state("networkidle", timeout=120_000)
        if "login.microsoftonline.com" in page.url or "login.live.com" in page.url:
            ctx.close()
            raise SessaoExpirada("A sessão expirou: rode com --login")

        # >>> ÚNICA parte que pode precisar de ajuste: os cliques do Power BI <<<
        # Descubra os seletores com:  playwright codegen <PBI_REPORT_URL> --user-data-dir ./pbi_profile
        visual = page.locator("visual-container").nth(VISUAL_INDEX)
        visual.wait_for(timeout=60_000)
        visual.hover()
        visual.get_by_role("button", name=re.compile("Mais opções|More options", re.I)).click()
        page.get_by_text(re.compile("Exportar dados|Export data", re.I)).first.click()
        with page.expect_download(timeout=120_000) as d:
            page.get_by_role("button", name=re.compile(r"^(Exportar|Export)$", re.I)).click()
        d.value.save_as(ARQUIVO)
        ctx.close()
    log.info("Download concluído: %s", ARQUIVO)


# ---------------------------------------------------------------- limpeza (espelha o build() do script.js)
def chave(s):
    s = unicodedata.normalize("NFD", str(s).strip().lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s)


CAMPOS = {
    "seq": ["Sequencia", "Sequência", "Ticket", "Nº Ticket", "Numero"],
    "raiz": ["SequenciaRaiz", "Sequência Raiz", "Raiz"],
    "pri": ["Prioridade"],
    "aging": ["Aging"],
    "grupo": ["Grupo Responsável", "Grupo"],
    "loc": ["Localidade"],
    "gestor": ["Gestor Atual", "Gestor"],
    "uf": ["UF"],
    "site": ["Sigla Site", "Site"],
    "criacao": ["DataCriacao", "Data Criação", "Criação"],
    "alarme": ["Alarme"],
    "sloc": ["SiglaLocalidade"],
}


def col(df, nomes):
    """Como o pick() do portal: 1º nome com valor; se vazio, tenta o próximo (linha a linha)."""
    por_chave = {chave(c): c for c in df.columns}
    out = None
    for n in nomes:
        c = por_chave.get(chave(n))
        if c is None:
            continue
        s = df[c].replace("", pd.NA)
        out = s if out is None else out.combine_first(s)
    return out if out is not None else pd.Series([pd.NA] * len(df), index=df.index)


def num(v):
    try:
        if pd.isna(v):
            return 0
        n = int(float(v))
        return n if n > 0 else 0
    except (ValueError, TypeError):
        return 0


def montar(df):
    d = pd.DataFrame({k: col(df, v) for k, v in CAMPOS.items()})
    d["seq"] = d["seq"].map(num)
    d["raiz"] = d["raiz"].map(num)
    d["pri"] = d["pri"].fillna("").astype(str).str.strip().str.upper()
    for c in ["aging", "grupo", "loc", "gestor", "uf", "site", "sloc"]:
        d[c] = d[c].fillna("").astype(str).str.strip()
    d["alarme"] = d["alarme"].fillna("").astype(str).str.slice(0, 2000)  # o portal também corta em 2000

    dt = pd.to_datetime(d["criacao"], errors="coerce")
    if dt.dt.tz is None:
        dt = dt.dt.tz_localize(TZ, ambiguous="NaT", nonexistent="NaT")
    d["criacao"] = dt.dt.tz_convert("UTC").dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    antes = len(d)
    d = d[(d["seq"] > 0) & dt.notna()].drop_duplicates("seq")
    if len(d) < antes:
        log.warning("%d linha(s) ignorada(s) (sem Sequência ou data de criação válida)", antes - len(d))
    return d.to_dict("records")


# ---------------------------------------------------------------- Supabase
def hdr(extra=None):
    h = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    h.update(extra or {})
    return h


def enviar(tickets, nome):
    corpo = {
        "nome_arquivo": nome,
        "importado_por": "automático",
        "importado_em": datetime.now(timezone.utc).isoformat(),
        "total_tickets": len(tickets),
        "tickets": tickets,
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/bases_importadas",
        headers=hdr({"Content-Type": "application/json", "Prefer": "return=minimal"}),
        data=json.dumps(corpo),
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"Supabase HTTP {r.status_code}: {r.text[:300]}")
    log.info("Base enviada: %s (%d tickets)", nome, len(tickets))


def limpar_antigas():
    if RETER_DIAS <= 0:
        return
    limite = (datetime.now(timezone.utc) - timedelta(days=RETER_DIAS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/bases_importadas",
        headers=hdr(),
        params={"importado_por": "eq.automático", "importado_em": f"lt.{limite}"},
        timeout=60,
    )
    log.info("Limpeza de bases automáticas > %d dias: HTTP %s", RETER_DIAS, r.status_code)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true", help="abre o navegador para login manual")
    ap.add_argument("--arquivo", help="usa um .xlsx local em vez de baixar do Power BI")
    ap.add_argument("--dry-run", action="store_true", help="não envia, só mostra o resultado")
    a = ap.parse_args()

    if a.login:
        baixar(login=True)
        return 0

    try:
        arquivo = a.arquivo or ARQUIVO
        if not a.arquivo:
            baixar()
        df = pd.read_excel(arquivo)
        tickets = montar(df)
        if not tickets:
            raise RuntimeError("Export sem tickets válidos: nada enviado")

        nome = "auto_" + datetime.now().strftime("%Y-%m-%d_%H-%M") + ".xlsx"
        if a.dry_run:
            log.info("DRY-RUN: %d tickets | exemplo: %s", len(tickets), json.dumps(tickets[0], ensure_ascii=False)[:600])
            return 0
        if not SUPABASE_KEY:
            raise RuntimeError("Defina SUPABASE_KEY")
        enviar(tickets, nome)
        limpar_antigas()
        return 0
    except SessaoExpirada as e:
        log.error("%s", e)
        return 2
    except Exception as e:  # noqa: BLE001
        log.exception("Falha: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())