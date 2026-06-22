"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";

type UpdateTaskInstanceInput = {
  title: string;
  description: string;
  instructions: string;
  dueAt: string | null; // ISO (UTC) ou null
  collaboratorId: string;
};

function normalize(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Edita os dados de uma task_instance (NÃO altera o status — esse continua a
// cargo do fluxo do timer). A RLS (ti_update_collaborator) garante que o
// consultor só consegue editar instâncias das empresas atribuídas a ele;
// como o company_id não muda, trocar o colaborador continua autorizado.
export async function updateTaskInstance(
  taskId: string,
  companyId: string,
  input: UpdateTaskInstanceInput
): Promise<{ error: string | null }> {
  const title = input.title.trim();
  if (!title) {
    return { error: "Informe o título da tarefa." };
  }
  if (!input.collaboratorId) {
    return { error: "Selecione o colaborador." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase
    .from("task_instances")
    .update({
      title,
      description: normalize(input.description),
      instructions: normalize(input.instructions),
      due_at: input.dueAt,
      collaborator_id: input.collaboratorId,
    })
    .eq("id", taskId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/consultor/${companyId}`);
  revalidatePath(`/consultor/${companyId}/${taskId}`);
  return { error: null };
}
