/**
 * Every word the depth switch and the screens' level sentences use, in one place, so translation
 * can be done later by changing this file. They are not in the shared message catalog on
 * purpose: that catalog requires a Bangla line for each English line, and Bangla work is
 * deferred until the owner says the rest of the product is done.
 */
export const DEPTH_WORDS = {
  'depth.group': 'How much to show',
  'depth.glance': 'Glance',
  'depth.browse': 'Browse',
  'depth.everything': 'Everything',
  'depth.status': 'Showing {level}',
  'depth.home.glance': 'Glance: the one thing that needs you now.',
  'depth.home.browse': 'Browse: what is waiting, your records and your open work.',
  'depth.home.everything': 'Everything: your next journey and the permissions you control.',
  'depth.traveller.glance': 'Glance: the one thing that needs you now and the case you are on.',
  'depth.traveller.browse': 'Browse: your counts, your case, what needs a decision and your dates.',
  'depth.traveller.everything': 'Everything: upcoming dates, recent activity, profile and sharing.',
  'depth.documents.glance': 'Glance: how many documents are ready and how many need a look.',
  'depth.documents.browse':
    'Browse: the full list, search, and the document you picked with its details.',
  'depth.documents.everything': 'Everything: adding new documents.',
  'depth.expiry.glance': 'Glance: the dates that come up next.',
  'depth.expiry.browse':
    "Browse: each document's own expiry, route rules and issuer confirmations.",
  'depth.expiry.everything': 'Everything: nothing more on this screen.',
  'depth.profile.glance':
    'Glance: who this is, how complete the profile is, and that you decide what becomes a fact.',
  'depth.profile.browse': 'Browse: the details, section by section, to read and edit.',
  'depth.profile.everything': 'Everything: profile health and the latest changes.',
  'depth.cases.glance': 'Glance: the case you are on, and a way to start another.',
  'depth.cases.browse': 'Browse: every case, with its progress and stage.',
  'depth.cases.everything':
    'Everything: briefs, case history and, once you have a case, the Start a Case form.',
  'depth.case.glance': 'Glance: the next step, the reminder and your progress.',
  'depth.case.browse':
    'Browse: the stages, the checklist, case details, the requirement pack, tasks, appointments, letters and notes.',
  'depth.case.everything':
    'Everything: choosing evidence, submission and outcome, problems, snapshots and the itinerary.',
  'depth.evidence.glance': 'Glance: what is waiting for you, and the reply for each.',
  'depth.evidence.browse':
    'Browse: dates, checklist notes, references, your questions and requests already answered.',
  'depth.evidence.everything': 'Everything: asking the agency about an item.',
  'depth.sharing.glance': 'Glance: who can see this record now, and how to pause or revoke it.',
  'depth.sharing.glance.withForm':
    'Glance: who can see this record now, how to pause or revoke it, and the form to share.',
  'depth.sharing.browse':
    'Browse: exactly what each person can see, access and invitations waiting to be accepted or ended, and the access log.',
  'depth.sharing.browse.withForm': 'Browse: invitations, the access log and the form to share.',
  'depth.sharing.everything': 'Everything: the form to share with someone new.',
  'depth.sharing.everything.nothingMore': 'Everything: nothing more on this screen.',
  'depth.notifications.glance': 'Glance: what is new.',
  'depth.notifications.browse': 'Browse: what is new and the recent ones you have read.',
  'depth.notifications.everything': 'Everything: the older ones you have read.',
  'depth.privacy.glance': 'Glance: your three rights, each one tap away, and the export downloads.',
  'depth.privacy.browse': 'Browse: what an export holds, and your consent history.',
  'depth.privacy.everything':
    'Everything: large exports, deleting your account and your permissions.',
  'depth.account.glance': 'Glance: who you are signed in as.',
  'depth.account.browse': 'Browse: {parts}.',
  'depth.account.everything': 'Everything: {parts}.',
  'depth.account.nothingMore': 'nothing more on this screen',
  'depth.account.part.photo': 'your photo',
  'depth.account.part.language': 'language',
  'depth.account.part.privacy': 'privacy',
  'depth.account.part.whatsapp': 'WhatsApp',
  'depth.account.part.roles': 'the other areas you can open',
} as const;

export type DepthWordKey = keyof typeof DEPTH_WORDS;

export function depthWord(key: DepthWordKey, params?: Readonly<Record<string, string>>): string {
  return DEPTH_WORDS[key].replace(/\{(\w+)\}/g, (whole, token: string) => params?.[token] ?? whole);
}
