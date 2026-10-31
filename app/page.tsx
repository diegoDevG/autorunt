import { TRAMITES } from '../src/lib/domain/tramites';
import { SCENARIOS } from '../src/mocks/scenarios';
import Workbench from './Workbench';

export const dynamic = 'force-dynamic';

export default function Home() {
  const tramites = TRAMITES.map((t) => ({
    id: t.id, name: t.name, mvp: t.mvp, needsRunt: t.needsRunt, sections: t.sections as string[], intentFields: t.intentFields as string[],
  }));
  const scenarios = SCENARIOS.map((s) => ({
    id: s.id, description: s.description, plate: s.plate, ownerDocType: s.ownerDocType, ownerDoc: s.ownerDoc,
  }));
  const source = process.env.RUNT_SOURCE === 'croma' && process.env.CROMA_API_KEY ? 'croma' : 'mock';
  return <Workbench tramites={tramites} scenarios={scenarios} source={source} />;
}
