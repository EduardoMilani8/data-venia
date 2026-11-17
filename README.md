# Data Venia

Um mapa 3D das empresas perto de você e dos processos judiciais em que elas aparecem.
Abra no centro da cidade, toque na loja à sua frente e veja o histórico dela na Justiça: tipo de ação, situação, resumo e linha do tempo.

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

1. **Empresas:** base aberta de CNPJs da Receita Federal, com o endereço de cada estabelecimento geocodificado.
2. **Processos por CNPJ:** um serviço de dados judiciais com API. A chave fica só no servidor (`PROCESSOS_API_TOKEN`), nunca no navegador.
3. **Filtros obrigatórios:** só pessoa jurídica, sem MEI, sem nomes de pessoas físicas, sem processos em segredo de justiça.

Implemente `empresasReais()` em `server.js` devolvendo o mesmo formato de `gerarEmpresas()`.

## Uso responsável

Processo público não é sentença. Ter processos é comum, principalmente para empresas grandes, e muitos terminam arquivados ou em acordo.
O app mostra contexto junto com cada número, oculta nomes de pessoas físicas e é feito para curiosidade, não para expor ninguém.

## Créditos

Mapa base © [OpenStreetMap](https://www.openstreetmap.org/copyright) e [CARTO](https://carto.com/attributions). Renderização com [MapLibre GL JS](https://maplibre.org/).
