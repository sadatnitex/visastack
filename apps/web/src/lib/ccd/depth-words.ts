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
