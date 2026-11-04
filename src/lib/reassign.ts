// Sentinela de "Manter com a pessoa" (não reatribuir) usada entre a UI de
// colaboradores da empresa e a server action setCompanyCollaborators (decisão 4).
// Fica numa lib neutra porque arquivos "use server" só exportam funções async.
export const KEEP_WITH_PERSON = "__keep__";
