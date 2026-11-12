# Review of the Bengali strings that already sit in packages/i18n/src/messages.ts (current repo truth).
import csv, re
with open('packages/i18n/src/messages.ts', encoding='utf-8') as fh:
    src = fh.read()
def block(name):
    m = re.search(r'export const %s[^=]*=\s*\{(.*?)\n\};?' % name, src, re.S)
    out = {}
    for mm in re.finditer(r"^\s*'([\w.]+)':\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"),?\s*$", m.group(1), re.M):
        out[mm.group(1)] = mm.group(2) if mm.group(2) is not None else mm.group(3)
    return out
EN, BN = block('EN'), block('BN')
# key: (severity, issue_class, why, proposed)
R = {
 'document.status.clean': ('CRITICAL','STRONGER_CLAIM','English says only that the file type and structure were checked. "পরিষ্কার" means clean and reads as virus-free.','ডকুমেন্টের ফরম্যাট পরীক্ষা করা হয়েছে'),
 'document.scanning': ('CRITICAL','STRONGER_CLAIM','English says "being checked". Bengali says "scanned for safety", which claims a security scan.','এই ডকুমেন্ট পরীক্ষা করা হচ্ছে।'),
 'document.status.scanning': ('CRITICAL','STRONGER_CLAIM','English "Being Checked" became "স্ক্যান করা হচ্ছে" (being scanned).','পরীক্ষা করা হচ্ছে'),
 'document.processing.scanning': ('CRITICAL','STRONGER_CLAIM','English "Checking the File" became "স্ক্যান করা হচ্ছে" (being scanned).','ডকুমেন্ট পরীক্ষা করা হচ্ছে'),
 'document.processing.quarantined': ('CRITICAL','MEANING_CHANGE','English "Checking the File" became "কোয়ারেন্টাইনে" (in quarantine), a held-back state.','ডকুমেন্ট পরীক্ষা করা হচ্ছে'),
 'document.processing.ready': ('CRITICAL','MEANING_CHANGE','English "Reviewed and Approved" became "প্রস্তুত" (Ready). Ready is not approved.','পর্যালোচনা ও অনুমোদন করা হয়েছে'),
 'document.status.quarantined': ('HIGH','WEAKER_CLAIM','English "Held for Safety"; "চিহ্নিত" only means marked. The hold is lost.','নিরাপত্তার জন্য আটকে রাখা হয়েছে'),
 'document.status.pending': ('HIGH','WRONG_TERM','"মুলতুবি" means adjourned or postponed; English says waiting to be checked.','পরীক্ষার অপেক্ষায়'),
 'document.processing.normalizing': ('HIGH','WRONG_TERM','"যাচাই" is the word for verify. English is a file check, which uses "পরীক্ষা".','ডকুমেন্ট পরীক্ষা করা হচ্ছে'),
 'document.processing.extracting': ('MEDIUM','MEANING_CHANGE','English "Reading the File"; "প্রক্রিয়াকরণ" says processing, which is vaguer.','ডকুমেন্ট পড়া হচ্ছে'),
 'mission.readiness.missing': ('HIGH','MEANING_CHANGE','English counts requirements. Bengali says required documents, which narrows the meaning.','{count}টি প্রয়োজনীয়তা এখনও বাকি'),
 'mission.readiness.ready': ('HIGH','MEANING_CHANGE','English "required items"; Bengali says required documents.','প্রয়োজনীয় সব আইটেম দেওয়া হয়েছে।'),
 'mission.readiness.needsReview': ('MEDIUM','MEANING_CHANGE','"বিষয়" (matters) replaces requirements.','{count}টি প্রয়োজনীয়তা নিশ্চিত করতে আরও তথ্য লাগবে।'),
 'grant.status.paused': ('HIGH','WRONG_TERM','"বিরত" means abstained or refrained, not paused.','স্থগিত'),
 'grant.pending': ('HIGH','AMBIGUOUS','Reads as "{recipient} is waiting to receive". English: waiting for {recipient} to accept.','{recipient}-এর গ্রহণের অপেক্ষায়।'),
 'document.quarantined': ('LOW','TERMINOLOGY_INCONSISTENT','Uses "নথি" while the glossary and neighbouring corrected rows use ডকুমেন্ট; one screen would show both words.','এই ডকুমেন্ট চিহ্নিত করা হয়েছে এবং আপনার মনোযোগ দরকার।'),
 'mission.readiness.manualOnly': ('LOW','OWNER_DECISION_TERM','Correct meaning. The owner chose ফাইল for "case" on 2026-11-12; it is written ভিসা ফাইল so it cannot be read as an uploaded file.','এই ভিসা ফাইলটি স্বয়ংক্রিয়ভাবে মূল্যায়ন করা হয় না।'),
 'consent.ai.title': ('MEDIUM','TERMINOLOGY','"নিষ্কাশন" is a technical Sanskritised word with a drainage sense. Plain wording: AI reading information from a document.','ডকুমেন্ট থেকে এআই-এর তথ্য পড়ার সম্মতি'),
 'consent.ocr.title': ('LOW','TERMINOLOGY','"ওসিআর" is jargon. Keep only if the English keeps OCR.','এআই দিয়ে লেখা পড়ার সম্মতি (ওসিআর)'),
 'consent.issuerContact.title': ('LOW','TERMINOLOGY','Reads as a contact between issuers. Clearer: consent to contact the issuing body.','ইস্যুকারী প্রতিষ্ঠানের সঙ্গে যোগাযোগের সম্মতি'),
 'consent.action.grant': ('MEDIUM','TERMINOLOGY','"প্রদান করুন" is stiff as a stand-alone button.','সম্মতি দিন'),
 'consent.action.revoke': ('LOW','OK_WITH_NOTE','Correct. Making the object explicit helps a stand-alone button.','সম্মতি প্রত্যাহার করুন'),
 'grant.status.revoked': ('LOW','TERMINOLOGY_INCONSISTENT','"প্রত্যাহৃত" is correct but formal; buttons use "প্রত্যাহার করুন".','প্রত্যাহার করা হয়েছে'),
 'grant.status.expired': ('LOW','OK_WITH_NOTE','"মেয়াদ উত্তীর্ণ" is used in official Bengali. Either is acceptable; pick one and keep it.','মেয়াদ শেষ হয়েছে'),
 'applicant.relationship.self': ('LOW','TERMINOLOGY','"নিজে" alone is incomplete as a label.','আমি নিজে'),
 'applicant.relationship.minorGuardian': ('MEDIUM','GENDERED','"নাবালক" is the male form in everyday use. Neutral: "অপ্রাপ্তবয়স্ক".','অপ্রাপ্তবয়স্ক (অভিভাবক)'),
 'error.generic.title': ('LOW','OK_WITH_NOTE','Google Bengali uses "কিছু ভুল হয়েছে" (attested). "ভুল" can still read as the person\'s mistake; "সমস্যা" is the blame-free alternative. Editor decides.','কিছু একটা সমস্যা হয়েছে'),
 'legalHold.active': ('HIGH','MISSING','No Bengali string; English shows. Legal review required before any wording.','এই রেকর্ডে আইনি হোল্ড আছে, তাই এটি মুছে ফেলা যাবে না।'),
}
with open('docs/localization/data/BN_EXISTING_CATALOGUE_REVIEW.csv','w',newline='',encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['key','english_now','existing_bn','verdict','severity','issue_class','why','proposed_bn','status'])
    n = {'ok':0,'issues':0}
    for k, en in EN.items():
        bn = BN.get(k, '')
        if k in R:
            sev, cls, why, prop = R[k]
            verdict = 'CHANGE' if cls not in ('OK_WITH_NOTE',) else 'KEEP_WITH_NOTE'
            n['issues'] += 1
        else:
            sev, cls, why, prop, verdict = '', '', '', '', 'KEEP'
            n['ok'] += 1
        w.writerow([k, en, bn, verdict, sev, cls, why, prop, 'PROPOSED_NOT_APPLIED' if prop else ''])
print(len(EN), 'EN keys,', len(BN), 'BN keys,', n)
