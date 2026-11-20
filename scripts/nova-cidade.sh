#!/usr/bin/env bash
# Coloca uma cidade nova no mapa, no modo ao vivo: lojas do OpenStreetMap ligadas ao CNPJ da Receita.
# Os processos NÃO são baixados: o navegador busca no DJEN quando alguém abre o mapa (?modo=vivo).
#
# Uso: scripts/nova-cidade.sh "Carazinho" RS [lançamento da Receita, ex. 2026-11]
#
# Passos (cada um pula se a saída já existe, então dá para rodar de novo depois de uma falha):
#   1. osm.mjs      lojas com nome            → dados-reais/osm-<cidade>.json
#   2. ruas.mjs     traçado das ruas          → dados-reais/ruas-<cidade>.json
#   3. receita.sh   CNPJs ativos da cidade    → dados-reais/receita-<cidade>/   (lê ~7 GB em fluxo, demora)
#   4. casar.mjs    loja ↔ CNPJ               → dados-reais/casamento-<cidade>.json + revisao-<cidade>.csv
#   5. cidade.mjs   formato do app            → dados-reais/cidade-<cidade>.json
set -euo pipefail
cd "$(dirname "$0")/.."

CIDADE="${1:?nome da cidade, ex. \"Carazinho\"}"
UF="${2:?UF, ex. RS}"
LANC="${3:-$(date +%Y-%m)}"
SLUG=$(echo "$CIDADE" | iconv -f utf8 -t ascii//TRANSLIT | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
NOME_RF=$(echo "$CIDADE" | iconv -f utf8 -t ascii//TRANSLIT | tr '[:lower:]' '[:upper:]')
D=dados-reais
mkdir -p "$D"
passo() { echo; echo "[$(date +%T)] $*"; }

# Código do município na Receita (não é o do IBGE). A tabela vem junto da base aberta do CNPJ.
if [ ! -f "$D/Municipios.zip" ]; then
  passo "Baixando a tabela de municípios da Receita"
  curl -sS --fail -u "gn672Ad4CF8N6TK:" -o "$D/Municipios.zip" \
    "https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ/$LANC/Municipios.zip"
fi
CODIGOS=$(unzip -p "$D/Municipios.zip" | iconv -f latin1 -t utf8 | awk -F'";"' -v n="$NOME_RF" '{ gsub(/^"|"\r?$/, ""); if ($2 == n) print $1 }')
if [ -n "${MUN:-}" ]; then CODIGO="$MUN"
elif [ "$(echo "$CODIGOS" | grep -c .)" = 1 ]; then CODIGO="$CODIGOS"
else
  echo "Não deu para escolher o código de \"$NOME_RF\" na tabela da Receita (achados: ${CODIGOS:-nenhum})."
  echo "Nome repetido em outro estado? Rode de novo com MUN=<código> na frente do comando."
  exit 1
fi
echo "$CIDADE/$UF: código $CODIGO na Receita, lançamento $LANC"

[ -s "$D/osm-$SLUG.json" ]  || { passo "1/5 Lojas no OpenStreetMap"; node scripts/osm.mjs "$CIDADE" "$UF"; }
[ -s "$D/ruas-$SLUG.json" ] || { passo "2/5 Ruas no OpenStreetMap"; node scripts/ruas.mjs "$CIDADE" "$UF"; }
[ -s "$D/receita-$SLUG/simples.csv" ] || { passo "3/5 Receita (demora: lê a base do país inteiro)"; scripts/receita.sh "$LANC" "$CODIGO" "$D/receita-$SLUG"; }
passo "4/5 Ligando lojas aos CNPJs"; node scripts/casar.mjs "$D/osm-$SLUG.json" "$D/receita-$SLUG"
passo "5/5 Formato do app";          node scripts/cidade.mjs "$D/casamento-$SLUG.json" --uf "$UF"

echo
echo "Pronto. Rode npm start e abra o mapa em $CIDADE com ?modo=vivo."
echo "Lugares com ligação duvidosa: $D/revisao-$SLUG.csv (marque com x e rode o passo 4 de novo)."
