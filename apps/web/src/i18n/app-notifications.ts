import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-notifications surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appNotificationsCatalog = defineCatalog({
  en: {
    'appNotifications.appNotificationsNotificationList.markAllRead': 'Mark All Read',
    'appNotifications.appNotificationsNotificationList.markRead': 'Mark Read',
    'appNotifications.appNotificationsNotificationList.new': 'New',
    'appNotifications.appNotificationsNotificationList.notificationList': 'Notification List',
    'appNotifications.appNotificationsNotificationList.open': 'Open',
    'appNotifications.appNotificationsPage.account': 'Account',
    'appNotifications.appNotificationsPage.noNotificationsYet': 'No Notifications Yet',
    'appNotifications.appNotificationsPage.nothingUnreadInYourLatestNotifications':
      'Nothing unread in your latest notifications.',
    'appNotifications.appNotificationsPage.notifications': 'Notifications',
    'appNotifications.appNotificationsPage.thisIsWhereVisastackTellsYou':
      'This is where VisaStack tells you what needs you: a request from an agency, a document close to expiring, a case that moved. Nothing needs you right now.',
  },
  bn: {
    'appNotifications.appNotificationsNotificationList.markAllRead': 'সব পড়া হয়েছে চিহ্নিত করুন',
    'appNotifications.appNotificationsNotificationList.markRead': 'পড়া হয়েছে চিহ্নিত করুন',
    'appNotifications.appNotificationsNotificationList.new': 'নতুন',
    'appNotifications.appNotificationsNotificationList.notificationList': 'নোটিফিকেশনের তালিকা',
    'appNotifications.appNotificationsNotificationList.open': 'খুলুন',
    'appNotifications.appNotificationsPage.account': 'অ্যাকাউন্ট',
    'appNotifications.appNotificationsPage.noNotificationsYet': 'এখনও কোনো নোটিফিকেশন নেই',
    'appNotifications.appNotificationsPage.nothingUnreadInYourLatestNotifications':
      'আপনার সাম্প্রতিক নোটিফিকেশনে না-পড়া কিছু নেই।',
    'appNotifications.appNotificationsPage.notifications': 'নোটিফিকেশন',
    'appNotifications.appNotificationsPage.thisIsWhereVisastackTellsYou':
      'VisaStack এখানে আপনাকে জানায় কীসে আপনার সাড়া দরকার: এজেন্সির একটি অনুরোধ, মেয়াদ শেষের কাছাকাছি একটি ডকুমেন্ট, বা এগিয়ে যাওয়া একটি ভিসা ফাইল। এই মুহূর্তে আপনার কিছু করার নেই।',
  },
});
