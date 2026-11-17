// Como o app "lê" o histórico de uma empresa.
// Essa regra decide o brilho do pin no mapa e a frase de contexto que aparece na gaveta.
// É aqui que o app evita o "tem processo = empresa ruim".

/**
 * @param {Array<{categoria:string, ativo:boolean, polo:'ré'|'autora', distribuicao:Date}>} processos
 * @returns {{ nivel: 0|1|2|3, frase: string }}
 *   nivel 0 = sem processos, 1 = discreto, 2 = vale olhar, 3 = chama atenção
 */
export function lerHistorico(processos) {
  if (processos.length === 0) {
    return { nivel: 0, frase: "Nenhum processo encontrado para este CNPJ." };
  }

  // TODO(você): troque esta regra provisória pela sua.
  // Hoje ela só conta processos, o que é injusto: um supermercado com 8 processos de
  // consumidor em 6 anos pode ser normal, e uma loja pequena com 3 trabalhistas ativos não.
  // Ideias para pesar: só processos em que a empresa é "ré", só os "ativo",
  // os dos últimos 2 anos (distribuicao), e repetição do mesmo tipo (categoria).
  const n = processos.length;
  const nivel = n <= 2 ? 1 : n <= 8 ? 2 : 3;
  const frase = `${n} processo${n > 1 ? "s" : ""} no histórico.`;
  return { nivel, frase };
}
