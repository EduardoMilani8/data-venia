# Data Venia

Um mapa 3D das empresas perto de você e dos processos judiciais em que elas aparecem.
Abra no centro da cidade, toque na loja à sua frente e veja o histórico dela na Justiça: tipo de ação, situação, resumo e linha do tempo.

**Abrir a demo:** https://eduardomilani8.github.io/data-venia/

> *Data venia* é a expressão que advogados usam para discordar "com a devida licença". Aqui, também é um trocadilho com dados.

**Estado atual:** protótipo com **dados de demonstração**. As empresas, CNPJs e processos são fictícios e gerados ao redor de onde você estiver. Nenhum dado se refere a empresas reais.

## Recursos

- Mapa 3D com prédios, pins coloridos pelo tipo de processo (consumidor, trabalhista, tributário, cível) e tamanho pela quantidade
- Tema claro de dia e escuro à noite, pelo nascer e pôr do sol de onde você está, com opção de fixar um tema
- Painel da empresa com processos expansíveis, resumo, valor e últimas movimentações
- Filtros por tipo, busca por nome ou CNPJ, mapa de calor do bairro
- Funciona no celular (o painel vira uma folha que sobe de baixo) e respeita "reduzir movimento"

## Rodar

Precisa de Node 18 ou mais novo. Não há dependências para instalar.

```bash
node server.js
```

Abra http://localhost:5173. O navegador pede a sua localização; se você negar, o mapa abre no centro de São Paulo.
Para ver outro lugar: `http://localhost:5173/?lat=-31.7654&lng=-52.3376`.

O mapa precisa de WebGL (aceleração gráfica ligada no navegador).

## Estrutura

| Arquivo | O que faz |
|---|---|
| `js/main.js` | Mapa, camadas, animações, filtros, busca |
| `js/tema.js` | Tema claro/escuro pelo horário do sol |
| `js/gaveta.js` | Painel com a empresa e a lista de processos |
| `js/classificacao.js` | Regra que dá o "nível" de cada empresa (o brilho do pin e a frase de contexto) |
| `js/dados/demo.js` | Gera empresas e processos fictícios ao redor de qualquer ponto |
| `js/dados/provedor.js` | Escolhe entre demonstração e API (`?modo=api`) |
| `server.js` | Serve o site e expõe `/api/empresas` para dados reais |

## Caminho para dados reais

Os scripts em `scripts/` montam os dados de uma cidade. Tudo fica em `dados-reais/`, que não vai para o git.

**Atalho para uma cidade nova (modo ao vivo):** `scripts/nova-cidade.sh "Carazinho" RS` roda os passos 1–4 e 6 em sequência, acha sozinho o código do município na Receita e pula o que já foi feito. Não baixa processos: eles vêm do DJEN no navegador, com `?modo=vivo`.

| Passo | Comando | O que faz |
|---|---|---|
| 1 | `node scripts/osm.mjs "Passo Fundo"` | Lojas e serviços com nome, do OpenStreetMap |
| 2 | `node scripts/ruas.mjs "Passo Fundo"` | Traçado das ruas, para saber em que rua fica cada loja |
| 3 | `scripts/receita.sh 2026-11 8785 dados-reais/receita-passo-fundo` | Filtra a base aberta de CNPJs da Receita para a cidade (~7 GB lidos em fluxo) |
| 4 | `node scripts/casar.mjs dados-reais/osm-passo-fundo.json dados-reais/receita-passo-fundo` | Liga cada loja ao CNPJ e gera uma planilha de revisão manual |
| 5 | `node scripts/djen.mjs dados-reais/casamento-passo-fundo.json --max 1000` | Busca os processos de graça no [DJEN](https://comunica.pje.jus.br) do CNJ (TJRS, TRT4 e TRF4, só a comarca da cidade), com cache por empresa |
| 5′ | `node --env-file=.env scripts/processos.mjs …` | Alternativa paga ([BuscaProcessos](https://buscaprocessos.app.br)), com valor da causa e histórico completo |
| 6 | `node scripts/cidade.mjs dados-reais/casamento-passo-fundo.json` | Junta tudo no formato do app |

Depois, `npm start` e abra `http://localhost:5173/?modo=api`.

**Modo ao vivo (`?modo=vivo`):** só os lugares vêm prontos. Os processos de cada loja são buscados no DJEN pelo próprio navegador quando alguém toca nela (`js/dados/aovivo.js`), com as mesmas regras de privacidade do lote (`js/dados/djen.js`). É o caminho para funcionar no país todo sem baixar processos de ninguém. O resultado fica guardado no navegador por um dia.

**Sobre o DJEN:** a busca é pelo nome (razão social), conferido em cada publicação. Só aparecem processos com publicação no diário, ou seja, o histórico recente. Não há valor da causa nem assunto detalhado. Se isso não bastar, o plano B é a API do [Escavador](https://api.escavador.com/v2/docs/), que aceita cadastro com CPF e busca por CNPJ. Ela devolve o mesmo formato do BuscaProcessos, então só a função `consultar()` de `scripts/processos.mjs` muda.

**Filtros aplicados:** só pessoa jurídica, sem MEI nem empresário individual, sem quadro societário, sem nomes ou CPFs de pessoas físicas. A chave da API fica só em variável de ambiente.

## Uso responsável

Processo público não é sentença. Ter processos é comum, principalmente para empresas grandes, e muitos terminam arquivados ou em acordo.
O app mostra contexto junto com cada número, oculta nomes de pessoas físicas e é feito para curiosidade, não para expor ninguém.

## Créditos

Mapa base © [OpenStreetMap](https://www.openstreetmap.org/copyright) e [CARTO](https://carto.com/attributions). Renderização com [MapLibre GL JS](https://maplibre.org/).

## Licença

[MIT](LICENSE)
