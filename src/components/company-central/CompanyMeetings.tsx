import NewMeetingForm from "@/components/meetings/NewMeetingForm";
import MeetingList from "@/components/meetings/MeetingList";
import type { DirectoryUser, MeetingRow } from "@/lib/meetings";

// Aba "Reuniões" da central da empresa: criar (empresa já travada nesta empresa)
// + listar as reuniões desta empresa. A visibilidade e o acesso são os mesmos da
// /agenda (RLS); aqui a lista já vem filtrada por company_id.
export default function CompanyMeetings({
  companyId,
  companyName,
  rows,
  directory,
}: {
  companyId: string;
  companyName: string;
  rows: MeetingRow[];
  directory: DirectoryUser[];
}) {
  return (
    <div>
      <NewMeetingForm
        directory={directory}
        lockedCompany={{ id: companyId, name: companyName }}
      />
      <MeetingList
        rows={rows}
        showCompany={false}
        emptyLabel="Nenhuma reunião para esta empresa ainda."
      />
    </div>
  );
}
