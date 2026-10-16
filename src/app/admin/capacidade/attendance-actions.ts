"use server";

import { guardRole } from "@/components/guardRole";
import type { ClientRow, ClientPersonRow } from "@/components/capacity/AttendanceCapacity";

// Drill-down da seção "Atendimento por WhatsApp" (Capacidade, admin-only): clientes
// de uma pessoa no período. A RPC recusa não-admin por dentro; guardRole é a 1ª
// barreira. Só leitura.
export async function loadPersonClients(
  start: string,
  end: string,
  profileId: string
): Promise<ClientRow[]> {
  const { supabase } = await guardRole(["admin"]);
  const { data } = await supabase.rpc("attendance_capacity_person_clients", {
    p_start: start,
    p_end: end,
    p_profile_id: profileId,
  });
  return (data as ClientRow[]) ?? [];
}

// Drill-down de um cliente: pessoas que o atenderam, com as horas de cada.
export async function loadClientPeople(
  start: string,
  end: string,
  companyId: string
): Promise<ClientPersonRow[]> {
  const { supabase } = await guardRole(["admin"]);
  const { data } = await supabase.rpc("attendance_capacity_client_people", {
    p_start: start,
    p_end: end,
    p_company_id: companyId,
  });
  return (data as ClientPersonRow[]) ?? [];
}
