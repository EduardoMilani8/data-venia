#!/usr/bin/env bash
# Passo 2 dos dados reais: filtra a base aberta de CNPJs da Receita para uma cidade.
# Lê cada .zip em fluxo (nada grande fica no disco) e guarda só as linhas da cidade.
#
# Uso: scripts/receita.sh <lançamento> <código do município na Receita> <saída>
#   ex.: scripts/receita.sh 2026-11 8785 dados-reais/receita-passo-fundo
#
# Sai:
#   estabelecimentos.csv  ativos da cidade, sem telefone nem e-mail
#   empresas.csv          razão social, natureza jurídica e porte desses CNPJs
#   simples.csv           se é MEI
# O arquivo de sócios (nomes de pessoas) não é baixado.

set -euo pipefail
LANC="${1:?lançamento, ex. 2026-11}"
MUN="${2:?código do município, ex. 8785}"
OUT="${3:?pasta de saída}"
TOKEN="gn672Ad4CF8N6TK"   # compartilhamento público da Receita (não é segredo)
BASE="https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/$LANC"
mkdir -p "$OUT"

baixar() { curl -sS --fail --retry 3 --retry-delay 5 -u "$TOKEN:" "$BASE/$1" | funzip | iconv -f ISO-8859-1 -t UTF-8; }
export -f baixar; export BASE TOKEN MUN

# Campos separados por ";" e entre aspas. Estabelecimentos: 6 = situação ("02" ativa), 21 = município.
# Guarda: cnpj básico, ordem, dv, matriz/filial, nome fantasia, situação, início, CNAE,
#         tipo de logradouro, logradouro, número, complemento, bairro, CEP, UF, município.
filtrar_estab() {
  baixar "$1" | awk -F'";"' -v m="$MUN" 'BEGIN{OFS=";"} { gsub(/^"|"\r?$/, ""); if ($21 == m && $6 == "02") print $1,$2,$3,$4,$5,$6,$11,$12,$14,$15,$16,$17,$18,$19,$20,$21 }'
}
export -f filtrar_estab

echo "[$(date +%T)] Estabelecimentos (10 arquivos, 3 por vez)…"
seq 0 9 | xargs -P 3 -I{} bash -c 'filtrar_estab Estabelecimentos{}.zip > "'"$OUT"'/estab.{}.part" && echo "  [$(date +%T)] Estabelecimentos{} ok: $(wc -l < "'"$OUT"'/estab.{}.part") linhas"'
cat "$OUT"/estab.*.part > "$OUT/estabelecimentos.csv" && rm "$OUT"/estab.*.part
cut -d';' -f1 "$OUT/estabelecimentos.csv" | sort -u > "$OUT/basicos.txt"
echo "[$(date +%T)] $(wc -l < "$OUT/estabelecimentos.csv") estabelecimentos ativos, $(wc -l < "$OUT/basicos.txt") empresas"

# Empresas: 1 cnpj básico, 2 razão social, 3 natureza jurídica, 6 porte
filtrar_empresas() {
  baixar "$1" | awk -F'";"' -v lista="$2" 'BEGIN{OFS=";"; while ((getline k < lista) > 0) ok[k]=1} { gsub(/^"|"\r?$/, ""); if ($1 in ok) print $1,$2,$3,$6 }'
}
export -f filtrar_empresas
echo "[$(date +%T)] Empresas (10 arquivos)…"
seq 0 9 | xargs -P 3 -I{} bash -c 'filtrar_empresas Empresas{}.zip "'"$OUT"'/basicos.txt" > "'"$OUT"'/emp.{}.part"'
cat "$OUT"/emp.*.part > "$OUT/empresas.csv" && rm "$OUT"/emp.*.part
echo "[$(date +%T)] $(wc -l < "$OUT/empresas.csv") empresas"

# Simples: 1 cnpj básico, 5 opção pelo MEI ("S"/"N")
echo "[$(date +%T)] Simples…"
baixar Simples.zip | awk -F'";"' -v lista="$OUT/basicos.txt" 'BEGIN{OFS=";"; while ((getline k < lista) > 0) ok[k]=1} { gsub(/^"|"\r?$/, ""); if ($1 in ok) print $1,$5 }' > "$OUT/simples.csv"
echo "[$(date +%T)] $(grep -c ';S$' "$OUT/simples.csv" || true) MEIs entre $(wc -l < "$OUT/simples.csv") no Simples"
echo "[$(date +%T)] pronto"
