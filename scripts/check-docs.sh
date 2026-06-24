#!/usr/bin/env bash
#
# check-docs.sh — Guardia di coerenza della documentazione SchoolForge.
#
# Esegue due controlli e fallisce (exit 1) se uno dei due trova problemi:
#   1) link relativi .md rotti tra i documenti;
#   2) identificatori/riferimenti fuori perimetro v2 reintrodotti.
#
# Uso:  bash scripts/check-docs.sh
# In CI: invocato nello stage di verifica (vedi piano-implementazione §7.6).
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

status=0

echo "==> Controllo link relativi .md"
# Per ogni file markdown, estrae i target ](percorso) che terminano in .md
# (eventuale #anchor rimosso) e verifica che il file esista, risolto
# rispetto alla cartella del documento che lo cita.
while IFS= read -r doc; do
  dir="$(dirname "$doc")"
  # estrai i target dei link markdown
  grep -oE '\]\(([^)]+\.md)(#[^)]*)?\)' "$doc" 2>/dev/null \
    | sed -E 's/^\]\(//; s/(#[^)]*)?\)$//' \
    | while IFS= read -r target; do
        # ignora link assoluti o esterni
        case "$target" in
          http*|/*) continue ;;
        esac
        if [ ! -f "$dir/$target" ]; then
          echo "  LINK ROTTO: $doc -> $target"
          status=1
        fi
      done
  # propaga lo status dalla subshell tramite file sentinella
done < <(find . -name '*.md' -not -path './.git/*')

# La pipe sopra gira in subshell: ricontrollo i link in modo aggregato
broken="$(
  while IFS= read -r doc; do
    dir="$(dirname "$doc")"
    grep -oE '\]\(([^)]+\.md)(#[^)]*)?\)' "$doc" 2>/dev/null \
      | sed -E 's/^\]\(//; s/(#[^)]*)?\)$//' \
      | while IFS= read -r target; do
          case "$target" in http*|/*) continue ;; esac
          [ -f "$dir/$target" ] || echo "$doc -> $target"
        done
  done < <(find . -name '*.md' -not -path './.git/*')
)"
if [ -n "$broken" ]; then
  status=1
fi

echo "==> Controllo identificatori fuori perimetro v2"
# Token che nella v2 non devono comparire in nessun documento: sono API/stati
# del vecchio design o riferimenti a versioni superate. NON si filtrano parole
# di prosa come "rubrica"/"Google Forms", che compaiono legittimamente nelle
# sezioni fuori-scope; si filtrano solo identificatori inequivocabili.
FORBIDDEN='connectGoogleForms|createGoogleForm|importFormResponses|recordDriveArtifact|previewRosterImport|applyRosterImport|publishExam|googleFormsEnabled|rosterImportEnabled|driveFileId|Architettura v1\.0|Architettura v1\.1|status: .pubblicata.'
hits="$(grep -REn "$FORBIDDEN" --include='*.md' . 2>/dev/null | grep -v '/scripts/' || true)"
if [ -n "$hits" ]; then
  echo "  IDENTIFICATORI VIETATI TROVATI:"
  echo "$hits" | sed 's/^/    /'
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "==> OK: documentazione coerente (link e perimetro v2)."
else
  echo "==> FALLITO: correggi i problemi sopra prima di aprire la PR."
fi
exit "$status"
