import { SessionDetailView } from "./session-detail-view";

export default function SessionDetailPage({ params }: { params: { id: string } }) {
  return <SessionDetailView sessionId={params.id} />;
}
