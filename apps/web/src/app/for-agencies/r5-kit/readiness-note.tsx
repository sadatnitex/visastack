import { publicText } from '../../../components/public-site/public-text';
import { READINESS_NOTE } from '../../../components/public-site/readiness-ring';

export function ReadinessNote({ pageLang = 'en' }: { readonly pageLang?: string }) {
  return (
    <p className="r5-cases-note">
      {publicText('Example names and counts.', pageLang)} {publicText(READINESS_NOTE, pageLang)}
    </p>
  );
}
