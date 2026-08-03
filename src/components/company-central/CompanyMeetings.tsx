import NewMeetingForm from "@/components/meetings/NewMeetingForm";
import MeetingList from "@/components/meetings/MeetingList";
import type {
  DirectoryUser,
  MeetingActionsContext,
  MeetingRow,
} from "@/lib/meetings";

// Aba "Reuniões" da central da empresa: criar (empresa já travada nesta empresa)
// + listar as reuniões desta empresa com as ações por reunião (editar/excluir/
// enviar/remover). A visibilidade e o acesso são os mesmos da /agenda (RLS);
// aqui a lista já vem filtrada por company_id e a empresa fica travada.
export default function CompanyMeetings({
  companyId,
  companyName,
  rows,
  directory,
  currentUserId,
  isAdmin,
  googleConnected,
}: {
  companyId: string;
  companyName: string;
  rows: MeetingRow[];
  directory: DirectoryUser[];
  currentUserId: string;
  isAdmin: boolean;
  googleConnected: boolean;
}) {
  const lockedCompany = { id: companyId, name: companyName };
  const ctx: MeetingActionsContext = {
    currentUserId,
    isAdmin,
    googleConnected,
    directory,
    lockedCompany,
  };
  return (
    <div>
      <NewMeetingForm directory={directory} lockedCompany={lockedCompany} />
      <MeetingList
        rows={rows}
        showCompany={false}
        ctx={ctx}
        emptyLabel="Nenhuma reunião para esta empresa ainda."
      />
    </div>
  );
}
